const taxonomy = require("../../shared/categorization-taxonomy.json");

const TAXONOMY_VERSION = taxonomy.version;
const CANONICAL_CATEGORIES = taxonomy.categories;

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

function getCanonicalCategoryByName(name) {
  const normalized = normalizeText(name);
  return CANONICAL_CATEGORIES.find((category) => normalizeText(category.name) === normalized) || null;
}

function buildSeedRules() {
  return CANONICAL_CATEGORIES.flatMap((category) =>
    (category.seed_patterns || []).map((pattern) => ({
      pattern,
      normalized_pattern: normalizePatternValue(pattern),
      slug: category.slug,
      category_name: category.name,
      mode: category.slug === "ingreso" || category.slug === "transferencia" ? "auto" : "suggest",
      confidence: category.slug === "ingreso" || category.slug === "transferencia" ? 0.94 : 0.82,
      source: "seed",
      direction: category.slug === "ingreso" || category.slug === "reintegro" ? "income" : "expense",
      merchant_key: normalizePatternValue(pattern),
    }))
  );
}

module.exports = {
  TAXONOMY_VERSION,
  CANONICAL_CATEGORIES,
  normalizeText,
  normalizePatternValue,
  slugifyCategoryName,
  getCanonicalCategoryByName,
  buildSeedRules,
};
