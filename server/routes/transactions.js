const express = require("express");
const { db, isValidMonthString } = require("../db");
const { buildDedupHash } = require("../services/dedup");
const { ensureRuleForManualCategorization, getCandidatesForPattern } = require("../services/categorizer");
const { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } = require("../services/metrics");
const { suggestSync } = require("../services/suggester");
const {
  clearTransactionCategorization,
  logCategorizationEvent,
  markTransactionCategorized,
  markTransactionSuggested,
  resolveTransactionClassification,
} = require("../services/transaction-categorization");

const router = express.Router();
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);

function requireMonth(req, res) {
  const { month } = req.query;
  if (!isValidMonthString(month)) {
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
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

router.get("/pending", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const rows = getTransactionsForMonth(db, month, "AND t.categorization_status != 'categorized'");
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

  if (!isValidMonthString(end)) {
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
      WHERE t.desc_banco LIKE ? OR t.desc_usuario LIKE ? OR CAST(t.monto AS TEXT) LIKE ?
      ORDER BY t.fecha DESC
      LIMIT ?
    `
    )
    .all(pattern, pattern, pattern, limit);
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
  const rules = db.prepare(
    "SELECT id, pattern, normalized_pattern, category_id, mode, confidence FROM rules ORDER BY LENGTH(normalized_pattern) DESC, match_count DESC, id ASC"
  ).all();
  const categories = db.prepare("SELECT id, name FROM categories").all();
  res.json(rows.map((tx) => suggestSync(tx, rules, categories)));
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
  const normalizedDescBanco = String(desc_banco || "").trim();
  const normalizedDescUsuario = desc_usuario == null ? null : String(desc_usuario).trim() || null;

  if (!fecha || !normalizedDescBanco || typeof monto !== "number") {
    return res.status(400).json({ error: "fecha, desc_banco and monto are required" });
  }
  if (!isValidISODate(fecha)) {
    return res.status(400).json({ error: "fecha must be in YYYY-MM-DD format" });
  }
  if (!Number.isFinite(monto)) {
    return res.status(400).json({ error: "monto must be a finite number" });
  }
  if (!SUPPORTED_CURRENCIES.has(moneda)) {
    return res.status(400).json({ error: "moneda must be UYU, USD or ARS" });
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
  if (installment_id != null) {
    const installment = db.prepare("SELECT id FROM installments WHERE id = ?").get(Number(installment_id));
    if (!installment) {
      return res.status(404).json({ error: "installment not found" });
    }
  }

  const classification = resolveTransactionClassification(db, normalizedDescBanco, Number(monto), moneda, category_id);

  const dedupHash = buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
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
        fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash,
        categorization_status, category_source, category_confidence, category_rule_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      fecha,
      normalizedDescBanco,
      normalizedDescUsuario,
      monto,
      moneda,
      classification.categoryId,
      account_id,
      es_cuota ? 1 : 0,
      installment_id,
      dedupHash,
      classification.categorizationStatus,
      classification.categorySource,
      classification.categoryConfidence,
      classification.categoryRuleId
    );

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
    desc_usuario: req.body.desc_usuario !== undefined ? (String(req.body.desc_usuario).trim() || null) : current.desc_usuario,
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

  const nextStatus = next.category_id == null ? "uncategorized" : "categorized";
  const nextSource = next.category_id == null ? null : (req.body.category_id !== undefined ? "manual" : current.category_source);
  const nextConfidence = next.category_id == null ? null : (req.body.category_id !== undefined ? null : current.category_confidence);
  const nextRuleId = next.category_id == null ? null : (req.body.category_id !== undefined ? null : current.category_rule_id);

  db.prepare(
    `UPDATE transactions
     SET category_id = ?, desc_usuario = ?, account_id = ?, fecha = ?, monto = ?, dedup_hash = ?,
         categorization_status = ?, category_source = ?, category_confidence = ?, category_rule_id = ?
     WHERE id = ?`
  ).run(
    next.category_id,
    next.desc_usuario,
    next.account_id,
    next.fecha,
    next.monto,
    nextDedupHash,
    nextStatus,
    nextSource,
    nextConfidence,
    nextRuleId,
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

// Get candidate transactions that match a pattern (for Tinder-style confirmation)
router.get("/candidates", (req, res) => {
  const { pattern, category_id } = req.query;
  if (!pattern || !category_id) {
    return res.status(400).json({ error: "pattern and category_id are required" });
  }
  const candidates = getCandidatesForPattern(db, pattern, Number(category_id));
  res.json(candidates);
});

// Batch-confirm categorization for specific transaction IDs
router.post("/confirm-category", (req, res) => {
  const { transaction_ids, category_id, rule_id = null, origin = "review" } = req.body;
  if (!Array.isArray(transaction_ids) || !category_id) {
    return res.status(400).json({ error: "transaction_ids array and category_id are required" });
  }
  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(category_id));
  if (!category) {
    return res.status(404).json({ error: "category not found" });
  }

  let confirmed = 0;
  const run = db.transaction((ids) => {
    for (const id of ids) {
      const tx = db.prepare("SELECT id FROM transactions WHERE id = ?").get(Number(id));
      if (!tx) continue;
      markTransactionCategorized(db, Number(id), Number(category_id), {
        source: origin === "upload_review" ? "upload_review" : "rule_review",
        confidence: null,
        ruleId: rule_id,
      });
      logCategorizationEvent(db, Number(id), {
        ruleId: rule_id,
        categoryId: category_id,
        decision: "confirm",
        origin,
      });
      confirmed += 1;
    }
  });
  run(transaction_ids);

  res.json({ confirmed });
});

router.post("/reject-category", (req, res) => {
  const { transaction_id, rule_id, origin = "review" } = req.body;
  if (!transaction_id || !rule_id) {
    return res.status(400).json({ error: "transaction_id and rule_id are required" });
  }
  const tx = db.prepare("SELECT id FROM transactions WHERE id = ?").get(Number(transaction_id));
  if (!tx) return res.status(404).json({ error: "transaction not found" });
  const rule = db.prepare("SELECT id FROM rules WHERE id = ?").get(Number(rule_id));
  if (!rule) return res.status(404).json({ error: "rule not found" });

  db.prepare(
    `INSERT OR IGNORE INTO rule_exclusions (rule_id, transaction_id)
     VALUES (?, ?)`
  ).run(Number(rule_id), Number(transaction_id));
  clearTransactionCategorization(db, Number(transaction_id));
  logCategorizationEvent(db, Number(transaction_id), {
    ruleId: rule_id,
    decision: "reject",
    origin,
  });
  res.json({ rejected: true });
});

router.post("/undo-reject-category", (req, res) => {
  const { transaction_id, rule_id, origin = "review" } = req.body;
  if (!transaction_id || !rule_id) {
    return res.status(400).json({ error: "transaction_id and rule_id are required" });
  }
  db.prepare("DELETE FROM rule_exclusions WHERE rule_id = ? AND transaction_id = ?").run(Number(rule_id), Number(transaction_id));
  markTransactionSuggested(db, Number(transaction_id), {
    source: "rule_suggest",
    confidence: null,
    ruleId: rule_id,
  });
  logCategorizationEvent(db, Number(transaction_id), {
    ruleId: rule_id,
    decision: "undo_reject",
    origin,
  });
  res.json({ undone: true });
});

router.post("/undo-confirm-category", (req, res) => {
  const { transaction_id, category_id, origin = "review" } = req.body;
  if (!transaction_id || !category_id) {
    return res.status(400).json({ error: "transaction_id and category_id are required" });
  }
  clearTransactionCategorization(db, Number(transaction_id));
  logCategorizationEvent(db, Number(transaction_id), {
    categoryId: category_id,
    decision: "undo_confirm",
    origin,
  });
  res.json({ undone: true });
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
  let errors = 0;

  const insertStmt = db.prepare(`
    INSERT INTO transactions
      (fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, dedup_hash,
       categorization_status, category_source, category_confidence, category_rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const runBatch = db.transaction((txs) => {
    for (const tx of txs) {
      const { fecha, desc_banco, desc_usuario = null, monto,
              moneda = batchCurrency,
              category_id = null, account_id = batchAccountId, es_cuota = 0 } = tx;
      const normalizedDescBanco = String(desc_banco || "").trim();
      const normalizedDescUsuario = desc_usuario == null ? null : String(desc_usuario).trim() || null;
      if (!fecha || !normalizedDescBanco || typeof monto !== "number") { errors += 1; continue; }
      if (!isValidISODate(fecha) || !Number.isFinite(Number(monto))) { errors += 1; continue; }
      if (!SUPPORTED_CURRENCIES.has(moneda)) { errors += 1; continue; }
      if (category_id != null && !validCategoryIds.has(Number(category_id))) { errors += 1; continue; }
      if (account_id && !db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id)) { errors += 1; continue; }

      const hash = buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
      const exists = db
        .prepare("SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7) LIMIT 1")
        .get(hash, fecha);

      if (exists) { duplicates += 1; continue; }

      const classification = resolveClassification(normalizedDescBanco, Number(monto), moneda, category_id);

      insertStmt.run(
        fecha,
        normalizedDescBanco,
        normalizedDescUsuario,
        monto,
        moneda,
        classification.categoryId,
        account_id,
        es_cuota ? 1 : 0,
        hash,
        classification.categorizationStatus,
        classification.categorySource,
        classification.categoryConfidence,
        classification.categoryRuleId
      );
      created += 1;
    }
  });

  runBatch(transactions);
  res.status(201).json({ created, duplicates, errors });
});

module.exports = router;

