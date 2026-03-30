import { CANONICAL_CATEGORIES, matchCanonicalCategory, normalizeText } from "./taxonomy.js";

const REVIEWABLE_SLUGS = new Set(["comer_afuera", "delivery", "streaming", "telefonia", "gimnasio", "mascotas"]);

export function matchSmartCategoryTemplate(descBanco) {
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

export async function ensureSmartCategoriesForTransactions(db, userId, transactions) {
  const existingCategories = await db.prepare(
    "SELECT id, name, slug FROM categories WHERE user_id = ?"
  ).all(userId);
  const bySlug = Object.fromEntries(existingCategories.map((row) => [row.slug || normalizeText(row.name).replace(/\s+/g, "_"), row]));
  const byName = Object.fromEntries(existingCategories.map((row) => [normalizeText(row.name), row]));

  for (const category of CANONICAL_CATEGORIES.filter((item) => REVIEWABLE_SLUGS.has(item.slug))) {
    if (bySlug[category.slug]) continue;
    if (byName[normalizeText(category.name)]) {
      bySlug[category.slug] = { ...byName[normalizeText(category.name)], slug: category.slug };
      continue;
    }
    await db.prepare(
      `INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order, user_id, slug, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')`
    ).run(category.name, category.budget, category.type, category.color, category.sort_order, userId, category.slug);
    const inserted = await db.prepare(
      "SELECT id, name, slug FROM categories WHERE user_id = ? AND (slug = ? OR name = ? COLLATE NOCASE) ORDER BY id ASC LIMIT 1"
    ).get(userId, category.slug, category.name);
    if (inserted) {
      bySlug[category.slug] = { id: inserted.id, name: inserted.name, slug: inserted.slug || category.slug };
    }
  }

  return bySlug;
}

export function createReviewGroupTracker() {
  return new Map();
}

export function trackReviewGroup(groups, tx, match, categoryId, transactionId) {
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
  };

  current.count += 1;
  current.transaction_ids.push(transactionId);
  if (current.samples.length < 3) {
    current.samples.push(tx.desc_banco);
  }
  groups.set(groupKey, current);
}

export function listReviewGroups(groups) {
  return [...groups.values()].sort((left, right) => right.count - left.count);
}
