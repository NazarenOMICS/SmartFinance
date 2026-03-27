const express = require("express");
const { db } = require("../db");
const { buildDedupHash } = require("../services/dedup");
const { ensureRuleForManualCategorization, findMatchingRule, bumpRule, isLikelyReintegro, isLikelyTransfer } = require("../services/categorizer");
const { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } = require("../services/metrics");

const router = express.Router();

function requireMonth(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month is required in YYYY-MM format" });
    return null;
  }
  return month;
}

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

function isValidISODate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

router.get("/pending", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const rows = getTransactionsForMonth(db, month, "AND t.category_id IS NULL");
  res.json(rows);
});

router.get("/summary", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  res.json(computeSummary(db, month));
});

router.get("/monthly-evolution", (req, res) => {
  const months = parsePositiveInt(req.query.months || 6, 6, 24);
  const end = req.query.end;

  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: "end is required in YYYY-MM format" });
  }

  res.json(computeMonthlyEvolution(db, end, months));
});

router.get("/search", (req, res) => {
  const { q, limit: limitParam = "20" } = req.query;
  if (!q) return res.status(400).json({ error: "q is required" });
  const limit = parsePositiveInt(limitParam, 20, 100);
  const pattern = `%${q}%`;
  const rows = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.type AS category_type, c.color AS category_color, a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.desc_banco LIKE ? OR t.desc_usuario LIKE ?
      ORDER BY t.fecha DESC
      LIMIT ?
    `
    )
    .all(pattern, pattern, limit);
  res.json(rows);
});

router.get("/", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const filters = [];
  const params = [];

  if (req.query.account_id) {
    filters.push("AND t.account_id = ?");
    params.push(req.query.account_id);
  }

  if (req.query.category_id) {
    filters.push("AND t.category_id = ?");
    params.push(Number(req.query.category_id));
  }

  const rows = getTransactionsForMonth(db, month, filters.join(" "), params);
  res.json(rows);
});

router.post("/", (req, res) => {
  const {
    fecha,
    desc_banco,
    desc_usuario = null,
    monto,
    moneda = "UYU",
    category_id = null,
    account_id = null,
    es_cuota = 0,
    installment_id = null
  } = req.body;

  if (!fecha || !desc_banco || typeof monto !== "number") {
    return res.status(400).json({ error: "fecha, desc_banco and monto are required" });
  }
  if (!isValidISODate(fecha)) {
    return res.status(400).json({ error: "fecha must be in YYYY-MM-DD format" });
  }
  if (!Number.isFinite(monto)) {
    return res.status(400).json({ error: "monto must be a finite number" });
  }
  if (account_id) {
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id);
    if (!account) {
      return res.status(404).json({ error: "account not found" });
    }
  }
  if (category_id != null) {
    const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(category_id));
    if (!category) {
      return res.status(404).json({ error: "category not found" });
    }
  }

  let resolvedCategoryId = category_id;
  if (!resolvedCategoryId) {
    const rule = findMatchingRule(db, desc_banco);
    if (rule) {
      resolvedCategoryId = rule.category_id;
      bumpRule(db, rule.id);
    } else if (isLikelyTransfer(desc_banco)) {
      const transferCat = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
      if (transferCat) resolvedCategoryId = transferCat.id;
    } else if (isLikelyReintegro(db, desc_banco, Number(monto), moneda)) {
      const reintegroCat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();
      if (reintegroCat) resolvedCategoryId = reintegroCat.id;
    }
  }

  const dedupHash = buildDedupHash({ fecha, monto, desc_banco });
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM transactions
      WHERE dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
      LIMIT 1
    `
    )
    .get(dedupHash, fecha);

  if (duplicate) {
    return res.status(409).json({ error: "transaction already exists for this month" });
  }

  const result = db
    .prepare(
      `
      INSERT INTO transactions (
        fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(fecha, desc_banco, desc_usuario, monto, moneda, resolvedCategoryId, account_id, es_cuota ? 1 : 0, installment_id, dedupHash);

  const transaction = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `
    )
    .get(result.lastInsertRowid);

  res.status(201).json(transaction);
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "transaction not found" });
  }
  if (req.body.account_id !== undefined && req.body.account_id !== null) {
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(req.body.account_id);
    if (!account) {
      return res.status(404).json({ error: "account not found" });
    }
  }
  if (req.body.fecha !== undefined && !isValidISODate(req.body.fecha)) {
    return res.status(400).json({ error: "fecha must be in YYYY-MM-DD format" });
  }
  if (req.body.monto !== undefined && !Number.isFinite(Number(req.body.monto))) {
    return res.status(400).json({ error: "monto must be a finite number" });
  }
  if (req.body.category_id !== undefined && req.body.category_id !== null) {
    const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(req.body.category_id));
    if (!category) {
      return res.status(404).json({ error: "category not found" });
    }
  }

  const next = {
    category_id:  req.body.category_id  ?? current.category_id,
    desc_usuario: req.body.desc_usuario ?? current.desc_usuario,
    account_id:   req.body.account_id   ?? current.account_id,
    fecha:        req.body.fecha        ?? current.fecha,
    monto:        req.body.monto !== undefined ? Number(req.body.monto) : current.monto,
  };
  const nextDedupHash = buildDedupHash({
    fecha: next.fecha,
    monto: next.monto,
    desc_banco: current.desc_banco
  });
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM transactions
      WHERE id <> ? AND dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
      LIMIT 1
    `
    )
    .get(id, nextDedupHash, next.fecha);
  if (duplicate) {
    return res.status(409).json({ error: "transaction already exists for this month" });
  }

  db.prepare("UPDATE transactions SET category_id = ?, desc_usuario = ?, account_id = ?, fecha = ?, monto = ?, dedup_hash = ? WHERE id = ?").run(
    next.category_id,
    next.desc_usuario,
    next.account_id,
    next.fecha,
    next.monto,
    nextDedupHash,
    id
  );

  let ruleStatus = null;
  if (req.body.category_id && req.body.category_id !== current.category_id) {
    ruleStatus = ensureRuleForManualCategorization(db, current.desc_banco, req.body.category_id);
  }

  const updated = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.id = ?
    `
    )
    .get(id);

  res.json({ transaction: updated, rule: ruleStatus });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM transactions WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "transaction not found" });
  }
  db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  res.status(204).send();
});

