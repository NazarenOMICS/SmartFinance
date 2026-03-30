const {
  CANONICAL_CATEGORIES,
  hasAmbiguousMerchantHint,
  matchCanonicalCategory,
  normalizePatternValue,
  normalizeText,
} = require("./taxonomy");

const REVIEWABLE_SLUGS = new Set([
  "transporte",
  "supermercado",
  "delivery",
  "comer_afuera",
  "streaming",
  "telefonia",
  "salud",
  "suscripciones",
  "gimnasio",
  "mascotas",
]);

const GUIDED_REVIEWABLE_SLUGS = new Set([
  "transporte",
  "supermercado",
  "delivery",
  "comer_afuera",
  "streaming",
  "telefonia",
  "salud",
  "suscripciones",
]);

const GENERIC_GUIDED_KEYWORDS = new Set([
  "supermercado",
  "delivery",
  "restaurant",
  "restaurante",
  "cafeteria",
  "cafe",
  "bar",
  "farmacia",
  "telefono",
  "movil",
  "celular",
  "internet",
  "servicio",
  "agua",
  "luz",
  "suscripcion",
  "gym",
  "gimnasio",
  "fitness",
]);

const GUIDED_REASON_BY_SLUG = {
  transporte: "Merchant claro de transporte",
  supermercado: "Merchant claro de supermercado",
  delivery: "Patron moderno de delivery",
  comer_afuera: "Merchant claro para comer afuera",
  streaming: "Suscripcion digital muy reconocible",
  telefonia: "Proveedor claro de telefonia o conectividad",
  salud: "Merchant claro de salud o farmacia",
  suscripciones: "Suscripcion digital muy reconocible",
};

const OBVIOUS_AUTO_KEYWORDS = new Set([
  "uber",
  "uber trip",
  "cabify",
  "bolt",
  "didi",
  "frog",
  "el dorado",
  "tienda inglesa",
  "disco",
  "devoto",
  "pedidosya",
  "rappi",
  "starbucks",
  "mcdonald",
  "mcdonalds",
  "burger king",
  "mostaza",
  "la pasiva",
  "cafe misterio",
  "netflix",
  "spotify",
  "disney",
  "disney+",
  "hbo",
  "hbo max",
  "prime video",
  "youtube premium",
  "antel",
  "movistar",
  "claro",
  "farmashop",
  "san roque",
  "chatgpt",
  "openai",
  "steam",
  "playstation",
  "google play",
  "google one",
  "ute",
  "ose",
]);

function matchSmartCategoryTemplate(descBanco) {
  const match = matchCanonicalCategory(descBanco);
  if (!match || !REVIEWABLE_SLUGS.has(match.category.slug)) return null;
  return {
    template: {
      key: match.category.slug,
      name: match.category.name,
      budget: match.category.budget,
      type: match.category.type,
      color: match.category.color,
      slug: match.category.slug,
    },
    keyword: match.keyword,
  };
}

function ensureSmartCategoriesForTransactions(db, transactions) {
  const existingCategories = db.prepare("SELECT id, name, slug FROM categories").all();
  const bySlug = Object.fromEntries(existingCategories.map((row) => [row.slug || normalizeText(row.name).replace(/\s+/g, "_"), row]));
  const byName = Object.fromEntries(existingCategories.map((row) => [normalizeText(row.name), row]));

  for (const category of CANONICAL_CATEGORIES.filter((item) => REVIEWABLE_SLUGS.has(item.slug))) {
    if (bySlug[category.slug]) continue;
    if (byName[normalizeText(category.name)]) {
      bySlug[category.slug] = { ...byName[normalizeText(category.name)], slug: category.slug };
      continue;
    }
    db.prepare(
      `INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order, slug, origin)
       VALUES (?, ?, ?, ?, ?, ?, 'seed')`
    ).run(category.name, category.budget, category.type, category.color, category.sort_order, category.slug);
    const inserted = db.prepare(
      "SELECT id, name, slug FROM categories WHERE slug = ? OR name = ? COLLATE NOCASE ORDER BY id ASC LIMIT 1"
    ).get(category.slug, category.name);
    if (inserted) {
      bySlug[category.slug] = { id: inserted.id, name: inserted.name, slug: inserted.slug || category.slug };
    }
  }

  return bySlug;
}

function createReviewGroupTracker() {
  return new Map();
}

function isGuidedKeyword(keyword) {
  const normalizedKeyword = normalizeText(keyword);
  return Boolean(normalizedKeyword) && normalizedKeyword.length >= 4 && !GENERIC_GUIDED_KEYWORDS.has(normalizedKeyword);
}

function buildGuidedMetadata(match, tx) {
  const normalizedKeyword = normalizeText(match.keyword);
  if (!GUIDED_REVIEWABLE_SLUGS.has(match.template.slug)) return null;
  if (!isGuidedKeyword(normalizedKeyword)) return null;
  if (hasAmbiguousMerchantHint(tx.desc_banco)) return null;

  const priority = OBVIOUS_AUTO_KEYWORDS.has(normalizedKeyword) ? "high" : "medium";
  return {
    guided_candidate: true,
    priority,
    guided_reason: GUIDED_REASON_BY_SLUG[match.template.slug] || "Patron moderno frecuente",
    suggested_rule_mode: priority === "high" ? "auto" : "suggest",
    suggested_rule_confidence: priority === "high" ? 0.95 : 0.84,
    risk_label: priority === "high" ? "Merchant muy claro" : "Sugerencia controlada",
  };
}

function trackReviewGroup(groups, tx, match, categoryId, transactionId, options = {}) {
  if (options.skipPatterns?.has(`${categoryId}:${normalizePatternValue(match.keyword)}`)) {
    return;
  }

  const guided = buildGuidedMetadata(match, tx);
  const groupKey = `${match.template.slug}:${match.keyword}`;
  const current = groups.get(groupKey) || {
    key: groupKey,
    pattern: match.keyword,
    category_id: categoryId,
    category_name: match.template.name,
    category_slug: match.template.slug,
    count: 0,
    transaction_ids: [],
    samples: [],
    guided_candidate: guided?.guided_candidate ?? false,
    priority: guided?.priority ?? "low",
    guided_reason: guided?.guided_reason ?? null,
    suggested_rule_mode: guided?.suggested_rule_mode ?? "suggest",
    suggested_rule_confidence: guided?.suggested_rule_confidence ?? 0.82,
    risk_label: guided?.risk_label ?? null,
  };

  current.count += 1;
  current.transaction_ids.push(transactionId);
  if (current.samples.length < 3) {
    current.samples.push(tx.desc_banco);
  }
  groups.set(groupKey, current);
}

function listReviewGroups(groups) {
  return [...groups.values()].sort((left, right) => right.count - left.count);
}

function listGuidedReviewGroups(groups, limit = 6) {
  const priorityScore = { high: 3, medium: 2, low: 1 };

  return [...groups.values()]
    .filter((group) => group.guided_candidate)
    .sort((left, right) => {
      const diff = (priorityScore[right.priority] || 0) - (priorityScore[left.priority] || 0);
      if (diff !== 0) return diff;
      return right.count - left.count;
    })
    .slice(0, limit);
}

module.exports = {
  createReviewGroupTracker,
  ensureSmartCategoriesForTransactions,
  listGuidedReviewGroups,
  listReviewGroups,
  matchSmartCategoryTemplate,
  trackReviewGroup,
};
