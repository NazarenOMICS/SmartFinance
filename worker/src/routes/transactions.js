import { Hono } from "hono";
import { getDb, getSettingsObject, isValidMonthString } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import {
  buildTransactionReviewSuggestion,
  bumpRule,
  classifyTransaction,
  ensureRuleForManualCategorization,
  getCandidatesForPattern,
} from "../services/categorizer.js";
import {
  clearTransactionCategorization,
  logCategorizationEvent,
  markTransactionCategorized,
  markTransactionSuggested,
} from "../services/categorization-events.js";
import { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } from "../services/metrics.js";
import {
  createReviewGroupTracker,
  ensureSmartCategoriesForTransactions,
  listGuidedReviewGroups,
  listReviewGroups,
  matchSmartCategoryTemplate,
  trackReviewGroup,
} from "../services/smart-categories.js";
import { suggestSync } from "../services/suggester.js";
import { normalizePatternValue } from "../services/taxonomy.js";
import { SUPPORTED_CURRENCY_LIST } from "../db.js";

const router = new Hono();
const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_LIST);

function getMonth(c) {
  const month = c.req.query("month");
  return isValidMonthString(month) ? month : null;
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

async function fetchTransactionRow(db, userId, id) {
  return db.prepare(
    `SELECT t.*, c.name AS category_name, c.slug AS category_slug, c.type AS category_type, c.color AS category_color,
            a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.id = ? AND t.user_id = ?`
  ).get(id, userId);
}

router.get("/search", async (c) => {
  const userId = c.get("userId");
  const q = (c.req.query("q") || "").trim();
  const limit = parsePositiveInt(c.req.query("limit") || 20, 20, 50);
  if (q.length < 2) return c.json([]);
  const db = getDb(c.env);
  const term = `%${q}%`;
  const rows = await db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.desc_usuario, t.monto, t.moneda,
            t.categorization_status, t.category_source, t.category_confidence, t.category_rule_id,
            c.name AS category_name, c.color AS category_color, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.user_id = ?
       AND (LOWER(t.desc_banco) LIKE LOWER(?) OR LOWER(COALESCE(t.desc_usuario,'')) LIKE LOWER(?) OR CAST(t.monto AS TEXT) LIKE ?)
     ORDER BY t.fecha DESC LIMIT ?`
  ).all(userId, term, term, term, limit);
  return c.json(rows);
});

router.get("/pending", async (c) => {
  const userId = c.get("userId");
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  const rows = await getTransactionsForMonth(db, month, userId, "AND t.categorization_status != 'categorized'");
  return c.json(rows);
});

router.get("/candidates", async (c) => {
  const userId = c.get("userId");
  const pattern = (c.req.query("pattern") || "").trim();
  const categoryId = Number(c.req.query("category_id"));
  if (!pattern || !Number.isFinite(categoryId)) {
    return c.json({ error: "pattern and category_id are required" }, 400);
  }
  const db = getDb(c.env);
  return c.json(await getCandidatesForPattern(db, pattern, categoryId, userId));
});

router.post("/confirm-category", async (c) => {
  const userId = c.get("userId");
  const { transaction_ids = [], category_id, rule_id = null, origin = "review" } = await c.req.json();
  if (!Array.isArray(transaction_ids) || transaction_ids.length === 0 || !category_id) {
    return c.json({ error: "transaction_ids and category_id are required" }, 400);
  }

  const db = getDb(c.env);
  const category = await db.prepare(
    "SELECT id FROM categories WHERE id = ? AND user_id = ?"
  ).get(Number(category_id), userId);
  if (!category) return c.json({ error: "category not found" }, 404);

  let updated = 0;
  for (const txId of transaction_ids) {
    const tx = await db.prepare(
      "SELECT id FROM transactions WHERE id = ? AND user_id = ?"
    ).get(Number(txId), userId);
    if (!tx) continue;
    await markTransactionCategorized(db, userId, txId, category_id, {
      source: origin === "upload_review" ? "upload_review" : "rule_review",
      confidence: null,
      ruleId: rule_id,
    });
    await logCategorizationEvent(db, userId, {
      transactionId: txId,
      ruleId: rule_id,
      categoryId: category_id,
      decision: "confirm",
      origin,
    });
    updated += 1;
  }

  return c.json({ updated, confirmed: updated });
});

router.post("/reject-category", async (c) => {
  const userId = c.get("userId");
  const { transaction_id, rule_id, origin = "review" } = await c.req.json();
  if (!transaction_id || !rule_id) {
    return c.json({ error: "transaction_id and rule_id are required" }, 400);
  }

  const db = getDb(c.env);
  const tx = await db.prepare(
    "SELECT id FROM transactions WHERE id = ? AND user_id = ?"
  ).get(Number(transaction_id), userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);
  const rule = await db.prepare(
    "SELECT id FROM rules WHERE id = ? AND user_id = ?"
  ).get(Number(rule_id), userId);
  if (!rule) return c.json({ error: "rule not found" }, 404);

  await c.env.DB.prepare(
    `INSERT INTO rule_exclusions (user_id, rule_id, transaction_id)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, rule_id, transaction_id) DO NOTHING`
  ).bind(userId, Number(rule_id), Number(transaction_id)).run();
  await clearTransactionCategorization(db, userId, transaction_id);
  await logCategorizationEvent(db, userId, {
    transactionId: transaction_id,
    ruleId: rule_id,
    categoryId: null,
    decision: "reject",
    origin,
  });

  return c.json({ rejected: true });
});

router.post("/undo-reject-category", async (c) => {
  const userId = c.get("userId");
  const { transaction_id, rule_id, origin = "review" } = await c.req.json();
  if (!transaction_id || !rule_id) {
    return c.json({ error: "transaction_id and rule_id are required" }, 400);
  }

  const db = getDb(c.env);
  await db.prepare(
    "DELETE FROM rule_exclusions WHERE user_id = ? AND rule_id = ? AND transaction_id = ?"
  ).run(userId, Number(rule_id), Number(transaction_id));
  await markTransactionSuggested(db, userId, transaction_id, {
    source: "rule_suggest",
    confidence: null,
    ruleId: rule_id,
  });
  await logCategorizationEvent(db, userId, {
    transactionId: transaction_id,
    ruleId: rule_id,
    categoryId: null,
    decision: "undo_reject",
    origin,
  });

  return c.json({ undone: true });
});

router.post("/undo-confirm-category", async (c) => {
  const userId = c.get("userId");
  const { transaction_id, category_id, origin = "review" } = await c.req.json();
  if (!transaction_id || !category_id) {
    return c.json({ error: "transaction_id and category_id are required" }, 400);
  }

  const db = getDb(c.env);
  await clearTransactionCategorization(db, userId, transaction_id);
  await logCategorizationEvent(db, userId, {
    transactionId: transaction_id,
    ruleId: null,
    categoryId: category_id,
    decision: "undo_confirm",
    origin,
  });

  return c.json({ undone: true });
});

router.get("/summary", async (c) => {
  const userId = c.get("userId");
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  return c.json(await computeSummary(db, c.env, month, userId));
});

router.get("/monthly-evolution", async (c) => {
  const userId = c.get("userId");
  const end = c.req.query("end");
  if (!isValidMonthString(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const months = parsePositiveInt(c.req.query("months") || 6, 6, 24);
  const db = getDb(c.env);
  return c.json(await computeMonthlyEvolution(db, c.env, end, months, userId));
});

router.get("/", async (c) => {
  const userId = c.get("userId");
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  const filters = [];
  const params = [];

  const accountId = c.req.query("account_id");
  if (accountId) {
    filters.push("AND t.account_id = ?");
    params.push(accountId);
  }

  const categoryId = c.req.query("category_id");
  if (categoryId) {
    filters.push("AND t.category_id = ?");
    params.push(Number(categoryId));
  }

  const rows = await getTransactionsForMonth(db, month, userId, filters.join(" "), params);
  const [rules, categories] = await Promise.all([
    db.prepare(
      "SELECT id, pattern, normalized_pattern, category_id, mode, confidence FROM rules WHERE user_id = ? ORDER BY LENGTH(normalized_pattern) DESC, match_count DESC, id ASC"
    ).all(userId),
    db.prepare("SELECT id, name FROM categories WHERE user_id = ?").all(userId),
  ]);
  return c.json(rows.map((tx) => suggestSync(tx, rules, categories)));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const {
    fecha,
    desc_banco,
    desc_usuario = null,
    monto,
    moneda = "UYU",
    category_id = null,
    account_id = null,
    es_cuota = 0,
    installment_id = null,
  } = body;
  const normalizedDescBanco = String(desc_banco || "").trim();
  const normalizedDescUsuario = desc_usuario == null ? null : String(desc_usuario).trim() || null;
  if (!fecha || !normalizedDescBanco || monto == null) {
    return c.json({ error: "fecha, desc_banco and monto are required" }, 400);
  }
  if (!isValidISODate(fecha)) return c.json({ error: "fecha must be in YYYY-MM-DD format" }, 400);
  if (!Number.isFinite(Number(monto))) return c.json({ error: "monto must be a finite number" }, 400);
  if (!SUPPORTED_CURRENCIES.has(moneda)) return c.json({ error: `moneda must be one of ${SUPPORTED_CURRENCY_LIST.join(", ")}` }, 400);

  const db = getDb(c.env);
  if (account_id) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }
  if (category_id != null) {
    const category = await db.prepare(
      "SELECT id FROM categories WHERE id = ? AND user_id = ?"
    ).get(Number(category_id), userId);
    if (!category) return c.json({ error: "category not found" }, 404);
  }
  if (installment_id != null) {
    const installment = await db.prepare(
      "SELECT id FROM installments WHERE id = ? AND user_id = ?"
    ).get(Number(installment_id), userId);
    if (!installment) return c.json({ error: "installment not found" }, 404);
  }

  const hash = await buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
  const dup = await db.prepare(
    "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)"
  ).get(hash, userId, fecha);
  if (dup) return c.json({ error: "Duplicate transaction", id: dup.id }, 409);

  let resolvedCategoryId = category_id;
  let categorizationStatus = resolvedCategoryId ? "categorized" : "uncategorized";
  let categorySource = resolvedCategoryId ? "manual" : null;
  let categoryConfidence = null;
  let categoryRuleId = null;

  if (!resolvedCategoryId) {
    const settings = await getSettingsObject(c.env, userId);
    const classification = await classifyTransaction(db, c.env, {
      desc_banco: normalizedDescBanco,
      monto: Number(monto),
      moneda,
      account_id,
    }, userId, { settings });

    categorizationStatus = classification.categorization_status;
    categorySource = classification.category_source;
    categoryConfidence = classification.category_confidence;
    categoryRuleId = classification.category_rule_id;

    if (classification.action === "auto" && classification.categoryId) {
      resolvedCategoryId = classification.categoryId;
      if (classification.rule?.id) {
        await bumpRule(db, classification.rule.id);
      }
    }
  }

  const result = await db.prepare(
    `INSERT INTO transactions (
      fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash, user_id,
      categorization_status, category_source, category_confidence, category_rule_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fecha,
    normalizedDescBanco,
    normalizedDescUsuario,
    Number(monto),
    moneda,
    resolvedCategoryId,
    account_id,
    es_cuota ? 1 : 0,
    installment_id,
    hash,
    userId,
    categorizationStatus,
    categorySource,
    categoryConfidence,
    categoryRuleId
  );

  const created = await fetchTransactionRow(db, userId, result.lastInsertRowid);
  return c.json(created, 201);
});

