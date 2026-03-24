function getRules(db) {
  return db
    .prepare(
      `
      SELECT id, pattern, category_id, match_count
      FROM rules
      ORDER BY match_count DESC, id ASC
    `
    )
    .all();
}

function findMatchingRule(db, descBanco) {
  const normalized = String(descBanco || "").toLowerCase();
  return getRules(db).find((rule) => normalized.includes(rule.pattern.toLowerCase())) || null;
}

function bumpRule(db, ruleId) {
  db.prepare("UPDATE rules SET match_count = match_count + 1 WHERE id = ?").run(ruleId);
}

function buildPatternFromDescription(descBanco) {
  const stopwords = new Set([
    "pos",
    "compra",
    "debito",
    "deb",
    "automatico",
    "transferencia",
    "recibida",
    "pago",
    "cuota",
    "trip"
  ]);

  const cleaned = String(descBanco || "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .map((token) => token.toLowerCase())
    .filter((token) => token && !stopwords.has(token));

  return tokens.slice(0, 2).join(" ").trim() || cleaned.split(" ").slice(0, 2).join(" ").trim();
}

function ensureRuleForManualCategorization(db, descBanco, categoryId) {
  const existing = db
    .prepare(
      `
      SELECT id, pattern, category_id
      FROM rules
      WHERE ? LIKE '%' || pattern || '%'
         OR LOWER(?) LIKE '%' || LOWER(pattern) || '%'
      LIMIT 1
    `
    )
    .get(descBanco, descBanco);

  if (existing) {
    if (existing.category_id !== Number(categoryId)) {
      return { created: false, conflict: true, rule: existing };
    }
    return { created: false, conflict: false, rule: existing };
  }

  const pattern = buildPatternFromDescription(descBanco);
  if (!pattern) {
    return { created: false, conflict: false, rule: null };
  }

  const result = db
    .prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)")
    .run(pattern, categoryId);

  return { created: true, conflict: false, rule: { id: result.lastInsertRowid, pattern, category_id: Number(categoryId) } };
}

module.exports = {
  buildPatternFromDescription,
  bumpRule,
  ensureRuleForManualCategorization,
  findMatchingRule
};

