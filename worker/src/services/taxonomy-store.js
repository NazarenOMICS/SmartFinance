import { buildSeedRules, CANONICAL_CATEGORIES, slugifyCategoryName } from "./taxonomy.js";

async function getHiddenSeedCategorySlugs(db, userId) {
  const row = await db.prepare(
    "SELECT value FROM settings WHERE user_id = ? AND key = 'hidden_seed_category_slugs' LIMIT 1"
  ).get(userId);
  try {
    const parsed = JSON.parse(String(row?.value || "[]"));
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

async function saveHiddenSeedCategorySlugs(db, userId, slugs) {
  const value = JSON.stringify([...new Set(slugs)].sort());
  await db.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, 'hidden_seed_category_slugs', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  ).run(userId, value);
}

async function getCategoryBySlug(db, userId, slug) {
  return db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND slug = ? ORDER BY id ASC LIMIT 1"
  ).get(userId, slug);
}

async function getCategoryByName(db, userId, name) {
  return db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE LIMIT 1"
  ).get(userId, name);
}

export async function ensureCanonicalCategories(db, userId) {
  const bySlug = new Map();
  const hiddenSlugs = await getHiddenSeedCategorySlugs(db, userId);
  for (const category of CANONICAL_CATEGORIES) {
    if (hiddenSlugs.has(category.slug)) continue;
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

    const byName = await getCategoryByName(db, userId, category.name);

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

    await db.prepare(
      `INSERT OR IGNORE INTO categories (name, budget, type, color, sort_order, user_id, slug, origin)
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
    const inserted = await getCategoryBySlug(db, userId, category.slug) || await getCategoryByName(db, userId, category.name);
    if (inserted) {
      bySlug.set(category.slug, { ...inserted, ...category, id: inserted.id });
    }
  }

  return bySlug;
}

export async function ensureSeedRules(db, userId) {
  const categoriesBySlug = await ensureCanonicalCategories(db, userId);
  const hiddenSlugs = await getHiddenSeedCategorySlugs(db, userId);

  for (const rule of buildSeedRules()) {
    if (hiddenSlugs.has(rule.slug)) continue;
    const category = categoriesBySlug.get(rule.slug);
    if (!category) continue;
    const existing = await db.prepare(
      `SELECT id
       FROM rules
       WHERE user_id = ?
         AND normalized_pattern = ?
         AND COALESCE(account_id, '') = ''
         AND COALESCE(currency, '') = ''
         AND direction = ?`
    ).get(userId, rule.normalized_pattern, rule.direction);

    if (existing) {
      await db.prepare(
        `UPDATE rules
         SET pattern = ?, category_id = ?, mode = ?, confidence = ?, source = 'seed', merchant_key = ?, last_matched_at = NULL
         WHERE id = ? AND user_id = ?`
      ).run(
        rule.pattern,
        category.id,
        rule.mode,
        rule.confidence,
        rule.merchant_key,
        existing.id,
        userId
      );
      continue;
    }

    await db.prepare(
      `INSERT OR IGNORE INTO rules (
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
  const hiddenSlugs = await getHiddenSeedCategorySlugs(db, userId);
  const expectedSeedCategoryCount = CANONICAL_CATEGORIES.filter((category) => !hiddenSlugs.has(category.slug)).length;
  const seedCategoryCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ? AND origin = 'seed'"
  ).get(userId);
  if (Number(seedCategoryCount?.count || 0) < expectedSeedCategoryCount) {
    await ensureCanonicalCategories(db, userId);
  }

  const expectedSeedRules = buildSeedRules().filter((rule) => !hiddenSlugs.has(rule.slug)).length;
  const seedRuleCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM rules WHERE user_id = ? AND source = 'seed'"
  ).get(userId);
  if (Number(seedRuleCount?.count || 0) < expectedSeedRules) {
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
       AND category_source IN ('rule_auto', 'rule_review', 'upload_review', 'ollama_auto', 'ollama_suggest')`
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

export async function hideSeedCategory(db, userId, slug) {
  const hiddenSlugs = await getHiddenSeedCategorySlugs(db, userId);
  hiddenSlugs.add(slug);
  await saveHiddenSeedCategorySlugs(db, userId, hiddenSlugs);
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
  await db.prepare(
    "INSERT OR IGNORE INTO categories (name, budget, type, color, user_id, slug, origin) VALUES (?, ?, ?, ?, ?, ?, 'manual')"
  ).run(category.name, category.budget, category.type, category.color, userId, slug);
  const inserted = await db.prepare(
    "SELECT * FROM categories WHERE user_id = ? AND slug = ? LIMIT 1"
  ).get(userId, slug) || await getCategoryByName(db, userId, category.name);
  return { ...inserted, ...category, id: inserted.id, slug, origin: "manual" };
}
