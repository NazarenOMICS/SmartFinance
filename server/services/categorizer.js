const { buildSeedRules, normalizePatternValue, matchCanonicalCategory } = require("./taxonomy");
const { normalizeBankDescription, extractMerchant, classifyTransaction: classifyTxDomain } = require("../vendor/categorization");

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
  "transferencia inmediata",
  "transferencia realizada",
  "transf recibida",
  "debito debin",
  "credito debin",
];

const PERSON_TRANSFER_KEYWORDS = [
  "transferencia enviada",
  "transferencia inmediata a ",
  "transferencia realizada a ",
  "transf recibida ",
  "trf plaza",
  "trf. plaza",
  "t--/",
  "tregalo",
  "tesitore fernandez",
];

const SUPERNET_INCOME_KEYWORDS = [
  "credito por operacion en supernet p--/",
  "credito por operacion en supernet p ",
  "credito por operacion en supernet p-/",
];

const EDUCATION_HINTS = [
  "educuniversida",
  "educacion universitaria",
  "cuota ort",
  "ort centro",
  " universidad ",
  " facultad ",
];

const CARD_PURCHASE_HINTS = [
  "compra con tarjeta",
  "compra tarjeta",
  "compra con debito",
  "compra con credito",
  "compra internacional",
  "dlo.",
];

function hasCommercePurchaseContext(descBanco) {
  const normalized = normalizePatternValue(descBanco);
  if (CARD_PURCHASE_HINTS.some((item) => normalized.includes(normalizePatternValue(item)))) {
    return true;
  }
  const canonicalMatch = matchCanonicalCategory(descBanco);
  return Boolean(
    canonicalMatch &&
    !["transferencia", "ingreso", "reintegro", "otros"].includes(canonicalMatch.category.slug)
  );
}

const GENERIC_PATTERN_TOKENS = new Set([
  "con", "tarjeta", "compra", "debito", "deb", "credito", "visa", "master", "mastercard",
  "pago", "cuota", "cuotas", "consumo", "local", "comercio", "pos", "web", "online",
  "internacional", "internac", "nacional", "uy", "uru", "cta", "caja", "ahorro",
  "movimiento", "compraweb", "punto", "venta", "servicio", "tc", "titular",
  "mercado", "trip", "one", "viaje", "operacion", "supernet", "sms", "comision"
]);

function extractMeaningfulPatternTokens(descBanco) {
  const cleaned = normalizePatternValue(descBanco).replace(/\b\d{4,}\b/g, " ");
  return cleaned
    .split(" ")
    .filter((item) => item.length >= 3 && !GENERIC_PATTERN_TOKENS.has(item));
}

function isGenericRulePattern(pattern) {
  const tokens = normalizePatternValue(pattern).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => token.length < 3 || GENERIC_PATTERN_TOKENS.has(token));
}

function getRules(db) {
  return db.prepare(
    `SELECT id, pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
            account_id, currency, direction, merchant_key, merchant_scope, account_scope, currency_scope, last_matched_at
     FROM rules
     ORDER BY merchant_key IS NULL ASC, confidence DESC, match_count DESC, last_matched_at DESC, id ASC`
  ).all();
}

function getMerchantDictionary(db) {
  return db.prepare(
    `SELECT merchant_key, display_name, aliases_json, default_category_id, origin
     FROM merchant_dictionary
     ORDER BY origin = 'learned' DESC, LENGTH(merchant_key) DESC`
  ).all();
}

function getRuleRejectionsForDescription(db, descBanco) {
  const normalizedDescription = normalizePatternValue(descBanco);
  if (!normalizedDescription) return [];
  return db.prepare(
    `SELECT rule_id, transaction_id, desc_banco_normalized
     FROM rule_rejections
     WHERE ? LIKE '%' || desc_banco_normalized || '%'`
  ).all(normalizedDescription);
}

function matchesRule(descBanco, rule) {
  const normalizedDesc = normalizePatternValue(descBanco);
  const pattern = rule.normalized_pattern || normalizePatternValue(rule.pattern);
  if (isGenericRulePattern(pattern)) return false;
  return Boolean(pattern) && normalizedDesc.includes(pattern);
}

