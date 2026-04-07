import { Hono } from "hono";
import { convertAmount, getDb, getExchangeRateMap, getSettingsObject } from "../db.js";

const router = new Hono();

function normalizeLinkPair(a, b) {
  return [a, b].sort((x, y) => x.localeCompare(y));
}

async function getAccountLinks(db, userId) {
  return db.prepare(
    `SELECT al.*, aa.name AS account_a_name, aa.currency AS account_a_currency,
            bb.name AS account_b_name, bb.currency AS account_b_currency
     FROM account_links al
     JOIN accounts aa ON aa.id = al.account_a_id AND aa.user_id = al.user_id
     JOIN accounts bb ON bb.id = al.account_b_id AND bb.user_id = al.user_id
     WHERE al.user_id = ?
     ORDER BY al.created_at ASC, al.id ASC`
  ).all(userId);
}

function toAbsoluteDayNumber(dateText) {
  return Math.floor(new Date(`${dateText}T00:00:00Z`).getTime() / 86400000);
}

function convertForComparison(amount, fromCurrency, toCurrency, usdUyuRate) {
  if (fromCurrency === toCurrency) return amount;
  if (fromCurrency === "USD" && toCurrency === "UYU") return amount * usdUyuRate;
  if (fromCurrency === "UYU" && toCurrency === "USD") return amount / usdUyuRate;
  return amount;
}

function amountDifference(leftTx, rightTx, usdUyuRate) {
  const leftAbs = Math.abs(Number(leftTx.monto || 0));
  const rightAbs = Math.abs(Number(rightTx.monto || 0));
  const rightConverted = Math.abs(convertForComparison(rightAbs, rightTx.moneda, leftTx.moneda, usdUyuRate));
  return Math.abs(leftAbs - rightConverted);
}

function isCandidatePair(leftTx, rightTx, usdUyuRate) {
  if (!leftTx || !rightTx) return false;
  if (leftTx.account_id === rightTx.account_id) return false;
  if (Math.sign(Number(leftTx.monto || 0)) === Math.sign(Number(rightTx.monto || 0))) return false;
  const dayDistance = Math.abs(toAbsoluteDayNumber(leftTx.fecha) - toAbsoluteDayNumber(rightTx.fecha));
  if (dayDistance > 2) return false;
  const leftAbs = Math.abs(Number(leftTx.monto || 0));
  const tolerance = Math.max(10, leftAbs * 0.08);
  return amountDifference(leftTx, rightTx, usdUyuRate) <= tolerance;
}

function findBestMatch(sourceTx, candidates, usdUyuRate) {
  let best = null;
  for (const candidate of candidates) {
    if (!isCandidatePair(sourceTx, candidate, usdUyuRate)) continue;
    const score =
      Math.abs(toAbsoluteDayNumber(sourceTx.fecha) - toAbsoluteDayNumber(candidate.fecha)) * 100000 +
      amountDifference(sourceTx, candidate, usdUyuRate);
    if (!best || score < best.score) {
      best = { tx: candidate, score };
    }
  }
  return best?.tx || null;
}

