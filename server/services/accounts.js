const { getSettingsObject } = require("../db");
const crypto = require("crypto");

function convertAmount(amount, fromCurrency, toCurrency, usdUyuRate) {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  if (fromCurrency === "USD" && toCurrency === "UYU") {
    return amount * usdUyuRate;
  }

  if (fromCurrency === "UYU" && toCurrency === "USD") {
    return amount / usdUyuRate;
  }

  return amount;
}

function normalizeLinkPair(left, right) {
  return [left, right].sort((a, b) => a.localeCompare(b));
}

function findAccountLink(db, leftAccountId, rightAccountId, relationType = null) {
  const [accountAId, accountBId] = normalizeLinkPair(leftAccountId, rightAccountId);
  const baseQuery = `
    SELECT *
    FROM account_links
    WHERE account_a_id = ? AND account_b_id = ?
  `;

  if (relationType) {
    return db.prepare(`${baseQuery} AND relation_type = ? LIMIT 1`).get(accountAId, accountBId, relationType) || null;
  }

  return db.prepare(`${baseQuery} LIMIT 1`).get(accountAId, accountBId) || null;
}

function areAccountsLinked(db, leftAccountId, rightAccountId, relationType = null) {
  return Boolean(findAccountLink(db, leftAccountId, rightAccountId, relationType));
}

function getAccountLinks(db) {
  return db
    .prepare(
      `
      SELECT
        al.*,
        aa.name AS account_a_name,
        aa.currency AS account_a_currency,
        bb.name AS account_b_name,
        bb.currency AS account_b_currency
      FROM account_links al
      JOIN accounts aa ON aa.id = al.account_a_id
      JOIN accounts bb ON bb.id = al.account_b_id
      ORDER BY al.created_at ASC, al.id ASC
    `
    )
    .all();
}

function buildLinkedAccountMap(links) {
  const map = new Map();

  links.forEach((link) => {
    const left = {
      id: link.id,
      relation_type: link.relation_type,
      account_id: link.account_b_id,
      account_name: link.account_b_name,
      currency: link.account_b_currency
    };

    const right = {
      id: link.id,
      relation_type: link.relation_type,
      account_id: link.account_a_id,
      account_name: link.account_a_name,
      currency: link.account_a_currency
    };

    map.set(link.account_a_id, [...(map.get(link.account_a_id) || []), left]);
    map.set(link.account_b_id, [...(map.get(link.account_b_id) || []), right]);
  });

  return map;
}

function getAccountsWithBalances(db) {
  const rows = db
    .prepare(
      `
      SELECT
        a.*,
        COALESCE(SUM(t.monto), 0) AS transaction_total
      FROM accounts a
      LEFT JOIN transactions t ON t.account_id = a.id
      GROUP BY a.id
      ORDER BY a.created_at ASC, a.id ASC
    `
    )
    .all();

  const links = getAccountLinks(db);
  const linkedAccountMap = buildLinkedAccountMap(links);

  return rows.map((row) => {
    const openingBalance = Number(row.opening_balance || 0);
    const transactionTotal = Number(row.transaction_total || 0);
    const liveBalance = openingBalance + transactionTotal;

    return {
      ...row,
      opening_balance: openingBalance,
      live_balance: liveBalance,
      balance: liveBalance,
      linked_accounts: linkedAccountMap.get(row.id) || []
    };
  });
}

function getAccountById(db, id) {
  return getAccountsWithBalances(db).find((account) => account.id === id) || null;
}

function getConsolidatedSnapshot(db) {
  const settings = getSettingsObject();
  const displayCurrency = settings.display_currency || "UYU";
  const usdUyuRate = Number(settings.exchange_rate_usd_uyu || 1);
  const accounts = getAccountsWithBalances(db);
  const total = accounts.reduce((sum, account) => {
    return sum + convertAmount(account.live_balance, account.currency, displayCurrency, usdUyuRate);
  }, 0);

  return {
    total,
    currency: displayCurrency,
    exchange_rate: usdUyuRate,
    accounts
  };
}

function toAbsoluteDayNumber(dateText) {
  return Math.floor(new Date(`${dateText}T00:00:00Z`).getTime() / 86400000);
}

function amountDifferenceInSourceCurrency(leftTx, rightTx, usdUyuRate) {
  const leftAmount = Math.abs(Number(leftTx.monto || 0));
  const rightAmount = Math.abs(Number(rightTx.monto || 0));
  const convertedRight = Math.abs(convertAmount(rightAmount, rightTx.moneda, leftTx.moneda, usdUyuRate));
  return Math.abs(leftAmount - convertedRight);
}