function normalizeDescription(descBanco) {
  return String(descBanco || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function rejectRuleForDescription(db, ruleId, descBanco) {
  const normalizedDescription = normalizeDescription(descBanco);
  if (!ruleId || !normalizedDescription) {
    return null;
  }

  db.prepare(
    `
    INSERT INTO rule_rejections (rule_id, desc_banco_normalized)
    VALUES (?, ?)
    ON CONFLICT(rule_id, desc_banco_normalized) DO NOTHING
  `
  ).run(ruleId, normalizedDescription);

  db.prepare(
    `
    UPDATE rules
    SET confidence = MAX(0.25, confidence - 0.12),
        mode = CASE WHEN mode = 'auto' THEN 'suggest' ELSE mode END,
        updated_at = datetime('now')
    WHERE id = ?
  `
  ).run(ruleId);

  return { rule_id: Number(ruleId), desc_banco_normalized: normalizedDescription };
}

function isRuleRejectedForDescription(db, ruleId, descBanco) {
  const normalizedDescription = normalizeDescription(descBanco);
  if (!ruleId || !normalizedDescription) {
    return false;
  }

  const existing = db
    .prepare(
      `
      SELECT id
      FROM rule_rejections
      WHERE rule_id = ? AND desc_banco_normalized = ?
      LIMIT 1
    `
    )
    .get(ruleId, normalizedDescription);

  return Boolean(existing);
}

function findMatchingRule(db, descBanco) {
  const rules = getRules(db);
  const decision = classifyTxDomain(
    { desc_banco: descBanco, monto: -1, moneda: null, account_id: null },
    rules,
    getRuleRejectionsForDescription(db, descBanco),
    {},
    getMerchantDictionary(db)
  );
  return decision.matchedRule || null;
}

function isLikelyReintegro(db, descBanco, monto, moneda) {
  if (monto <= 0) return false;
  const normalized = normalizePatternValue(descBanco);
  if (REINTEGRO_KEYWORDS.some((kw) => normalized.includes(kw))) return true;

  const threshold = REINTEGRO_THRESHOLDS[moneda] ?? REINTEGRO_THRESHOLDS.UYU;
  if (monto < threshold) {
    const rule = findMatchingRule(db, descBanco);
    if (rule) {
      const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(rule.category_id);
      if (cat?.name === "Ingreso") return false;
    }
    return true;
  }

  return false;
}

function isLikelyTransfer(descBanco) {
  const normalized = normalizePatternValue(descBanco);
  if (hasCommercePurchaseContext(descBanco)) return false;
  return TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw));
}

function isLikelyPersonTransfer(descBanco) {
  const normalized = normalizePatternValue(descBanco);
  if (hasCommercePurchaseContext(descBanco)) return false;
  if (normalized.includes("credito por operacion en supernet")) return false;
  return PERSON_TRANSFER_KEYWORDS.some((kw) => normalized.includes(normalizePatternValue(kw)));
}

function isLikelySupernetIncome(descBanco, monto) {
  if (Number(monto) <= 0) return false;
  const normalized = normalizePatternValue(descBanco);
  if (!normalized.includes("credito por operacion en supernet")) return false;
  return SUPERNET_INCOME_KEYWORDS.some((kw) => normalized.includes(normalizePatternValue(kw)));
}

function isLikelyEducation(descBanco) {
  const normalized = ` ${normalizePatternValue(descBanco)} `;
  return EDUCATION_HINTS.some((kw) => normalized.includes(normalizePatternValue(kw)));
}

function bumpRule(db, ruleId) {
  db.prepare(
    `UPDATE rules
     SET match_count = match_count + 1,
         confidence = CASE
           WHEN source IN ('manual', 'learned') THEN MIN(0.99, confidence + 0.01)
           ELSE confidence
         END,
         last_matched_at = datetime('now')
     WHERE id = ?`
  ).run(ruleId);
}

function buildPatternFromDescription(descBanco) {
  const tokens = extractMeaningfulPatternTokens(descBanco);
  return normalizePatternValue(tokens.slice(0, 2).join(" ").trim());
}

function extractMerchantKey(descBanco) {
  const result = extractMerchant(descBanco, []);
  return result.merchant_key;
}

