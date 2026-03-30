import taxonomy from "../../../shared/categorization-taxonomy.json";

export const TAXONOMY_VERSION = taxonomy.version;
export const CANONICAL_CATEGORIES = taxonomy.categories;

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

export function getCanonicalCategoryByName(name) {
  const normalized = normalizeText(name);
  return CANONICAL_CATEGORIES.find((category) => normalizeText(category.name) === normalized) || null;
}

export function getCanonicalCategoryBySlug(slug) {
  return CANONICAL_CATEGORIES.find((category) => category.slug === slug) || null;
}

export function matchCanonicalCategory(descBanco) {
  const normalized = normalizeText(descBanco);
  for (const category of CANONICAL_CATEGORIES) {
    const keyword = (category.keywords || []).find((item) => normalized.includes(normalizeText(item)));
    if (keyword) {
      return { category, keyword: normalizeText(keyword) };
    }
  }
  return null;
}

export function buildSeedRules() {
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
