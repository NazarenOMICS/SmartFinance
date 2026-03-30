import { suggest } from "./suggester.js";
import { suggestCategoryWithOllama } from "./ollama.js";
import { hasAmbiguousMerchantHint, matchCanonicalCategory, normalizePatternValue, normalizeText } from "./taxonomy.js";

async function listRules(db, userId) {
  return db.prepare(
    `SELECT id, pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
            account_id, currency, direction, merchant_key, last_matched_at, created_at
     FROM rules
     WHERE user_id = ?
     ORDER BY LENGTH(normalized_pattern) DESC, confidence DESC, match_count DESC, id ASC`
  ).all(userId);
}

async function listCategories(db, userId) {
  return db.prepare(
    "SELECT id, name, slug, type, color, origin FROM categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId);
}

function getDirection(monto) {
  return Number(monto) < 0 ? "expense" : "income";
}

function getThresholds(settings) {
  const autoThreshold = Math.min(Math.max(Number(settings.categorizer_auto_threshold || 0.88), 0), 1);
  const suggestThreshold = Math.min(
    Math.max(Number(settings.categorizer_suggest_threshold || 0.68), 0),
    autoThreshold
  );
  return { autoThreshold, suggestThreshold };
}

const GENERIC_PATTERN_TOKENS = new Set([
  "con", "tarjeta", "compra", "debito", "deb", "credito", "visa", "master", "mastercard",
  "pago", "cuota", "cuotas", "consumo", "local", "comercio", "pos", "web", "online",
  "internacional", "internac", "nacional", "uy", "uru", "cta", "caja", "ahorro",
  "movimiento", "compraweb", "punto", "venta", "servicio", "pago", "tc", "titular",
  "mercado", "trip", "one", "viaje"
]);

function extractMeaningfulPatternTokens(descBanco) {
  const cleaned = normalizeText(descBanco).replace(/\b\d{4,}\b/g, " ");
  return cleaned
    .split(" ")
    .filter((item) => item.length >= 3 && !GENERIC_PATTERN_TOKENS.has(item));
}

function isGenericRulePattern(pattern) {
  const tokens = normalizeText(pattern).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => token.length < 3 || GENERIC_PATTERN_TOKENS.has(token));
}

export function buildPatternFromDescription(descBanco) {
  const tokens = extractMeaningfulPatternTokens(descBanco);
  return tokens.slice(0, 2).join(" ").trim();
}

function buildMerchantKey(descBanco) {
  return buildPatternFromDescription(descBanco) || normalizeText(descBanco).split(" ").slice(0, 3).join(" ").trim();
}

function scoreRule(rule, tx) {
  const desc = normalizeText(tx.desc_banco);
  const pattern = rule.normalized_pattern || normalizePatternValue(rule.pattern);
  if (!desc || !pattern || isGenericRulePattern(pattern) || !desc.includes(pattern)) {
    return 0;
  }

  let score = 0.45 + Math.min(pattern.length / 32, 0.2);
  const txMerchantKey = buildMerchantKey(tx.desc_banco);
  const txDirection = getDirection(tx.monto);

  if (rule.merchant_key && normalizeText(rule.merchant_key) === normalizeText(txMerchantKey)) {
    score += 0.12;
  }
  if (rule.account_id && tx.account_id && rule.account_id === tx.account_id) {
    score += 0.12;
  }
  if (rule.currency && tx.moneda && rule.currency === tx.moneda) {
    score += 0.08;
  }
  if (rule.direction && rule.direction !== "any" && rule.direction === txDirection) {
    score += 0.1;
  }
  if ((rule.match_count || 0) >= 3) {
    score += 0.05;
  }
  if (rule.source === "seed") {
    score += 0.04;
  }

  return Math.min(score, 0.99);
}

function pickBestRule(rules, tx) {
  let best = null;
  let suppressedByDisabledRule = false;
  for (const rule of rules) {
    const score = scoreRule(rule, tx);
    if (score <= 0) continue;
    if (rule.mode === "disabled") {
      suppressedByDisabledRule = true;
      continue;
    }
    if (!best || score > best.score) {
      best = { ...rule, score };
    }
  }
  if (suppressedByDisabledRule) return null;
  return best?.score > 0 ? best : null;
}

export async function findMatchingRule(db, descBanco, userId, tx = {}) {
  const rules = await listRules(db, userId);
  return pickBestRule(rules, { desc_banco: descBanco, ...tx, monto: tx.monto ?? -1 });
}

