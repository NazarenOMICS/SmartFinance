export async function findMatchingRule(db, descBanco, userId) {
  const normalized = String(descBanco || "").toLowerCase();
  const rules = await db.prepare(
    "SELECT id, pattern, category_id, match_count FROM rules WHERE user_id = ? ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC"
  ).all(userId);
  return rules.find((rule) => normalized.includes(rule.pattern.toLowerCase())) || null;
}

export async function bumpRule(db, ruleId) {
  return db.prepare("UPDATE rules SET match_count = match_count + 1 WHERE id = ?").run(ruleId);
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
  const normalized = String(descBanco || "").toLowerCase();
  return TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw));
}

export async function isLikelyReintegro(db, descBanco, monto, moneda, userId) {
  if (monto <= 0) return false;

  const normalized = String(descBanco || "").toLowerCase();
  if (REINTEGRO_KEYWORDS.some((kw) => normalized.includes(kw))) return true;

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

function buildPatternFromDescription(descBanco) {
  const stopwords = new Set(["pos", "compra", "debito", "deb", "automatico", "transferencia", "recibida", "pago", "cuota", "trip"]);
  const cleaned = String(descBanco || "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 2 && !stopwords.has(t));
  return tokens.slice(0, 2).join(" ").trim() || cleaned.split(" ").slice(0, 2).join(" ").trim();
}

export async function findCandidatesForRule(db, pattern, categoryId, userId) {
  return db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.monto, t.moneda,
            a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.user_id = ?
       AND t.category_id IS NULL
       AND LOWER(t.desc_banco) LIKE '%' || LOWER(?) || '%'
     ORDER BY t.fecha DESC
     LIMIT 50`
  ).all(userId, pattern);
}

export async function getCandidatesForPattern(db, pattern, categoryId, userId) {
  return findCandidatesForRule(db, pattern, categoryId, userId);
}

export async function ensureRuleForManualCategorization(db, descBanco, categoryId, userId) {
  const existing = await db.prepare(
    `SELECT id, pattern, category_id FROM rules
     WHERE user_id = ? AND INSTR(LOWER(?), LOWER(pattern)) > 0
     ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC
     LIMIT 1`
  ).get(userId, descBanco);

  if (existing) {
    if (existing.category_id !== Number(categoryId)) {
      return { created: false, conflict: true, rule: existing };
    }
    return { created: false, conflict: false, rule: existing };
  }

  const pattern = buildPatternFromDescription(descBanco);
  if (!pattern) return { created: false, conflict: false, rule: null };

  const result = await db.prepare(
    "INSERT INTO rules (pattern, category_id, match_count, user_id) VALUES (?, ?, 0, ?)"
  ).run(pattern, categoryId, userId);
  const candidates = await findCandidatesForRule(db, pattern, categoryId, userId);

  return {
    created: true, conflict: false,
    rule: { id: result.lastInsertRowid, pattern, category_id: Number(categoryId) },
    candidates_count: candidates.length
  };
}

export async function applyAllRulesRetroactively(db, userId) {
  const rules = await db.prepare(
    "SELECT id, pattern, category_id FROM rules WHERE user_id = ? ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC"
  ).all(userId);
  let total = 0;
  for (const rule of rules) {
    const result = await db.prepare(
      `UPDATE transactions SET category_id = ?
       WHERE category_id IS NULL AND user_id = ? AND LOWER(desc_banco) LIKE '%' || LOWER(?) || '%'`
    ).run(rule.category_id, userId, rule.pattern);
    total += result.changes || 0;
  }
  return total;
}

