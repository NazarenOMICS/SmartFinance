// Smart suggestion engine for uncategorized transactions
// Priority: 1) existing rules, 2) taxonomy keywords, 3) historical similarity
import { CANONICAL_CATEGORIES, normalizeText } from "./taxonomy.js";

/**
 * Suggest a category from keyword dictionary.
 * Returns { category_name, source } or null.
 */
function suggestFromKeywords(descBanco) {
  const desc = normalizeText(descBanco);
  for (const category of CANONICAL_CATEGORIES) {
    for (const kw of category.keywords || []) {
      if (desc.includes(normalizeText(kw))) {
        return { category_name: category.name, source: "keyword" };
      }
    }
  }
  return null;
}

/**
 * Extract meaningful words (4+ chars, no digits) from a description.
 */
function meaningfulWords(desc) {
  return String(desc || "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/\d/.test(w));
}

/**
 * Suggest a category from transaction history (most common category among similar transactions).
 * Returns { category_name, category_id, source, confidence } or null.
 */
async function suggestFromHistory(db, descBanco, userId = null) {
  const words = meaningfulWords(descBanco);
  if (words.length === 0) return null;

  // Build a query that finds categorized transactions sharing words with this desc
  // Use top-3 words max to keep the query manageable
  const topWords = words.slice(0, 3);
  const conditions = topWords.map(() => "LOWER(t.desc_banco) LIKE ?").join(" OR ");
  const params = topWords.map((w) => `%${w}%`);

  const whereUser = userId ? "AND t.user_id = ?" : "";
  const rows = await db.prepare(
    `SELECT c.id AS category_id, c.name AS category_name, COUNT(*) AS cnt
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.category_id IS NOT NULL ${whereUser} AND (${conditions})
     GROUP BY c.id
     ORDER BY cnt DESC
     LIMIT 1`
  ).get(...(userId ? [userId, ...params] : params));

  if (!rows || rows.cnt < 1) return null;

  return {
    category_id: rows.category_id,
    category_name: rows.category_name,
    source: "historial",
    confidence: rows.cnt,
  };
}

/**
 * Async suggest using DB history. Returns a suggestion object or null.
 * categories: array of { id, name } from DB (to resolve keyword→id).
 */
export async function suggest(db, descBanco, categories, userId = null) {
  // 1. Try keyword match
  const kwMatch = suggestFromKeywords(descBanco);
  if (kwMatch) {
    const cat = categories.find(
      (c) => c.name.toLowerCase() === kwMatch.category_name.toLowerCase()
    );
    if (cat) {
      return { category_id: cat.id, category_name: cat.name, source: "palabra clave" };
    }
  }

  // 2. Try history match
  const histMatch = await suggestFromHistory(db, descBanco, userId);
  if (histMatch) {
    return { category_id: histMatch.category_id, category_name: histMatch.category_name, source: "historial" };
  }

  return null;
}

/**
 * Synchronous suggest using pre-fetched rules + categories arrays.
 * Attaches a `suggestion` field to the transaction object if uncategorized.
 *
 * @param {object} tx         - transaction row
 * @param {Array}  rules      - pre-fetched rules (id, pattern, category_id)
 * @param {Array}  categories - pre-fetched categories (id, name)
 * @returns {object} tx (optionally with .suggestion)
 */
export function suggestSync(tx, rules, categories) {
  if (tx.categorization_status === "categorized") return tx;

  // 1. Rule match (exact substring, same priority as categorizer)
  const matchedRule = rules.find(
    (r) => r.mode !== "disabled" && tx.desc_banco.toLowerCase().includes(r.pattern.toLowerCase())
  );
  if (matchedRule) {
    const cat = categories.find((c) => c.id === matchedRule.category_id);
    return {
      ...tx,
      suggestion: {
        category_id: matchedRule.category_id,
        category_name: cat?.name || null,
        source: "regla",
        confidence: matchedRule.confidence ?? null,
      }
    };
  }

  // 2. Keyword match (same dictionary as async version)
  const kwMatch = suggestFromKeywords(tx.desc_banco);
  if (kwMatch) {
    const cat = categories.find(
      (c) => c.name.toLowerCase() === kwMatch.category_name.toLowerCase()
    );
    if (cat) {
      return { ...tx, suggestion: { category_id: cat.id, category_name: cat.name, source: "palabra clave" } };
    }
  }

  return tx;
}
