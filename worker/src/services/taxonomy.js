import taxonomy from "../../../shared/categorization-taxonomy.json";

export const TAXONOMY_VERSION = taxonomy.version;
export const CANONICAL_CATEGORIES = taxonomy.categories;
export const AMBIGUOUS_MERCHANTS = taxonomy.ambiguous_merchants || [];
const GENERIC_CATEGORY_KEYWORDS = new Set([
  "supermercado",
  "delivery",
  "restaurant",
  "restaurante",
  "cafeteria",
  "cafe",
  "bar",
  "farmacia",
  "suscripcion",
  "telefono",
  "movil",
  "celular",
  "internet",
  "servicio",
  "luz",
  "agua",
  "gym",
  "gimnasio",
]);

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugifyCategoryName(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

export function normalizePatternValue(value) {
  return normalizeText(value);
}

function normalizeSeedPatternEntry(entry) {
  if (typeof entry === "string") {
    return {
      pattern: entry,
      tier: "clear_suggest",
      merchant_key: normalizePatternValue(entry),
    };
  }
  return {
    pattern: entry?.pattern || "",
    tier: entry?.tier || "clear_suggest",
    merchant_key: entry?.merchant_key ? normalizePatternValue(entry.merchant_key) : normalizePatternValue(entry?.pattern || ""),
  };
}

function getSeedRuleConfig(category, tier) {
  if (tier === "ambiguous_ignore") {
    return null;
  }
  if (tier === "obvious_auto") {
    return { mode: "auto", confidence: 0.95 };
  }
  if (category.slug === "ingreso" || category.slug === "transferencia") {
    return { mode: "auto", confidence: 0.94 };
  }
  if (category.slug === "reintegro") {
    return { mode: "auto", confidence: 0.9 };
  }
  return { mode: "suggest", confidence: 0.82 };
}

export function getCanonicalCategoryByName(name) {
  const normalized = normalizeText(name);
  return CANONICAL_CATEGORIES.find((category) => normalizeText(category.name) === normalized) || null;
}

export function getCanonicalCategoryBySlug(slug) {
  return CANONICAL_CATEGORIES.find((category) => category.slug === slug) || null;
}

export function matchCanonicalCategory(descBanco) {
  const normalized = normalizeText(descBanco);
  let bestMatch = null;
  for (const category of CANONICAL_CATEGORIES) {
    for (const item of category.keywords || []) {
      const normalizedKeyword = normalizeText(item);
      if (!normalizedKeyword || !normalized.includes(normalizedKeyword)) continue;
      const score = normalizedKeyword.length + (GENERIC_CATEGORY_KEYWORDS.has(normalizedKeyword) ? 0 : 20);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { category, keyword: normalizedKeyword, score };
      }
    }
  }
  return bestMatch ? { category: bestMatch.category, keyword: bestMatch.keyword } : null;
}

export function hasAmbiguousMerchantHint(descBanco) {
  const normalized = normalizeText(descBanco);
  return AMBIGUOUS_MERCHANTS.some((item) => normalized.includes(normalizeText(item)));
}

export function buildSeedRules() {
  return CANONICAL_CATEGORIES.flatMap((category) =>
    (category.seed_patterns || []).flatMap((entry) => {
      const normalized = normalizeSeedPatternEntry(entry);
      const config = getSeedRuleConfig(category, normalized.tier);
      if (!normalized.pattern || !config) {
        return [];
      }
      return [{
        pattern: normalized.pattern,
        normalized_pattern: normalizePatternValue(normalized.pattern),
        slug: category.slug,
        category_name: category.name,
        mode: config.mode,
        confidence: config.confidence,
        source: "seed",
        direction: category.slug === "ingreso" || category.slug === "reintegro" ? "income" : "expense",
        merchant_key: normalized.merchant_key,
      }];
    })
  );
}