function findCandidatesForRule(db, pattern) {
  const normalizedPattern = normalizePatternValue(pattern);
  return db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.monto, t.moneda, a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.categorization_status != 'categorized'
       AND LOWER(t.desc_banco) LIKE '%' || ? || '%'
     ORDER BY t.fecha DESC
     LIMIT 50`
  ).all(normalizedPattern);
}

function getCandidatesForPattern(db, pattern) {
  return findCandidatesForRule(db, pattern);
}

function ensureRuleForManualCategorization(db, transactionOrDescription, categoryId, scopePreference = null) {
  const transaction = typeof transactionOrDescription === "string"
    ? { desc_banco: transactionOrDescription, monto: -1, moneda: null, account_id: null }
    : transactionOrDescription;
  const merchantKey = extractMerchantKey(transaction.desc_banco);
  if (!merchantKey) {
    return { created: false, conflict: false, rule: null, skipped: true, skipped_reason: "generic_or_empty_merchant" };
  }

  const normalizedPattern = merchantKey;
  const useAccountScope = scopePreference === "account" || (!scopePreference && transaction.account_id);
  const accountId = useAccountScope ? (transaction.account_id || null) : null;
  const currency = transaction.moneda || null;
  const direction = Number(transaction.monto || 0) >= 0 ? "income" : "expense";
  const before = db.prepare(
    `SELECT id, category_id
     FROM rules
     WHERE merchant_scope = ?
       AND account_scope = ?
       AND currency_scope = ?
       AND direction = ?
     LIMIT 1`
  ).get(merchantKey, accountId || "", currency || "", direction);

  db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, account_scope, currency, currency_scope, direction, merchant_key, merchant_scope, last_matched_at, updated_at
    ) VALUES (?, ?, ?, 1, 'auto', 0.9, 'manual', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(merchant_scope, account_scope, currency_scope, direction)
    DO UPDATE SET
      category_id = excluded.category_id,
      pattern = excluded.pattern,
      normalized_pattern = excluded.normalized_pattern,
      merchant_key = excluded.merchant_key,
      match_count = rules.match_count + 1,
      confidence = MAX(rules.confidence, excluded.confidence),
      source = 'manual',
      last_matched_at = datetime('now'),
      updated_at = datetime('now')`
  ).run(
    normalizedPattern.toUpperCase(),
    normalizedPattern,
    Number(categoryId),
    accountId,
    accountId || "",
    currency,
    currency || "",
    direction,
    merchantKey,
    merchantKey
  );

  const rule = db.prepare(
    `SELECT id, pattern, normalized_pattern, category_id, mode, confidence, source,
            account_id, currency, direction, merchant_key
     FROM rules
     WHERE merchant_scope = ? AND account_scope = ? AND currency_scope = ? AND direction = ?
     LIMIT 1`
  ).get(merchantKey, accountId || "", currency || "", direction);

  db.prepare(
    `INSERT INTO merchant_dictionary (merchant_key, display_name, aliases_json, default_category_id, origin, updated_at)
     VALUES (?, ?, ?, ?, 'learned', datetime('now'))
     ON CONFLICT(merchant_key)
     DO UPDATE SET
       display_name = excluded.display_name,
       aliases_json = excluded.aliases_json,
       default_category_id = excluded.default_category_id,
       origin = CASE WHEN merchant_dictionary.origin = 'seed' THEN 'seed' ELSE 'learned' END,
       updated_at = datetime('now')`
  ).run(
    merchantKey,
    normalizedPattern.toUpperCase(),
    JSON.stringify([...new Set([merchantKey, normalizePatternValue(transaction.desc_banco)].filter(Boolean))]),
    Number(categoryId)
  );

  const candidates = findCandidatesForRule(db, normalizedPattern);
  return {
    created: !before,
    conflict: Boolean(before && before.category_id !== Number(categoryId)),
    candidates_count: candidates.length,
    rule
  };
}

function applyRuleRetroactively(db, pattern, categoryId) {
  const normalizedPattern = normalizePatternValue(pattern);
  const result = db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = 'categorized',
         category_source = 'rule_auto',
         category_confidence = 0.82,
         category_rule_id = NULL
     WHERE categorization_status != 'categorized'
       AND LOWER(desc_banco) LIKE '%' || ? || '%'`
  ).run(Number(categoryId), normalizedPattern);
  return result.changes;
}

function ensureDefaultRules(db) {
  const categories = db.prepare("SELECT id, slug FROM categories").all();
  const bySlug = new Map(categories.map((row) => [row.slug, row.id]));
  db.prepare("DELETE FROM rules WHERE source = 'seed'").run();

  const insert = db.prepare(
    `INSERT OR IGNORE INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, account_scope, currency, currency_scope, direction, merchant_key, merchant_scope, last_matched_at, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, 'seed', NULL, '', NULL, '', ?, ?, ?, NULL, datetime('now'))`
  );

  const tx = db.transaction((rules) => {
    for (const rule of rules) {
      const categoryId = bySlug.get(rule.slug);
      if (!categoryId) continue;
      insert.run(
        rule.pattern,
        rule.normalized_pattern,
        categoryId,
        rule.mode,
        rule.confidence,
        rule.direction,
        rule.merchant_key,
        rule.merchant_key || rule.normalized_pattern
      );
    }
  });

  tx(buildSeedRules());
}

module.exports = {
  applyRuleRetroactively,
  buildPatternFromDescription,
  bumpRule,
  ensureDefaultRules,
  ensureRuleForManualCategorization,
  extractMerchantKey,
  findCandidatesForRule,
  findMatchingRule,
  getCandidatesForPattern,
  isLikelyEducation,
  isLikelyReintegro,
  isLikelyPersonTransfer,
  isLikelySupernetIncome,
  isLikelyTransfer,
  normalizeDescription,
  rejectRuleForDescription,
};