function isCandidatePair(leftTx, rightTx, usdUyuRate) {
  if (!leftTx || !rightTx) {
    return false;
  }

  if (leftTx.account_id === rightTx.account_id) {
    return false;
  }

  if (Math.sign(Number(leftTx.monto || 0)) === Math.sign(Number(rightTx.monto || 0))) {
    return false;
  }

  const dayDistance = Math.abs(toAbsoluteDayNumber(leftTx.fecha) - toAbsoluteDayNumber(rightTx.fecha));
  if (dayDistance > 2) {
    return false;
  }

  const leftAmount = Math.abs(Number(leftTx.monto || 0));
  const tolerance = Math.max(10, leftAmount * 0.08);
  return amountDifferenceInSourceCurrency(leftTx, rightTx, usdUyuRate) <= tolerance;
}

function findBestMatch(sourceTx, candidates, usdUyuRate) {
  let best = null;

  candidates.forEach((candidate) => {
    if (!isCandidatePair(sourceTx, candidate, usdUyuRate)) {
      return;
    }

    const score =
      Math.abs(toAbsoluteDayNumber(sourceTx.fecha) - toAbsoluteDayNumber(candidate.fecha)) * 100000 +
      amountDifferenceInSourceCurrency(sourceTx, candidate, usdUyuRate);

    if (!best || score < best.score) {
      best = { tx: candidate, score };
    }
  });

  return best?.tx || null;
}

function reconcileAccountLinkTransactions(db, linkId, options = {}) {
  const link = db
    .prepare(
      `
      SELECT *
      FROM account_links
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(Number(linkId));

  if (!link) {
    const error = new Error("account link not found");
    error.statusCode = 404;
    throw error;
  }

  const settings = getSettingsObject();
  const usdUyuRate = Number(settings.exchange_rate_usd_uyu || 1);
  const filters = [
    "account_id IN (?, ?)",
    "COALESCE(movement_type, 'standard') = 'standard'",
    "COALESCE(entry_type, CASE WHEN monto >= 0 THEN 'income' ELSE 'expense' END) != 'internal_transfer'",
    "linked_transaction_id IS NULL",
    "COALESCE(es_cuota, 0) = 0"
  ];
  const params = [link.account_a_id, link.account_b_id];

  if (options.month) {
    filters.push("substr(fecha, 1, 7) = ?");
    params.push(options.month);
  }

  const candidates = db
    .prepare(
      `
      SELECT id, fecha, desc_banco, monto, moneda, category_id, account_id, entry_type, movement_type
      FROM transactions
      WHERE ${filters.join(" AND ")}
      ORDER BY fecha ASC, ABS(monto) ASC, id ASC
    `
    )
    .all(...params);

  const accountATxs = candidates.filter((tx) => tx.account_id === link.account_a_id);
  const accountBTxs = candidates.filter((tx) => tx.account_id === link.account_b_id);
  const usedIds = new Set();
  const pairs = [];

  const considerPairing = (sourceList, targetList) => {
    sourceList.forEach((sourceTx) => {
      if (usedIds.has(sourceTx.id) || Number(sourceTx.monto) >= 0) {
        return;
      }

      const availableTargets = targetList.filter((targetTx) => !usedIds.has(targetTx.id) && Number(targetTx.monto) > 0);
      const match = findBestMatch(sourceTx, availableTargets, usdUyuRate);
      if (!match) {
        return;
      }

      usedIds.add(sourceTx.id);
      usedIds.add(match.id);
      pairs.push([sourceTx, match]);
    });
  };

  considerPairing(accountATxs, accountBTxs);
  considerPairing(accountBTxs, accountATxs);

  const preferredCurrency = link.preferred_currency || null;

  const updatedTransactions = db.transaction(() => {
    const updated = [];

    pairs.forEach(([leftTx, rightTx]) => {
      const transferGroupId = crypto.randomUUID();

      [leftTx, rightTx].forEach((tx, idx) => {
        const other = idx === 0 ? rightTx : leftTx;
        if (!preferredCurrency || tx.moneda !== preferredCurrency) {
          db.prepare(
            `UPDATE transactions
             SET category_id = NULL, entry_type = 'internal_transfer',
                 movement_type = 'internal_transfer',
                 transfer_group_id = ?, linked_transaction_id = ?
             WHERE id = ?`
          ).run(transferGroupId, other.id, tx.id);
        } else {
          // Preferred leg: keep original classification, just link it
          db.prepare(
            `UPDATE transactions SET transfer_group_id = ?, linked_transaction_id = ? WHERE id = ?`
          ).run(transferGroupId, other.id, tx.id);
        }
      });

      updated.push(leftTx.id, rightTx.id);
    });

    return updated;
  })();

  return {
    link_id: link.id,
    reconciled_pairs: pairs.length,
    reconciled_transactions: updatedTransactions.length,
    month: options.month || null
  };
}

module.exports = {
  areAccountsLinked,
  convertAmount,
  findAccountLink,
  getAccountById,
  getAccountLinks,
  getAccountsWithBalances,
  getConsolidatedSnapshot,
  normalizeLinkPair,
  reconcileAccountLinkTransactions
};
