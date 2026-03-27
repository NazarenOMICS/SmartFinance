import { Hono } from "hono";
import { getDb } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { ensureRuleForManualCategorization, findMatchingRule, bumpRule, isLikelyReintegro, isLikelyTransfer } from "../services/categorizer.js";
import { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } from "../services/metrics.js";
import { suggestSync } from "../services/suggester.js";

const router = new Hono();

function getMonth(c) {
  const month = c.req.query("month");
  return month && /^\d{4}-\d{2}$/.test(month) ? month : null;
}

// Global full-text search across all months
router.get("/search", async (c) => {
  const userId = c.get("userId");
  const q     = (c.req.query("q") || "").trim();
  const limit = Math.min(50, Number(c.req.query("limit") || 20));
  if (q.length < 2) return c.json([]);
  const db   = getDb(c.env);
  const term = `%${q}%`;
  const rows = await db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.desc_usuario, t.monto, t.moneda,
            c.name AS category_name, c.color AS category_color, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.user_id = ?
       AND (LOWER(t.desc_banco) LIKE LOWER(?) OR LOWER(COALESCE(t.desc_usuario,'')) LIKE LOWER(?))
     ORDER BY t.fecha DESC LIMIT ?`
  ).all(userId, term, term, limit);
  return c.json(rows);
});

router.get("/pending", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db   = getDb(c.env);
  const rows = await getTransactionsForMonth(db, month, userId, "AND t.category_id IS NULL");
  return c.json(rows);
});

router.get("/summary", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  return c.json(await computeSummary(db, c.env, month, userId));
});

router.get("/monthly-evolution", async (c) => {
  const userId = c.get("userId");
  const end    = c.req.query("end");
  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const months = Math.max(1, Number(c.req.query("months") || 6));
  const db = getDb(c.env);
  return c.json(await computeMonthlyEvolution(db, c.env, end, months, userId));
});

router.get("/", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db   = getDb(c.env);
  const rows = await getTransactionsForMonth(db, month, userId);
  // Attach category suggestions to uncategorized transactions
  const [rules, categories] = await Promise.all([
    db.prepare("SELECT id, pattern, category_id FROM rules WHERE user_id = ? ORDER BY match_count DESC").all(userId),
    db.prepare("SELECT id, name FROM categories WHERE user_id = ?").all(userId),
  ]);
  return c.json(rows.map((tx) => suggestSync(tx, rules, categories)));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const body   = await c.req.json();
  const { fecha, desc_banco, desc_usuario = null, monto, moneda = "UYU",
          category_id = null, account_id = null, es_cuota = 0 } = body;
  if (!fecha || !desc_banco || monto == null) {
    return c.json({ error: "fecha, desc_banco and monto are required" }, 400);
  }
  const db   = getDb(c.env);
  const hash = await buildDedupHash({ fecha, monto, desc_banco });
  const dup  = await db.prepare(
    "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ?"
  ).get(hash, userId);
  if (dup) return c.json({ error: "Duplicate transaction", id: dup.id }, 409);

  // Auto-categorize
  let resolvedCategoryId = category_id;
  if (!resolvedCategoryId) {
    const rule = await findMatchingRule(db, desc_banco, userId);
    if (rule) {
      resolvedCategoryId = rule.category_id;
      await bumpRule(db, rule.id);
    } else if (isLikelyTransfer(desc_banco)) {
      const transferCategory = await db.prepare(
        "SELECT id FROM categories WHERE user_id = ? AND name = 'Transferencia'"
      ).get(userId);
      if (transferCategory) resolvedCategoryId = transferCategory.id;
    } else if (await isLikelyReintegro(db, desc_banco, Number(monto), moneda, userId)) {
      const reintegroCategory = await db.prepare(
        "SELECT id FROM categories WHERE user_id = ? AND name = 'Reintegro'"
      ).get(userId);
      if (reintegroCategory) resolvedCategoryId = reintegroCategory.id;
    }
  }

  const result = await db.prepare(
    `INSERT INTO transactions (fecha,desc_banco,desc_usuario,monto,moneda,category_id,account_id,es_cuota,dedup_hash,user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(fecha, desc_banco.trim(), desc_usuario, Number(monto), moneda,
        resolvedCategoryId, account_id, es_cuota ? 1 : 0, hash, userId);

  return c.json(await db.prepare("SELECT * FROM transactions WHERE id=?").get(result.lastInsertRowid), 201);
});

// Batch create (CSV import)
router.post("/batch", async (c) => {
  const userId = c.get("userId");
  const { transactions: txList, account_id: batchAccount } = await c.req.json();
  if (!Array.isArray(txList)) return c.json({ error: "transactions array required" }, 400);
  const db    = getDb(c.env);
  const rules = await db.prepare(
    "SELECT id, pattern, category_id FROM rules WHERE user_id = ? ORDER BY match_count DESC"
  ).all(userId);
  const transferCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Transferencia'"
  ).get(userId);
  const reintegroCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Reintegro'"
  ).get(userId);
  const accountCurrencyCache = new Map();
  if (batchAccount) {
    const batchAccountRow = await db.prepare(
      "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
    ).get(batchAccount, userId);
    if (batchAccountRow?.currency) accountCurrencyCache.set(batchAccount, batchAccountRow.currency);
  }

  let created = 0, duplicates = 0, errors = 0;
  for (const tx of txList) {
    try {
      const { fecha, desc_banco, monto, moneda, account_id } = tx;
      if (!fecha || !desc_banco || monto == null) { errors++; continue; }
      const hash = await buildDedupHash({ fecha, monto, desc_banco });
      const dup  = await db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ?"
      ).get(hash, userId);
      if (dup) { duplicates++; continue; }

      const resolvedAccountId = account_id || batchAccount || null;
      if (resolvedAccountId && !accountCurrencyCache.has(resolvedAccountId)) {
        const accountRow = await db.prepare(
          "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
        ).get(resolvedAccountId, userId);
        if (accountRow?.currency) accountCurrencyCache.set(resolvedAccountId, accountRow.currency);
      }
      const resolvedCurrency = moneda || accountCurrencyCache.get(resolvedAccountId) || "UYU";
      const rule = rules.find((r) => desc_banco.toLowerCase().includes(r.pattern.toLowerCase()));
      let resolvedCategoryId = rule?.category_id ?? null;
      if (rule) {
        await bumpRule(db, rule.id);
      } else if (isLikelyTransfer(desc_banco)) {
        resolvedCategoryId = transferCategory?.id ?? null;
      } else if (await isLikelyReintegro(db, desc_banco, Number(monto), resolvedCurrency, userId)) {
        resolvedCategoryId = reintegroCategory?.id ?? null;
      }
      await db.prepare(
        `INSERT INTO transactions (fecha,desc_banco,monto,moneda,category_id,account_id,dedup_hash,user_id)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(fecha, desc_banco.trim(), Number(monto), resolvedCurrency,
            resolvedCategoryId, resolvedAccountId, hash, userId);
      created++;
    } catch { errors++; }
  }
  return c.json({ created, duplicates, errors });
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const tx     = await db.prepare(
    "SELECT * FROM transactions WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);

  const body = await c.req.json();
  const next = {
    category_id:  body.category_id  !== undefined ? body.category_id  : tx.category_id,
    desc_usuario: body.desc_usuario !== undefined ? body.desc_usuario : tx.desc_usuario,
    account_id:   body.account_id   !== undefined ? body.account_id   : tx.account_id,
    fecha:        body.fecha        !== undefined ? body.fecha        : tx.fecha,
    monto:        body.monto        !== undefined ? Number(body.monto): tx.monto,
  };

  await db.prepare(
    `UPDATE transactions SET category_id=?,desc_usuario=?,account_id=?,fecha=?,monto=?
     WHERE id=? AND user_id=?`
  ).run(next.category_id, next.desc_usuario, next.account_id, next.fecha, next.monto, id, userId);

  let ruleResult = null;
  if (body.category_id != null && body.category_id !== tx.category_id) {
    ruleResult = await ensureRuleForManualCategorization(db, tx.desc_banco, body.category_id, userId);
  }

  return c.json({
    ...(await db.prepare("SELECT * FROM transactions WHERE id=?").get(id)),
    rule: ruleResult
  });
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const tx     = await db.prepare(
    "SELECT id FROM transactions WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);
  await db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, userId);
  return c.json({ ok: true });
});

export default router;
