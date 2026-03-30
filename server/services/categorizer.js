const { buildSeedRules, normalizePatternValue } = require("./taxonomy");

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

const GENERIC_PATTERN_TOKENS = new Set([
  "con", "tarjeta", "compra", "debito", "deb", "credito", "visa", "master", "mastercard",
  "pago", "cuota", "cuotas", "consumo", "local", "comercio", "pos", "web", "online",
  "internacional", "internac", "nacional", "uy", "uru", "cta", "caja", "ahorro",
  "movimiento", "compraweb", "punto", "venta", "servicio", "tc", "titular",
  "mercado", "trip", "one", "viaje"
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
            account_id, currency, direction, merchant_key
     FROM rules
     ORDER BY LENGTH(normalized_pattern) DESC, confidence DESC, match_count DESC, id ASC`
  ).all();
}

function matchesRule(descBanco, rule) {
  const normalizedDesc = normalizePatternValue(descBanco);
  const pattern = rule.normalized_pattern || normalizePatternValue(rule.pattern);
  if (isGenericRulePattern(pattern)) return false;
  return Boolean(pattern) && normalizedDesc.includes(pattern);
}

function findMatchingRule(db, descBanco) {
  return getRules(db).find((rule) => rule.mode !== "disabled" && matchesRule(descBanco, rule)) || null;
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
  return TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw));
}

function bumpRule(db, ruleId) {
  db.prepare(
    "UPDATE rules SET match_count = match_count + 1, last_matched_at = datetime('now') WHERE id = ?"
  ).run(ruleId);
}

function buildPatternFromDescription(descBanco) {
  const tokens = extractMeaningfulPatternTokens(descBanco);
  return normalizePatternValue(tokens.slice(0, 2).join(" ").trim());
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

function ensureRuleForManualCategorization(db, descBanco, categoryId) {
  const normalizedPattern = buildPatternFromDescription(descBanco);
  if (!normalizedPattern || isGenericRulePattern(normalizedPattern)) {
    return { created: false, conflict: false, rule: null };
  }

  const existing = db.prepare(
    `SELECT id, pattern, normalized_pattern, category_id, mode, confidence
     FROM rules
     WHERE normalized_pattern = ?
       AND COALESCE(account_id, '') = ''
       AND COALESCE(currency, '') = ''
       AND direction = 'any'
     LIMIT 1`
  ).get(normalizedPattern);

  if (existing) {
    if (existing.category_id !== Number(categoryId)) {
      return { created: false, conflict: true, rule: existing };
    }
    return { created: false, conflict: false, rule: existing };
  }

  const result = db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, currency, direction, merchant_key, last_matched_at
    ) VALUES (?, ?, ?, 0, 'suggest', 0.82, 'manual', NULL, NULL, 'any', ?, NULL)`
  ).run(normalizedPattern, normalizedPattern, Number(categoryId), normalizedPattern);

  const candidates = findCandidatesForRule(db, normalizedPattern);
  return {
    created: true,
    conflict: false,
    candidates_count: candidates.length,
    rule: { id: result.lastInsertRowid, pattern: normalizedPattern, normalized_pattern: normalizedPattern, category_id: Number(categoryId) }
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
      account_id, currency, direction, merchant_key, last_matched_at
    ) VALUES (?, ?, ?, 0, ?, ?, 'seed', NULL, NULL, ?, ?, NULL)`
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
        rule.merchant_key
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
  findCandidatesForRule,
  findMatchingRule,
  getCandidatesForPattern,
  isLikelyReintegro,
  isLikelyTransfer,
};