router.get("/", async (c) => {
  const userId = c.get("userId");
  return c.json(await getAccountLinks(getDb(c.env), userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { account_a_id, account_b_id, relation_type = "fx_pair", preferred_currency = null } = body;

  if (!account_a_id || !account_b_id) {
    return c.json({ error: "account_a_id and account_b_id are required" }, 400);
  }
  if (account_a_id === account_b_id) {
    return c.json({ error: "linked accounts must be different" }, 400);
  }

  const db = getDb(c.env);
  const [accA, accB] = await Promise.all([
    db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(account_a_id, userId),
    db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(account_b_id, userId),
  ]);
  if (!accA || !accB) return c.json({ error: "account not found" }, 404);

  const [leftId, rightId] = normalizeLinkPair(account_a_id, account_b_id);
  const existing = await db.prepare(
    "SELECT id FROM account_links WHERE account_a_id = ? AND account_b_id = ? AND user_id = ?"
  ).get(leftId, rightId, userId);
  if (existing) return c.json({ error: "account link already exists" }, 409);

  const result = await db.prepare(
    "INSERT INTO account_links (account_a_id, account_b_id, relation_type, preferred_currency, user_id) VALUES (?, ?, ?, ?, ?)"
  ).run(leftId, rightId, relation_type, preferred_currency || null, userId);

  const created = (await getAccountLinks(db, userId)).find((item) => item.id === result.lastInsertRowid);
  return c.json(created, 201);
});

router.post("/:id/reconcile", async (c) => {
  const userId = c.get("userId");
  const linkId = Number(c.req.param("id"));
  const body = await c.req.json().catch(() => ({}));
  const db = getDb(c.env);

  const link = await db.prepare(
    "SELECT * FROM account_links WHERE id = ? AND user_id = ?"
  ).get(linkId, userId);
  if (!link) return c.json({ error: "account link not found" }, 404);

  const settings = await getSettingsObject(c.env, userId);
  const exchangeRates = getExchangeRateMap(settings);
  const usdUyuRate = Number(exchangeRates.USD || 42.5);

  let filterSql = `WHERE account_id IN (?, ?) AND user_id = ?
    AND COALESCE(movement_type, 'standard') = 'standard'
    AND COALESCE(entry_type, CASE WHEN monto >= 0 THEN 'income' ELSE 'expense' END) != 'internal_transfer'
    AND linked_transaction_id IS NULL
    AND COALESCE(es_cuota, 0) = 0`;
  const params = [link.account_a_id, link.account_b_id, userId];
  if (body.month) {
    filterSql += " AND substr(fecha, 1, 7) = ?";
    params.push(body.month);
  }

  const candidates = await db.prepare(
    `SELECT id, fecha, desc_banco, monto, moneda, account_id, entry_type, movement_type
     FROM transactions ${filterSql}
     ORDER BY fecha ASC, ABS(monto) ASC, id ASC`
  ).all(...params);

  const accountATxs = candidates.filter((tx) => tx.account_id === link.account_a_id);
  const accountBTxs = candidates.filter((tx) => tx.account_id === link.account_b_id);
  const usedIds = new Set();
  const pairs = [];

  const considerPairing = (sourceList, targetList) => {
    for (const sourceTx of sourceList) {
      if (usedIds.has(sourceTx.id) || Number(sourceTx.monto) >= 0) continue;
      const available = targetList.filter((tx) => !usedIds.has(tx.id) && Number(tx.monto) > 0);
      const match = findBestMatch(sourceTx, available, usdUyuRate);
      if (match) {
        usedIds.add(sourceTx.id);
        usedIds.add(match.id);
        pairs.push([sourceTx, match]);
      }
    }
  };

  considerPairing(accountATxs, accountBTxs);
  considerPairing(accountBTxs, accountATxs);

  const preferredCurrency = link.preferred_currency || null;
  const stmts = [];

  for (const [leftTx, rightTx] of pairs) {
    const transferGroupId = crypto.randomUUID();
    for (const [tx, other] of [[leftTx, rightTx], [rightTx, leftTx]]) {
      if (!preferredCurrency || tx.moneda !== preferredCurrency) {
        stmts.push(
          c.env.DB.prepare(
            `UPDATE transactions SET category_id = NULL, entry_type = 'internal_transfer',
             movement_type = 'internal_transfer', transfer_group_id = ?, linked_transaction_id = ?
             WHERE id = ? AND user_id = ?`
          ).bind(transferGroupId, other.id, tx.id, userId)
        );
      } else {
        const prefEntryType = Number(tx.monto) >= 0 ? "income" : "expense";
        stmts.push(
          c.env.DB.prepare(
            `UPDATE transactions SET entry_type = ?, movement_type = 'standard',
             transfer_group_id = ?, linked_transaction_id = ?
             WHERE id = ? AND user_id = ?`
          ).bind(prefEntryType, transferGroupId, other.id, tx.id, userId)
        );
      }
    }
  }

  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  return c.json({
    link_id: link.id,
    reconciled_pairs: pairs.length,
    reconciled_transactions: pairs.length * 2,
    month: body.month || null,
  });
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const existing = await db.prepare(
    "SELECT id FROM account_links WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!existing) return c.json({ error: "account link not found" }, 404);
  await db.prepare("DELETE FROM account_links WHERE id = ? AND user_id = ?").run(id, userId);
  return new Response(null, { status: 204 });
});

export default router;
