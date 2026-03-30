const express = require("express");
const { db, getSettingsObject, isValidMonthString, SUPPORTED_CURRENCY_LIST } = require("../db");
const { buildDedupHash } = require("../services/dedup");
const { ensureRuleForManualCategorization, getCandidatesForPattern } = require("../services/categorizer");
const { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } = require("../services/metrics");
const { suggestSync } = require("../services/suggester");
const {
  createReviewGroupTracker,
  ensureSmartCategoriesForTransactions,
  listGuidedReviewGroups,
  listReviewGroups,
  matchSmartCategoryTemplate,
  trackReviewGroup,
} = require("../services/smart-categories");
const { normalizePatternValue } = require("../services/taxonomy");
const {
  buildTransactionReviewSuggestion,
  clearTransactionCategorization,
  logCategorizationEvent,
  markTransactionCategorized,
  markTransactionSuggested,
  resolveTransactionClassification,
} = require("../services/transaction-categorization");
const { recordGlobalPatternLearning } = require("../services/global-learning");
const {
  confirmInternalOperation,
  rejectInternalOperation,
  upsertInternalOperationSuggestion,
} = require("../services/internal-operations");

const router = express.Router();
const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_LIST);

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

function fetchTransactionRow(id) {
  return db.prepare(
    `SELECT t.*, c.name AS category_name, c.type AS category_type, c.color AS category_color,
            a.name AS account_name, io.status AS internal_operation_status, io.kind AS internal_operation_kind
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN internal_operations io ON io.id = t.internal_operation_id
     WHERE t.id = ?`
  ).get(Number(id));
}

