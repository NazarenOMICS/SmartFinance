const taxonomy = require("../../shared/categorization-taxonomy.json");

const TAXONOMY_VERSION = taxonomy.version;
const CANONICAL_CATEGORIES = taxonomy.categories;
const AMBIGUOUS_MERCHANTS = taxonomy.ambiguous_merchants || [];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyCategoryName(value) {
  return normalizeText(value).replace(/\s+/g, "_");
}

function normalizePatternValue(value) {
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

function getCanonicalCategoryByName(name) {
  const normalized = normalizeText(name);
  return CANONICAL_CATEGORIES.find((category) => normalizeText(category.name) === normalized) || null;
}

function matchCanonicalCategory(descBanco) {
  const normalized = normalizeText(descBanco);
  for (const category of CANONICAL_CATEGORIES) {
    const keyword = (category.keywords || []).find((item) => normalized.includes(normalizeText(item)));
    if (keyword) {
      return { category, keyword: normalizeText(keyword) };
    }
  }
  return null;
}

function hasAmbiguousMerchantHint(descBanco) {
  const normalized = normalizeText(descBanco);
  return AMBIGUOUS_MERCHANTS.some((item) => normalized.includes(normalizeText(item)));
}

function buildSeedRules() {
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

module.exports = {
  TAXONOMY_VERSION,
  CANONICAL_CATEGORIES,
  AMBIGUOUS_MERCHANTS,
  normalizeText,
  normalizePatternValue,
  slugifyCategoryName,
  getCanonicalCategoryByName,
  matchCanonicalCategory,
  hasAmbiguousMerchantHint,
  buildSeedRules,
};