router.post("/batch", async (c) => {
  const userId = c.get("userId");
  const { transactions: txList, account_id: batchAccount } = await c.req.json();
  if (!Array.isArray(txList)) return c.json({ error: "transactions array required" }, 400);

  const db = getDb(c.env);
  const existingTransactions = await db.prepare(
    "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?"
  ).get(userId);
  const settings = await getSettingsObject(c.env, userId);
  const guidedOnboardingDone = String(settings.guided_categorization_onboarding_completed || "0") === "1";
  const guidedOnboardingSkipped = String(settings.guided_categorization_onboarding_skipped || "0") === "1";
  if (batchAccount) {
    const batchAccountRow = await db.prepare(
      "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
    ).get(batchAccount, userId);
    if (!batchAccountRow) return c.json({ error: "account not found" }, 404);
  }
  await ensureSmartCategoriesForTransactions(db, userId, txList);
  const accountCurrencyCache = new Map();
  const categories = await db.prepare("SELECT id, name, slug, type, color, origin FROM categories WHERE user_id = ?").all(userId);
  const categoryByName = new Map(categories.map((category) => [String(category.name || "").toLowerCase(), category]));
  const categoryIds = new Set(categories.map((row) => Number(row.id)));
  const disabledPatterns = await db.prepare(
    `SELECT normalized_pattern, category_id
     FROM rules
     WHERE user_id = ?
       AND mode = 'disabled'
       AND normalized_pattern IS NOT NULL
       AND normalized_pattern != ''`
  ).all(userId);
  const skippedPatternKeys = new Set(
    disabledPatterns.map((row) => `${Number(row.category_id)}:${normalizePatternValue(row.normalized_pattern)}`)
  );
  const reviewGroups = createReviewGroupTracker();
  const transactionReviewQueue = [];
  if (batchAccount) {
    const batchAccountRow = await db.prepare(
      "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
    ).get(batchAccount, userId);
    if (batchAccountRow?.currency) accountCurrencyCache.set(batchAccount, batchAccountRow.currency);
  }

  let created = 0;
  let duplicates = 0;
  let errors = 0;

  for (const tx of txList) {
    try {
      const { fecha, desc_banco, monto, moneda, account_id } = tx;
      const normalizedDescBanco = String(desc_banco || "").trim();
      if (!fecha || !normalizedDescBanco || monto == null) { errors++; continue; }
      if (!isValidISODate(fecha) || !Number.isFinite(Number(monto))) { errors++; continue; }
      if (moneda != null && !SUPPORTED_CURRENCIES.has(moneda)) { errors++; continue; }
      if (tx.category_id != null && !categoryIds.has(Number(tx.category_id))) { errors++; continue; }

      const hash = await buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
      const dup = await db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)"
      ).get(hash, userId, fecha);
      if (dup) { duplicates++; continue; }

      const resolvedAccountId = account_id || batchAccount || null;
      if (resolvedAccountId && !accountCurrencyCache.has(resolvedAccountId)) {
        const accountRow = await db.prepare(
          "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
        ).get(resolvedAccountId, userId);
        if (!accountRow) { errors++; continue; }
        accountCurrencyCache.set(resolvedAccountId, accountRow.currency);
      }
      const resolvedCurrency = moneda || accountCurrencyCache.get(resolvedAccountId) || "UYU";
      const classification = await classifyTransaction(db, c.env, {
        desc_banco: normalizedDescBanco,
        monto: Number(monto),
        moneda: resolvedCurrency,
        account_id: resolvedAccountId,
      }, userId, { settings, categories });

      let resolvedCategoryId = null;
      if (classification.action === "auto" && classification.categoryId) {
        resolvedCategoryId = classification.categoryId;
        if (classification.rule?.id) {
          await bumpRule(db, classification.rule.id);
        }
      }

      const result = await db.prepare(
        `INSERT INTO transactions (
          fecha, desc_banco, monto, moneda, category_id, account_id, dedup_hash, user_id,
          categorization_status, category_source, category_confidence, category_rule_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        fecha,
        normalizedDescBanco,
        Number(monto),
        resolvedCurrency,
        resolvedCategoryId,
        resolvedAccountId,
        hash,
        userId,
        classification.categorization_status,
        classification.category_source,
        classification.category_confidence,
        classification.category_rule_id
      );
      if (!resolvedCategoryId) {
        const smartMatch = matchSmartCategoryTemplate(normalizedDescBanco);
        if (smartMatch) {
          const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
          if (smartCategory) {
            trackReviewGroup(reviewGroups, { desc_banco: normalizedDescBanco }, smartMatch, smartCategory.id, result.lastInsertRowid, {
              skipPatterns: skippedPatternKeys,
            });
          }
        }
      }
      const reviewItem = await buildTransactionReviewSuggestion(db, c.env, {
        id: result.lastInsertRowid,
        fecha,
        desc_banco: normalizedDescBanco,
        monto: Number(monto),
        moneda: resolvedCurrency,
        account_id: resolvedAccountId,
      }, userId, { settings, categories, classification });
      if (reviewItem) {
        transactionReviewQueue.push(reviewItem);
      }
      created++;
    } catch {
      errors++;
    }
  }

  const guidedReviewGroups = listGuidedReviewGroups(reviewGroups, 6);
  const guidedOnboardingRequired = (
    Number(existingTransactions?.count || 0) === 0 &&
    created > 0 &&
    !guidedOnboardingDone &&
    !guidedOnboardingSkipped &&
    guidedReviewGroups.length > 0
  );

  return c.json({
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

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const tx = await db.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?").get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);

  const body = await c.req.json();
  if (body.account_id !== undefined && body.account_id !== null) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(body.account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }
  if (body.fecha !== undefined && !isValidISODate(body.fecha)) {
    return c.json({ error: "fecha must be in YYYY-MM-DD format" }, 400);
  }
  if (body.monto !== undefined && !Number.isFinite(Number(body.monto))) {
    return c.json({ error: "monto must be a finite number" }, 400);
  }
  if (body.desc_usuario !== undefined && body.desc_usuario !== null && !String(body.desc_usuario).trim()) {
    return c.json({ error: "desc_usuario cannot be blank" }, 400);
  }
  if (body.category_id !== undefined && body.category_id !== null) {
    const category = await db.prepare(
      "SELECT id FROM categories WHERE id = ? AND user_id = ?"
    ).get(Number(body.category_id), userId);
    if (!category) return c.json({ error: "category not found" }, 404);
  }

  const next = {
    category_id: body.category_id !== undefined ? body.category_id : tx.category_id,
    desc_usuario: body.desc_usuario !== undefined ? (String(body.desc_usuario).trim() || null) : tx.desc_usuario,
    account_id: body.account_id !== undefined ? body.account_id : tx.account_id,
    fecha: body.fecha !== undefined ? body.fecha : tx.fecha,
    monto: body.monto !== undefined ? Number(body.monto) : tx.monto,
  };

  const nextDedupHash = await buildDedupHash({
    fecha: next.fecha,
    monto: next.monto,
    desc_banco: tx.desc_banco,
  });
  const duplicate = await db.prepare(
    `SELECT id
     FROM transactions
     WHERE id <> ? AND user_id = ? AND dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
     LIMIT 1`
  ).get(id, userId, nextDedupHash, next.fecha);
  if (duplicate) {
    return c.json({ error: "Duplicate transaction", id: duplicate.id }, 409);
  }

  let ruleResult = null;
  let categorizationStatus = tx.categorization_status || (tx.category_id ? "categorized" : "uncategorized");
  let categorySource = tx.category_source || (tx.category_id ? "manual" : null);
  let categoryConfidence = tx.category_confidence ?? null;
  let categoryRuleId = tx.category_rule_id ?? null;

  if (body.category_id === null) {
    categorizationStatus = "uncategorized";
    categorySource = null;
    categoryConfidence = null;
    categoryRuleId = null;
  } else if (body.category_id != null) {
    categorizationStatus = "categorized";
    categorySource = "manual";
    categoryConfidence = null;
    categoryRuleId = null;
  }

  await db.prepare(
    `UPDATE transactions
     SET category_id = ?, desc_usuario = ?, account_id = ?, fecha = ?, monto = ?, dedup_hash = ?,
         categorization_status = ?, category_source = ?, category_confidence = ?, category_rule_id = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    next.category_id,
    next.desc_usuario,
    next.account_id,
    next.fecha,
    next.monto,
    nextDedupHash,
    categorizationStatus,
    categorySource,
    categoryConfidence,
    categoryRuleId,
    id,
    userId
  );

  if (body.category_id != null && body.category_id !== tx.category_id) {
    ruleResult = await ensureRuleForManualCategorization(db, { ...tx, ...next }, body.category_id, userId);
    await logCategorizationEvent(db, userId, {
      transactionId: id,
      ruleId: null,
      categoryId: body.category_id,
      decision: "confirm",
      origin: "manual_edit",
    });
  } else if (body.category_id === null && tx.category_id != null) {
    await logCategorizationEvent(db, userId, {
      transactionId: id,
      ruleId: null,
      categoryId: tx.category_id,
      decision: "undo_confirm",
      origin: "manual_edit",
    });
  }

  const updated = await fetchTransactionRow(db, userId, id);
  return c.json({ transaction: updated, rule: ruleResult });
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const tx = await db.prepare(
    "SELECT id FROM transactions WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);
  await db.prepare("DELETE FROM categorization_events WHERE user_id = ? AND transaction_id = ?").run(userId, id);
  await db.prepare("DELETE FROM rule_exclusions WHERE user_id = ? AND transaction_id = ?").run(userId, id);
  await db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, userId);
  return new Response(null, { status: 204 });
});

export default router;