function buildPendingGuidedReviewPayload(transactions, settings, categories) {
  const activeTransactions = transactions.filter(
    (transaction) => transaction && transaction.categorization_status !== "categorized"
  );
  if (activeTransactions.length === 0) {
    return {
      review_groups: [],
      transaction_review_queue: [],
      guided_review_groups: [],
      guided_onboarding_required: false,
      guided_onboarding_session: null,
      remaining_transaction_ids: [],
    };
  }

  ensureSmartCategoriesForTransactions(db, activeTransactions);
  const categoryByName = new Map(
    categories.map((category) => [String(category.name || "").toLowerCase(), category])
  );
  const disabledPatterns = db.prepare(
    `SELECT normalized_pattern, category_id
     FROM rules
     WHERE mode = 'disabled'
       AND normalized_pattern IS NOT NULL
       AND normalized_pattern != ''`
  ).all();
  const skippedPatternKeys = new Set(
    disabledPatterns.map((row) => `${Number(row.category_id)}:${normalizePatternValue(row.normalized_pattern)}`)
  );
  const reviewGroups = createReviewGroupTracker();
  const transactionReviewQueue = [];

  for (const transaction of activeTransactions) {
    const classification = resolveTransactionClassification(
      db,
      transaction.desc_banco,
      Number(transaction.monto),
      transaction.moneda,
      null,
      transaction
    );

    const smartMatch = matchSmartCategoryTemplate(transaction.desc_banco);
    if (smartMatch) {
      const smartCategory = categoryByName.get(String(smartMatch.template.name || "").toLowerCase());
      if (smartCategory) {
        trackReviewGroup(reviewGroups, transaction, smartMatch, smartCategory.id, transaction.id, {
          skipPatterns: skippedPatternKeys,
        });
      }
    }

    const reviewItem = buildTransactionReviewSuggestion(db, {
      id: transaction.id,
      fecha: transaction.fecha,
      desc_banco: transaction.desc_banco,
      monto: Number(transaction.monto),
      moneda: transaction.moneda,
      account_id: transaction.account_id,
    }, {
      categories,
      classification,
    });
    if (reviewItem) {
      transactionReviewQueue.push(reviewItem);
    }
  }

  const guidedReviewGroups = listGuidedReviewGroups(reviewGroups, 6);
  const guidedOnboardingDone = String(settings.guided_categorization_onboarding_completed || "0") === "1";
  const guidedOnboardingSkipped = String(settings.guided_categorization_onboarding_skipped || "0") === "1";
  const guidedOnboardingRequired = !guidedOnboardingDone && !guidedOnboardingSkipped && guidedReviewGroups.length > 0;

  return {
    review_groups: listReviewGroups(reviewGroups),
    transaction_review_queue: transactionReviewQueue,
    guided_review_groups: guidedReviewGroups,
    guided_onboarding_required: guidedOnboardingRequired,
    guided_onboarding_session: guidedOnboardingRequired ? { max_cards: guidedReviewGroups.length } : null,
    remaining_transaction_ids: activeTransactions.map((transaction) => Number(transaction.id)),
  };
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

router.post("/review/pending-guided", (req, res) => {
  const { transaction_ids = [], month = null, account_id = null } = req.body || {};
  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
    return res.status(400).json({ error: "transaction_ids are required" });
  }

  const ids = transaction_ids
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (ids.length === 0) {
    return res.status(400).json({ error: "transaction_ids are required" });
  }

  const placeholders = ids.map(() => "?").join(", ");
  const params = [...ids];
  let filters = `AND t.id IN (${placeholders})`;
  if (month && isValidMonthString(month)) {
    filters += " AND substr(t.fecha, 1, 7) = ?";
    params.push(month);
  }
  if (account_id) {
    filters += " AND t.account_id = ?";
    params.push(account_id);
  }

  const transactions = db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.monto, t.moneda, t.account_id, t.categorization_status
     FROM transactions t
     WHERE 1 = 1
       ${filters}
     ORDER BY t.fecha DESC, t.id DESC`
  ).all(...params);
  const settings = getSettingsObject();
  const categories = db.prepare(
    "SELECT id, name, slug, type, color, origin FROM categories ORDER BY sort_order ASC, id ASC"
  ).all();

  res.json(buildPendingGuidedReviewPayload(transactions, settings, categories));
});

router.post("/confirm-internal-operation", (req, res) => {
  const kind = req.body.kind === "fx_exchange" ? "fx_exchange" : "internal_transfer";
  const sourceTransactionId = Number(req.body.source_transaction_id);
  if (!Number.isInteger(sourceTransactionId) || sourceTransactionId < 1) {
    return res.status(400).json({ error: "source_transaction_id is required" });
  }

  try {
    const operation = confirmInternalOperation(db, {
      kind,
      source_transaction_id: sourceTransactionId,
      target_transaction_id: req.body.target_transaction_id ? Number(req.body.target_transaction_id) : null,
      from_account_id: req.body.from_account_id || null,
      to_account_id: req.body.to_account_id || null,
      effective_rate: req.body.effective_rate != null ? Number(req.body.effective_rate) : null,
    });
    res.json({ ok: true, operation, transaction: fetchTransactionRow(sourceTransactionId) });
  } catch (error) {
    res.status(400).json({ error: error.message || "could not confirm internal operation" });
  }
});

router.post("/reject-internal-operation", (req, res) => {
  const sourceTransactionId = Number(req.body.source_transaction_id);
  if (!Number.isInteger(sourceTransactionId) || sourceTransactionId < 1) {
    return res.status(400).json({ error: "source_transaction_id is required" });
  }

  try {
    const operationId = rejectInternalOperation(db, sourceTransactionId);
    res.json({ ok: true, operation_id: operationId, transaction: fetchTransactionRow(sourceTransactionId) });
  } catch (error) {
    res.status(400).json({ error: error.message || "could not reject internal operation" });
  }
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
    return res.status(400).json({ error: `moneda must be one of ${SUPPORTED_CURRENCY_LIST.join(", ")}` });
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

  const classification = resolveTransactionClassification(db, normalizedDescBanco, Number(monto), moneda, category_id, {
    fecha,
    account_id,
  });

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
        categorization_status, category_source, category_confidence, category_rule_id,
        movement_kind, internal_operation_id, counterparty_account_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
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
      classification.categoryRuleId,
      classification.movementKind || "normal"
    );

  if (classification.internalOperation) {
    upsertInternalOperationSuggestion(db, {
      ...classification.internalOperation,
      source_transaction_id: Number(result.lastInsertRowid),
    });
  }
  res.status(201).json(fetchTransactionRow(result.lastInsertRowid));
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
  const nextMovementKind = req.body.category_id !== undefined ? "normal" : (current.movement_kind || "normal");
  const nextInternalOperationId = req.body.category_id !== undefined ? null : (current.internal_operation_id ?? null);
  const nextCounterpartyAccountId = req.body.category_id !== undefined ? null : (current.counterparty_account_id ?? null);

  db.prepare(
    `UPDATE transactions
     SET category_id = ?, desc_usuario = ?, account_id = ?, fecha = ?, monto = ?, dedup_hash = ?,
         categorization_status = ?, category_source = ?, category_confidence = ?, category_rule_id = ?,
         movement_kind = ?, internal_operation_id = ?, counterparty_account_id = ?
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
    nextMovementKind,
    nextInternalOperationId,
    nextCounterpartyAccountId,
    id
  );

  let ruleStatus = null;
  if (req.body.category_id && req.body.category_id !== current.category_id) {
    ruleStatus = ensureRuleForManualCategorization(db, current.desc_banco, req.body.category_id);
    recordGlobalPatternLearning(db, "local-user", current.desc_banco, req.body.category_id, "confirm");
  }

  res.json({ transaction: fetchTransactionRow(id), rule: ruleStatus });
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
      const fullTx = db.prepare("SELECT desc_banco FROM transactions WHERE id = ?").get(Number(id));
      if (fullTx?.desc_banco) {
        recordGlobalPatternLearning(db, "local-user", fullTx.desc_banco, category_id, "confirm");
      }
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
  const existingTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions").get();
  const settings = getSettingsObject();
  const guidedOnboardingDone = String(settings.guided_categorization_onboarding_completed || "0") === "1";
  const guidedOnboardingSkipped = String(settings.guided_categorization_onboarding_skipped || "0") === "1";
  const batchCurrency = batchAccount?.currency || "UYU";
  ensureSmartCategoriesForTransactions(db, transactions);
  const categories = db.prepare("SELECT id, name, slug, type, color, origin FROM categories ORDER BY sort_order ASC, id ASC").all();
  const categoryByName = new Map(categories.map((category) => [String(category.name || "").toLowerCase(), category]));
  const validCategoryIds = new Set(categories.map((row) => Number(row.id)));
  const disabledPatterns = db.prepare(
    `SELECT normalized_pattern, category_id
     FROM rules
     WHERE mode = 'disabled'
       AND normalized_pattern IS NOT NULL
       AND normalized_pattern != ''`
  ).all();
  const skippedPatternKeys = new Set(
    disabledPatterns.map((row) => `${Number(row.category_id)}:${normalizePatternValue(row.normalized_pattern)}`)
  );
  const reviewGroups = createReviewGroupTracker();
  const transactionReviewQueue = [];

  let created = 0;
  let duplicates = 0;
  let errors = 0;

  const insertStmt = db.prepare(`
    INSERT INTO transactions
      (fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, dedup_hash,
       categorization_status, category_source, category_confidence, category_rule_id,
       movement_kind, internal_operation_id, counterparty_account_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
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

      const classification = resolveTransactionClassification(db, normalizedDescBanco, Number(monto), moneda, category_id, {
        fecha,
        account_id,
      });

      const insertResult = insertStmt.run(
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
        classification.categoryRuleId,
        classification.movementKind || "normal"
      );
      if (classification.internalOperation) {
        upsertInternalOperationSuggestion(db, {
          ...classification.internalOperation,
          source_transaction_id: Number(insertResult.lastInsertRowid),
        });
      }
      if (!classification.categoryId) {
        const smartMatch = matchSmartCategoryTemplate(normalizedDescBanco);
        if (smartMatch) {
          const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
          if (smartCategory) {
            trackReviewGroup(reviewGroups, { desc_banco: normalizedDescBanco }, smartMatch, smartCategory.id, insertResult.lastInsertRowid, {
              skipPatterns: skippedPatternKeys,
            });
          }
        }
      }
      const reviewItem = buildTransactionReviewSuggestion(db, {
        id: insertResult.lastInsertRowid,
        fecha,
        desc_banco: normalizedDescBanco,
        monto: Number(monto),
        moneda,
      }, { categories, classification });
      if (reviewItem) {
        transactionReviewQueue.push(reviewItem);
      }
      created += 1;
    }
  });

  runBatch(transactions);
  const guidedReviewGroups = listGuidedReviewGroups(reviewGroups, 6);
  const guidedOnboardingRequired = (
    Number(existingTransactions?.count || 0) === 0 &&
    created > 0 &&
    !guidedOnboardingDone &&
    !guidedOnboardingSkipped &&
    guidedReviewGroups.length > 0
  );
  res.status(201).json({
    created,
    duplicates,
    errors,
    review_groups: listReviewGroups(reviewGroups),
    transaction_review_queue: transactionReviewQueue,
    guided_review_groups: guidedReviewGroups,
    guided_onboarding_required: guidedOnboardingRequired,
    guided_onboarding_session: guidedOnboardingRequired ? { max_cards: guidedReviewGroups.length } : null,
  });
});

module.exports = router;