export async function bumpRule(db, ruleId) {
  return db.prepare(
    "UPDATE rules SET match_count = match_count + 1, last_matched_at = datetime('now') WHERE id = ?"
  ).run(ruleId);
}

const REINTEGRO_KEYWORDS = [
  "devolucion", "devol", "reintegro", "reversa", "reverso",
  "acreditacion devol", "cashback", "contracargo", "reversal"
];

const REINTEGRO_THRESHOLDS = { UYU: 200, USD: 5, ARS: 1000 };

const TRANSFER_KEYWORDS = [
  "supernet tc",
  "compra de dolares",
  "venta de dolares",
  "compra dolares",
  "venta dolares",
  "compra divisa",
  "venta divisa",
  "compra moneda extranjera",
  "venta moneda extranjera",
  "cambio divisas",
  "cambio de moneda",
  "operacion tc",
  "operacion de cambio",
  "tc compra",
  "tc venta",
  "transferencia propia",
  "transferencia entre cuentas",
  "transferencia interna",
  "movimiento entre cuentas",
  "debito transferencia interna",
];

export function isLikelyTransfer(descBanco) {
  const normalized = normalizeText(descBanco);
  return TRANSFER_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));
}

export async function isLikelyReintegro(db, descBanco, monto, moneda, userId) {
  if (monto <= 0) return false;

  const normalized = normalizeText(descBanco);
  if (REINTEGRO_KEYWORDS.some((item) => normalized.includes(normalizeText(item)))) return true;

  const threshold = REINTEGRO_THRESHOLDS[moneda] ?? REINTEGRO_THRESHOLDS.UYU;
  if (monto < threshold) {
    const rule = await findMatchingRule(db, descBanco, userId);
    if (rule) {
      const category = await db.prepare(
        "SELECT name FROM categories WHERE id = ? AND user_id = ?"
      ).get(rule.category_id, userId);
      if (category?.name === "Ingreso") return false;
    }
    return true;
  }

  return false;
}

async function resolveCategoryByName(db, userId, name) {
  if (!name) return null;
  return db.prepare(
    "SELECT id, name, slug, color, type FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE"
  ).get(userId, name);
}

function buildSuggestion(rule, category, confidence, reason, source = "regla") {
  return {
    category_id: rule?.category_id ?? category?.id ?? null,
    category_name: category?.name || null,
    source,
    confidence,
    reason,
  };
}

