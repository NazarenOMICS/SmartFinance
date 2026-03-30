import { buildSeedRules, CANONICAL_CATEGORIES, slugifyCategoryName } from "./taxonomy.js";

async function getCategoryBySlug(db, userId, slug) {
  return db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND slug = ? ORDER BY id ASC LIMIT 1"
  ).get(userId, slug);
}

export async function ensureCanonicalCategories(db, userId) {
  const bySlug = new Map();
  for (const category of CANONICAL_CATEGORIES) {
    const existing = await getCategoryBySlug(db, userId, category.slug);
    if (existing) {
      await db.prepare(
        `UPDATE categories
         SET name = ?, budget = ?, type = ?, color = ?, sort_order = ?, origin = 'seed', slug = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        category.name,
        category.budget,
        category.type,
        category.color,
        category.sort_order,
        category.slug,
        existing.id,
        userId
      );
      bySlug.set(category.slug, { ...existing, ...category, id: existing.id });
      continue;
    }

    const byName = await db.prepare(
      "SELECT * FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE LIMIT 1"
    ).get(userId, category.name);

    if (byName) {
      await db.prepare(
        `UPDATE categories
         SET slug = ?, origin = 'seed', budget = ?, type = ?, color = ?, sort_order = ?, name = ?
         WHERE id = ? AND user_id = ?`
      ).run(
        category.slug,
        category.budget,
        category.type,
        category.color,
        category.sort_order,
        category.name,
        byName.id,
        userId
      );
      bySlug.set(category.slug, { ...byName, ...category, id: byName.id });
      continue;
    }

    const result = await db.prepare(
      `INSERT INTO categories (name, budget, type, color, sort_order, user_id, slug, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'seed')`
    ).run(
      category.name,
      category.budget,
      category.type,
      category.color,
      category.sort_order,
      userId,
      category.slug
    );
    bySlug.set(category.slug, { ...category, id: result.lastInsertRowid });
  }

  return bySlug;
}

export async function ensureSeedRules(db, userId) {
  const categoriesBySlug = await ensureCanonicalCategories(db, userId);
  await db.prepare("DELETE FROM rules WHERE user_id = ? AND source = 'seed'").run(userId);

  for (const rule of buildSeedRules()) {
    const category = categoriesBySlug.get(rule.slug);
    if (!category) continue;
    await db.prepare(
      `INSERT INTO rules (
        pattern, normalized_pattern, category_id, match_count, user_id, mode, confidence, source,
        account_id, currency, direction, merchant_key, last_matched_at
      ) VALUES (?, ?, ?, 0, ?, ?, ?, 'seed', NULL, NULL, ?, ?, NULL)`
    ).run(
      rule.pattern,
      rule.normalized_pattern,
      category.id,
      userId,
      rule.mode,
      rule.confidence,
      rule.direction,
      rule.merchant_key
    );
  }
}

export async function ensureTaxonomyReady(db, userId) {
  const seedCategoryCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND origin = 'seed'"
  ).get(userId);
  if (Number(seedCategoryCount?.count || 0) < CANONICAL_CATEGORIES.length) {
    await ensureCanonicalCategories(db, userId);
  }

  const seedRuleCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM rules WHERE user_id = ? AND source = 'seed'"
  ).get(userId);
  if (Number(seedRuleCount?.count || 0) === 0) {
    await ensureSeedRules(db, userId);
  }
}

export async function resetLearnedCategorization(db, userId) {
  await db.prepare(
    `UPDATE transactions
     SET category_id = NULL,
         categorization_status = 'uncategorized',
         category_source = NULL,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE user_id = ?
       AND category_source IN ('rule_auto', 'rule_review', 'upload_review')`
  ).run(userId);

  const autoCategoryIds = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND origin = 'auto'"
  ).all(userId);
  const ids = autoCategoryIds.map((row) => Number(row.id)).filter(Boolean);

  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    await db.prepare(
      `UPDATE transactions
       SET category_id = NULL,
           categorization_status = 'uncategorized',
           category_source = NULL,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE user_id = ? AND category_id IN (${placeholders})`
    ).run(userId, ...ids);
    await db.prepare(
      `DELETE FROM rules WHERE user_id = ? AND category_id IN (${placeholders})`
    ).run(userId, ...ids);
    await db.prepare(
      `DELETE FROM categories WHERE user_id = ? AND id IN (${placeholders})`
    ).run(userId, ...ids);
  }

  await db.prepare("DELETE FROM rules WHERE user_id = ? AND source != 'seed'").run(userId);
  await db.prepare("DELETE FROM rule_exclusions WHERE user_id = ?").run(userId);
  await db.prepare("DELETE FROM categorization_events WHERE user_id = ?").run(userId);
  await ensureSeedRules(db, userId);
}

export async function createOrUpdateManualCategory(db, userId, category) {
  const slug = slugifyCategoryName(category.name);
  const existing = await db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND slug = ? LIMIT 1"
  ).get(userId, slug);
  if (existing) {
    await db.prepare(
      "UPDATE categories SET name = ?, budget = ?, type = ?, color = ?, origin = 'manual' WHERE id = ? AND user_id = ?"
    ).run(category.name, category.budget, category.type, category.color, existing.id, userId);
    return { ...existing, ...category, id: existing.id, slug, origin: "manual" };
  }
  const existingByName = await db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE LIMIT 1"
  ).get(userId, category.name);
  if (existingByName) {
    await db.prepare(
      "UPDATE categories SET slug = ?, budget = ?, type = ?, color = ?, origin = 'manual' WHERE id = ? AND user_id = ?"
    ).run(slug, category.budget, category.type, category.color, existingByName.id, userId);
    return { ...existingByName, ...category, id: existingByName.id, slug, origin: "manual" };
  }
  const result = await db.prepare(
    "INSERT INTO categories (name, budget, type, color, user_id, slug, origin) VALUES (?, ?, ?, ?, ?, ?, 'manual')"
  ).run(category.name, category.budget, category.type, category.color, userId, slug);
  return { ...category, id: result.lastInsertRowid, slug, origin: "manual" };
}
