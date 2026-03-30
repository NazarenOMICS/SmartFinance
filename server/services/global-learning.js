const crypto = require("crypto");
const { normalizePatternValue, normalizeText } = require("./taxonomy");

const GLOBAL_USER_PEPPER = "smartfinance-global-learning-v1";
const GENERIC_GLOBAL_TOKENS = new Set([
  "compra", "pago", "tarjeta", "debito", "credito", "transferencia", "transf",
  "operacion", "banco", "online", "local", "comercio", "cuota", "cuotas",
  "mercado", "detalle", "consulta", "varios", "tarj", "nro", "numero",
]);
const EXCLUDED_CATEGORY_SLUGS = new Set(["transferencia", "reintegro", "ingreso", "otros"]);
const AMBIGUOUS_GLOBAL_HINTS = [
  "mercado pago", "merpago", "prex", "redpagos", "abitab", "personal pay", "oca blue",
];

function sanitizeGlobalPattern(descBanco = "") {
  const normalized = normalizeText(descBanco)
    .replace(/\b\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  if (AMBIGUOUS_GLOBAL_HINTS.some((item) => normalized.includes(item))) return null;

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !GENERIC_GLOBAL_TOKENS.has(token));
  if (tokens.length === 0) return null;

  const candidate = normalizePatternValue(tokens.slice(0, 3).join(" "));
  if (!candidate || candidate.length < 4) return null;
  if (/^[a-z]{1,3}$/.test(candidate)) return null;
  return candidate;
}

function fingerprintUser(userId = "local-user") {
  return crypto.createHash("sha256").update(`${GLOBAL_USER_PEPPER}:${String(userId)}`).digest("hex");
}

function getCategorySlug(db, categoryId) {
  if (!categoryId) return null;
  const row = db.prepare("SELECT slug FROM categories WHERE id = ?").get(Number(categoryId));
  const slug = String(row?.slug || "").trim();
  return slug || null;
}

function maybePromoteGlobalAlias(db, normalizedPattern, categorySlug) {
  const candidate = db.prepare(
    `SELECT id, user_count, confirm_count, reject_count, confidence_score
     FROM global_pattern_candidates
     WHERE normalized_pattern = ? AND category_slug = ?
     LIMIT 1`
  ).get(normalizedPattern, categorySlug);
  if (!candidate) return;

  const shouldApprove =
    Number(candidate.user_count || 0) >= 3 &&
    Number(candidate.confirm_count || 0) >= 5 &&
    Number(candidate.reject_count || 0) === 0 &&
    Number(candidate.confidence_score || 0) >= 0.9;

  if (!shouldApprove) return;

  db.prepare(
    `INSERT INTO global_pattern_aliases (normalized_pattern, category_slug, source, updated_at)
     VALUES (?, ?, 'auto_approved', datetime('now'))
     ON CONFLICT(normalized_pattern) DO UPDATE
     SET category_slug = excluded.category_slug,
         source = excluded.source,
         updated_at = excluded.updated_at`
  ).run(normalizedPattern, categorySlug);

  db.prepare(
    `UPDATE global_pattern_candidates
     SET status = 'approved', last_seen_at = datetime('now')
     WHERE normalized_pattern = ? AND category_slug = ?`
  ).run(normalizedPattern, categorySlug);
}

function recordGlobalPatternLearning(db, userId, descBanco, categoryId, decision = "confirm") {
  const categorySlug = getCategorySlug(db, categoryId);
  if (!categorySlug || EXCLUDED_CATEGORY_SLUGS.has(categorySlug)) return null;

  const normalizedPattern = sanitizeGlobalPattern(descBanco);
  if (!normalizedPattern) return null;

  const safeDecision = decision === "reject" ? "reject" : "confirm";
  const userFingerprint = fingerprintUser(userId);

  db.prepare(
    `INSERT INTO global_pattern_candidates (
      normalized_pattern, category_slug, sample_count, user_count, confirm_count, reject_count,
      confidence_score, status, last_seen_at
    )
     VALUES (?, ?, 0, 0, 0, 0, 0, 'pending', datetime('now'))
     ON CONFLICT(normalized_pattern, category_slug) DO UPDATE
     SET last_seen_at = datetime('now')`
  ).run(normalizedPattern, categorySlug);

  const candidate = db.prepare(
    `SELECT id, confirm_count, reject_count, sample_count
     FROM global_pattern_candidates
     WHERE normalized_pattern = ? AND category_slug = ?
     LIMIT 1`
  ).get(normalizedPattern, categorySlug);
  if (!candidate) return null;

  db.prepare(
    `INSERT INTO global_pattern_candidate_users (candidate_id, user_fingerprint, last_decision)
     VALUES (?, ?, ?)
     ON CONFLICT(candidate_id, user_fingerprint) DO UPDATE
     SET last_decision = excluded.last_decision,
         last_seen_at = datetime('now')`
  ).run(candidate.id, userFingerprint, safeDecision);

  const userCountRow = db.prepare(
    "SELECT COUNT(*) AS count FROM global_pattern_candidate_users WHERE candidate_id = ?"
  ).get(candidate.id);

  const nextConfirmCount = Number(candidate.confirm_count || 0) + (safeDecision === "confirm" ? 1 : 0);
  const nextRejectCount = Number(candidate.reject_count || 0) + (safeDecision === "reject" ? 1 : 0);
  const nextSampleCount = Number(candidate.sample_count || 0) + 1;
  const totalSignals = nextConfirmCount + nextRejectCount;
  const nextConfidenceScore = totalSignals > 0 ? nextConfirmCount / totalSignals : 0;

  db.prepare(
    `UPDATE global_pattern_candidates
     SET sample_count = ?,
         user_count = ?,
         confirm_count = ?,
         reject_count = ?,
         confidence_score = ?,
         last_seen_at = datetime('now')
     WHERE id = ?`
  ).run(
    nextSampleCount,
    Number(userCountRow?.count || 0),
    nextConfirmCount,
    nextRejectCount,
    nextConfidenceScore,
    candidate.id
  );

  if (safeDecision === "confirm") {
    maybePromoteGlobalAlias(db, normalizedPattern, categorySlug);
  }

  return { normalizedPattern, categorySlug, decision: safeDecision };
}

function findGlobalAliasMatch(db, descBanco) {
  const normalizedDesc = normalizePatternValue(descBanco);
  if (!normalizedDesc) return null;
  return db.prepare(
    `SELECT normalized_pattern, category_slug
     FROM global_pattern_aliases
     WHERE ? LIKE '%' || normalized_pattern || '%'
     ORDER BY LENGTH(normalized_pattern) DESC
     LIMIT 1`
  ).get(normalizedDesc);
}

module.exports = {
  recordGlobalPatternLearning,
  findGlobalAliasMatch,
};