export async function findCandidatesForRule(db, pattern, categoryId, userId) {
  const normalizedPattern = normalizePatternValue(pattern);
  const rule = await db.prepare(
    `SELECT id
     FROM rules
     WHERE user_id = ?
       AND normalized_pattern = ?
       AND category_id = ?
     ORDER BY id DESC
     LIMIT 1`
  ).get(userId, normalizedPattern, Number(categoryId));
  const excludeClause = rule ? `
       AND t.id NOT IN (
         SELECT transaction_id
         FROM rule_exclusions
         WHERE user_id = ?
           AND rule_id = ?
       )` : "";
  const params = rule ? [userId, normalizedPattern, userId, rule.id] : [userId, normalizedPattern];
  return db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.monto, t.moneda,
            t.categorization_status, t.category_source, t.category_confidence, t.category_rule_id,
            a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.user_id = ?
       AND t.categorization_status != 'categorized'
       AND LOWER(t.desc_banco) LIKE '%' || ? || '%'
       ${excludeClause}
     ORDER BY t.fecha DESC
     LIMIT 50`
  ).all(...params);
}

export async function getCandidatesForPattern(db, pattern, categoryId, userId) {
  return findCandidatesForRule(db, pattern, categoryId, userId);
}

export async function ensureRuleForManualCategorization(db, transaction, categoryId, userId) {
  const pattern = buildPatternFromDescription(transaction.desc_banco);
  if (!pattern || isGenericRulePattern(pattern)) return { created: false, conflict: false, rule: null };

  const normalizedPattern = normalizePatternValue(pattern);
  const merchantKey = buildMerchantKey(transaction.desc_banco);
  const direction = getDirection(transaction.monto);
  const accountId = transaction.account_id || null;
  const currency = transaction.moneda || null;
  const rules = await listRules(db, userId);

  const conflicting = pickBestRule(
    rules.filter((rule) => rule.category_id !== Number(categoryId)),
    transaction
  );
  if (conflicting && conflicting.score >= 0.8) {
    return { created: false, conflict: true, rule: conflicting };
  }

  const existing = await db.prepare(
    `SELECT *
     FROM rules
     WHERE user_id = ?
       AND normalized_pattern = ?
       AND category_id = ?
       AND COALESCE(account_id, '') = COALESCE(?, '')
       AND COALESCE(currency, '') = COALESCE(?, '')
       AND direction = ?`
  ).get(userId, normalizedPattern, Number(categoryId), accountId, currency, direction);

  if (existing) {
    const nextConfidence = Math.min(Number(existing.confidence || 0.72) + 0.06, 0.98);
    const nextMatchCount = Number(existing.match_count || 0) + 1;
    const nextMode = nextConfidence >= 0.9 || nextMatchCount >= 4 ? "auto" : existing.mode || "suggest";
    await db.prepare(
      `UPDATE rules
       SET match_count = match_count + 1,
           confidence = ?,
           mode = ?,
           merchant_key = ?,
           last_matched_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(nextConfidence, nextMode, merchantKey, existing.id, userId);
    return {
      created: false,
      conflict: false,
      rule: { ...existing, pattern, normalized_pattern: normalizedPattern, confidence: nextConfidence, mode: nextMode, match_count: nextMatchCount },
      candidates_count: 0
    };
  }

  const result = await db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, user_id, mode, confidence, source,
      account_id, currency, direction, merchant_key, last_matched_at
    ) VALUES (?, ?, ?, 1, ?, 'suggest', 0.72, 'manual', ?, ?, ?, ?, datetime('now'))`
  ).run(pattern, normalizedPattern, Number(categoryId), userId, accountId, currency, direction, merchantKey);

  const candidates = await findCandidatesForRule(db, pattern, categoryId, userId);
  return {
    created: true,
    conflict: false,
    rule: {
      id: result.lastInsertRowid,
      pattern,
      normalized_pattern: normalizedPattern,
      category_id: Number(categoryId),
      mode: "suggest",
      confidence: 0.72,
      source: "manual",
      account_id: accountId,
      currency,
      direction,
      merchant_key: merchantKey
    },
    candidates_count: candidates.length
  };
}

export async function classifyTransaction(db, env, tx, userId, options = {}) {
  const settings = options.settings || {};
  const rules = options.rules || await listRules(db, userId);
  const categories = options.categories || await listCategories(db, userId);
  const thresholds = getThresholds(settings);
  const bestRule = pickBestRule(rules, tx);
  const explicitCanonicalMatch = matchCanonicalCategory(tx.desc_banco);
  const ambiguousDescriptorOnly = hasAmbiguousMerchantHint(tx.desc_banco) && !explicitCanonicalMatch;

  if (bestRule) {
    const category = categories.find((item) => item.id === bestRule.category_id) || null;
    const shouldAuto = bestRule.mode === "auto" && bestRule.score >= thresholds.autoThreshold;
    if (shouldAuto) {
      return {
        categoryId: bestRule.category_id,
        action: "auto",
        confidence: bestRule.score,
        source: "rule_auto",
        rule: bestRule,
        suggestion: null,
        categorization_status: "categorized",
        category_source: "rule_auto",
        category_confidence: bestRule.score,
        category_rule_id: bestRule.id,
        reason: `Regla ${bestRule.pattern} (${Math.round(bestRule.score * 100)}%)`,
        category,
      };
    }
    if (bestRule.score >= thresholds.suggestThreshold) {
      return {
        categoryId: null,
        action: "suggest",
        confidence: bestRule.score,
        source: "rule_suggest",
        rule: bestRule,
        suggestion: buildSuggestion(
          bestRule,
          category,
          bestRule.score,
          `Coincidencia contextual con ${bestRule.pattern}`,
          "regla"
        ),
        categorization_status: "suggested",
        category_source: "rule_suggest",
        category_confidence: bestRule.score,
        category_rule_id: bestRule.id,
        reason: `Coincidencia contextual con ${bestRule.pattern}`,
        category,
      };
    }
  }

  if (isLikelyTransfer(tx.desc_banco)) {
    const transferCategory = await resolveCategoryByName(db, userId, "Transferencia");
    if (transferCategory) {
      return {
        categoryId: transferCategory.id,
        action: "auto",
        confidence: 0.97,
        source: "transfer",
        rule: null,
        suggestion: null,
        categorization_status: "categorized",
        category_source: "transfer",
        category_confidence: 0.97,
        category_rule_id: null,
        reason: "Detectado como transferencia interna o cambio de divisa",
        category: transferCategory,
      };
    }
  }

  if (await isLikelyReintegro(db, tx.desc_banco, Number(tx.monto), tx.moneda, userId)) {
    const refundCategory = await resolveCategoryByName(db, userId, "Reintegro");
    if (refundCategory) {
      return {
        categoryId: refundCategory.id,
        action: "auto",
        confidence: 0.9,
        source: "refund",
        rule: null,
        suggestion: null,
        categorization_status: "categorized",
        category_source: "refund",
        category_confidence: 0.9,
        category_rule_id: null,
        reason: "Detectado como reintegro/devolucion",
        category: refundCategory,
      };
    }
  }

  const heuristicSuggestion = await suggest(db, tx.desc_banco, categories, userId);
  if (heuristicSuggestion) {
    const confidence = heuristicSuggestion.source === "palabra clave" ? 0.74 : 0.67;
    if (confidence >= thresholds.suggestThreshold) {
      return {
        categoryId: null,
        action: "suggest",
        confidence,
        source: heuristicSuggestion.source === "palabra clave" ? "keyword" : "history",
        rule: null,
        suggestion: {
          category_id: heuristicSuggestion.category_id,
          category_name: heuristicSuggestion.category_name,
          source: heuristicSuggestion.source,
          confidence,
          reason: heuristicSuggestion.source === "palabra clave"
            ? "Coincidencia por palabra clave"
            : "Coincidencia por historial reciente",
        },
        categorization_status: "suggested",
        category_source: heuristicSuggestion.source === "palabra clave" ? "keyword" : "history",
        category_confidence: confidence,
        category_rule_id: null,
        reason: heuristicSuggestion.source === "palabra clave"
          ? "Coincidencia por palabra clave"
          : "Coincidencia por historial reciente",
        category: categories.find((item) => item.id === heuristicSuggestion.category_id) || null,
      };
    }
  }

  const llmSuggestion = await suggestCategoryWithOllama(settings, {
    ...tx,
    account_name: options.accountName || null,
    categories,
  });
  if (llmSuggestion?.category_name) {
    const category = categories.find(
      (item) => normalizeText(item.name) === normalizeText(llmSuggestion.category_name)
    );
    if (category) {
      const shouldAuto = llmSuggestion.should_auto && llmSuggestion.confidence >= Math.max(thresholds.autoThreshold, 0.93);
      const canAutoWithOllama = shouldAuto && !ambiguousDescriptorOnly;
      const canSuggest = llmSuggestion.confidence >= thresholds.suggestThreshold;
      return {
        categoryId: canAutoWithOllama ? category.id : null,
        action: canAutoWithOllama ? "auto" : (canSuggest ? "suggest" : "none"),
        confidence: llmSuggestion.confidence,
        source: "ollama",
        rule: null,
        suggestion: canSuggest ? {
          category_id: category.id,
          category_name: category.name,
          source: "ollama",
          confidence: llmSuggestion.confidence,
          reason: llmSuggestion.reason || "Sugerencia de Ollama",
        } : null,
        categorization_status: canAutoWithOllama ? "categorized" : (canSuggest ? "suggested" : "uncategorized"),
        category_source: canAutoWithOllama ? "ollama_auto" : (canSuggest ? "ollama_suggest" : null),
        category_confidence: canSuggest || canAutoWithOllama ? llmSuggestion.confidence : null,
        category_rule_id: null,
        reason: ambiguousDescriptorOnly && canSuggest
          ? "Descriptor financiero ambiguo; se deja como sugerencia"
          : (llmSuggestion.reason || "Clasificacion semantica por Ollama"),
        category,
      };
    }
  }

  return {
    categoryId: null,
    action: "none",
    confidence: 0,
    source: "none",
    rule: null,
    suggestion: null,
    categorization_status: "uncategorized",
    category_source: null,
    category_confidence: null,
    category_rule_id: null,
    reason: "",
    category: null,
  };
}

export async function applyAllRulesRetroactively(db, userId) {
  const rules = await listRules(db, userId);
  let total = 0;
  for (const rule of rules) {
    if (rule.mode !== "auto") continue;
    const result = await db.prepare(
      `UPDATE transactions
       SET category_id = ?,
           categorization_status = 'categorized',
           category_source = 'rule_auto',
           category_confidence = ?,
           category_rule_id = ?
       WHERE category_id IS NULL
         AND user_id = ?
         AND LOWER(desc_banco) LIKE '%' || ? || '%'`
    ).run(rule.category_id, Number(rule.confidence || 0.72), rule.id, userId, rule.normalized_pattern);
    total += result.changes || 0;
  }
  return total;
}
