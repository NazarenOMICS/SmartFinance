export async function findMatchingRule(db, descBanco) {
  const normalized = String(descBanco || "").toLowerCase();
  const rules = await db.prepare(
    "SELECT id, pattern, category_id, match_count FROM rules ORDER BY match_count DESC, id ASC"
  ).all();
  return rules.find((rule) => normalized.includes(rule.pattern.toLowerCase())) || null;
}

export async function bumpRule(db, ruleId) {
  return db.prepare("UPDATE rules SET match_count = match_count + 1 WHERE id = ?").run(ruleId);
}

function buildPatternFromDescription(descBanco) {
  const stopwords = new Set(["pos", "compra", "debito", "deb", "automatico", "transferencia", "recibida", "pago", "cuota", "trip"]);
  const cleaned = String(descBanco || "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{4,}\b/g, " ")   // remove long numbers (reference IDs) but keep short ones
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2 && !stopwords.has(t));
  return tokens.slice(0, 2).join(" ").trim() || cleaned.split(" ").slice(0, 2).join(" ").trim();
}

// Apply a rule retroactively to all uncategorized transactions that match it
async function applyRuleRetroactively(db, pattern, categoryId) {
  const result = await db.prepare(
    `UPDATE transactions SET category_id = ?
     WHERE category_id IS NULL AND LOWER(desc_banco) LIKE '%' || LOWER(?) || '%'`
  ).run(categoryId, pattern);
  return result.changes || 0;
}

export async function ensureRuleForManualCategorization(db, descBanco, categoryId) {
  // Check if any existing rule's pattern is contained in this description
  const existing = await db.prepare(
    `SELECT id, pattern, category_id FROM rules
     WHERE INSTR(LOWER(?), LOWER(pattern)) > 0 LIMIT 1`
  ).get(descBanco);

  if (existing) {
    if (existing.category_id !== Number(categoryId)) {
      return { created: false, conflict: true, rule: existing };
    }
    return { created: false, conflict: false, rule: existing };
  }

  const pattern = buildPatternFromDescription(descBanco);
  if (!pattern) return { created: false, conflict: false, rule: null };

  const result = await db.prepare(
    "INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)"
  ).run(pattern, categoryId);

  // Apply retroactively to existing uncategorized transactions
  const retroCount = await applyRuleRetroactively(db, pattern, categoryId);

  return {
    created: true, conflict: false,
    rule: { id: result.lastInsertRowid, pattern, category_id: Number(categoryId) },
    retro_count: retroCount
  };
}

// Apply all existing rules to a batch of uncategorized transactions (called after manual rule creation)
export async function applyAllRulesRetroactively(db) {
  const rules = await db.prepare("SELECT id, pattern, category_id FROM rules ORDER BY match_count DESC").all();
  let total = 0;
  for (const rule of rules) {
    const result = await db.prepare(
      `UPDATE transactions SET category_id = ?
       WHERE category_id IS NULL AND LOWER(desc_banco) LIKE '%' || LOWER(?) || '%'`
    ).run(rule.category_id, rule.pattern);
    total += result.changes || 0;
  }
  return total;
}