router.post("/batch", (req, res) => {
  const { transactions, account_id: batchAccountId = null } = req.body;
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: "transactions array is required" });
  }

  // Resolve the account currency once for the whole batch (used as moneda fallback)
  const batchAccount = batchAccountId
    ? db.prepare("SELECT currency FROM accounts WHERE id = ?").get(batchAccountId)
    : null;
  if (batchAccountId && !batchAccount) {
    return res.status(404).json({ error: "account not found" });
  }
  const batchCurrency = batchAccount?.currency || "UYU";
  const validCategoryIds = new Set(db.prepare("SELECT id FROM categories").all().map((row) => Number(row.id)));

  let created = 0;
  let duplicates = 0;

  const insertStmt = db.prepare(`
    INSERT INTO transactions
      (fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, dedup_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const transferCategory = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();

  const runBatch = db.transaction((txs) => {
    for (const tx of txs) {
      const { fecha, desc_banco, desc_usuario = null, monto,
              moneda = batchCurrency,
              category_id = null, account_id = batchAccountId, es_cuota = 0 } = tx;
      if (!fecha || !desc_banco || typeof monto !== "number") continue;
      if (!isValidISODate(fecha) || !Number.isFinite(Number(monto))) continue;
      if (category_id != null && !validCategoryIds.has(Number(category_id))) continue;
      if (account_id && !db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id)) continue;

      const hash = buildDedupHash({ fecha, monto, desc_banco });
      const exists = db
        .prepare("SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7) LIMIT 1")
        .get(hash, fecha);

      if (exists) { duplicates += 1; continue; }

      let resolvedCategoryId = category_id;
      if (!resolvedCategoryId) {
        const rule = findMatchingRule(db, desc_banco);
        if (rule) {
          resolvedCategoryId = rule.category_id;
          bumpRule(db, rule.id);
        } else if (isLikelyTransfer(desc_banco)) {
          if (transferCategory) resolvedCategoryId = transferCategory.id;
        } else if (isLikelyReintegro(db, desc_banco, Number(monto), moneda)) {
          const cat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();
          if (cat) resolvedCategoryId = cat.id;
        }
      }

      insertStmt.run(fecha, desc_banco, desc_usuario, monto, moneda,
                     resolvedCategoryId, account_id, es_cuota ? 1 : 0, hash);
      created += 1;
    }
  });

  runBatch(transactions);
  res.status(201).json({ created, duplicates });
});

module.exports = router;

