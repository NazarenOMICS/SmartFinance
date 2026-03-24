const express = require("express");
const { db } = require("../db");
const { buildDedupHash } = require("../services/dedup");
const { ensureRuleForManualCategorization, findMatchingRule, bumpRule } = require("../services/categorizer");
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
  const months = Math.max(1, Number(req.query.months || 6));
  const end = req.query.end;

  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: "end is required in YYYY-MM format" });
  }

  res.json(computeMonthlyEvolution(db, end, months));
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

  let resolvedCategoryId = category_id;
  if (!resolvedCategoryId) {
    const rule = findMatchingRule(db, desc_banco);
    if (rule) {
      resolvedCategoryId = rule.category_id;
      bumpRule(db, rule.id);
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

  const next = {
    category_id: req.body.category_id ?? current.category_id,
    desc_usuario: req.body.desc_usuario ?? current.desc_usuario,
    account_id: req.body.account_id ?? current.account_id
  };

  db.prepare("UPDATE transactions SET category_id = ?, desc_usuario = ?, account_id = ? WHERE id = ?").run(
    next.category_id,
    next.desc_usuario,
    next.account_id,
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

module.exports = router;

