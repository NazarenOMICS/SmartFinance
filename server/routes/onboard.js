const express = require("express");
const { db, upsertSetting, EXPECTED_SCHEMA_VERSION } = require("../db");
const {
  CANONICAL_CATEGORIES,
  buildSeedRules,
} = require("../services/taxonomy");

const router = express.Router();

function getHiddenSeedCategorySlugs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'hidden_seed_category_slugs' LIMIT 1").get();
  try {
    const parsed = JSON.parse(String(row?.value || "[]"));
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function ensureCanonicalCategories() {
  const selectBySlug = db.prepare("SELECT * FROM categories WHERE slug = ? LIMIT 1");
  const selectByName = db.prepare("SELECT * FROM categories WHERE name = ? COLLATE NOCASE LIMIT 1");
  const insertCategory = db.prepare(
    `INSERT INTO categories (name, type, budget, color, sort_order, slug, origin)
     VALUES (?, ?, ?, ?, ?, ?, 'seed')`
  );
  const updateCategory = db.prepare(
    `UPDATE categories
     SET name = ?, type = ?, budget = ?, color = ?, sort_order = ?, slug = ?, origin = 'seed'
     WHERE id = ?`
  );

  db.transaction(() => {
    const hiddenSlugs = getHiddenSeedCategorySlugs();
    for (const category of CANONICAL_CATEGORIES) {
      if (hiddenSlugs.has(category.slug)) continue;
      const existing = selectBySlug.get(category.slug) || selectByName.get(category.name);
      if (existing) {
        updateCategory.run(
          category.name,
          category.type,
          category.budget,
          category.color,
          category.sort_order,
          category.slug,
          existing.id
        );
      } else {
        insertCategory.run(
          category.name,
          category.type,
          category.budget,
          category.color,
          category.sort_order,
          category.slug
        );
      }
    }
  })();
}

function ensureSeedRules() {
  const categories = db.prepare("SELECT id, slug FROM categories").all();
  const bySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const hiddenSlugs = getHiddenSeedCategorySlugs();
  const insertRule = db.prepare(
    `INSERT OR IGNORE INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, currency, direction, merchant_key
    ) VALUES (?, ?, ?, 0, ?, ?, 'seed', NULL, NULL, ?, ?)`
  );

  db.transaction(() => {
    db.prepare("DELETE FROM rules WHERE source = 'seed'").run();
    for (const rule of buildSeedRules()) {
      if (hiddenSlugs.has(rule.slug)) continue;
      const categoryId = bySlug.get(rule.slug);
      if (!categoryId) continue;
      insertRule.run(
        rule.pattern,
        rule.normalized_pattern,
        categoryId,
        rule.mode,
        rule.confidence,
        rule.direction,
        rule.merchant_key
      );
    }
  })();
}

function ensureTaxonomyReady() {
  const hiddenSlugs = getHiddenSeedCategorySlugs();
  const expectedSeedCategoryCount = CANONICAL_CATEGORIES.filter((category) => !hiddenSlugs.has(category.slug)).length;
  const seedCategoryCount = db
    .prepare("SELECT COUNT(*) AS count FROM categories WHERE origin = 'seed'")
    .get().count;
  const expectedSeedRules = buildSeedRules().filter((rule) => !hiddenSlugs.has(rule.slug)).length;
  const seedRuleCount = db
    .prepare("SELECT COUNT(*) AS count FROM rules WHERE source = 'seed'")
    .get().count;
  const versionRow = db
    .prepare("SELECT value FROM system_meta WHERE key = 'schema_version' LIMIT 1")
    .get();

  if (Number(seedCategoryCount || 0) < expectedSeedCategoryCount) {
    ensureCanonicalCategories();
  }

  if (Number(seedRuleCount || 0) < expectedSeedRules) {
    ensureSeedRules();
  }

  if (!versionRow || versionRow.value !== EXPECTED_SCHEMA_VERSION) {
    db.prepare(
      `INSERT INTO system_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(EXPECTED_SCHEMA_VERSION);
  }
}

router.post("/", (req, res) => {
  const count = db.prepare("SELECT COUNT(*) AS n FROM categories").get().n;
  if (Number(count || 0) > 0) {
    ensureTaxonomyReady();
  } else {
    ensureCanonicalCategories();
    ensureSeedRules();
  }
  res.json({ status: count > 0 ? "existing" : "created", categories_seeded: true, rules_seeded: true });
});

router.post("/claim-legacy", (req, res) => {
  res.json({ claimed: 0 });
});

router.post("/guided-categorization/complete", (req, res) => {
  const now = new Date().toISOString();
  upsertSetting("guided_categorization_onboarding_completed", "1");
  upsertSetting("guided_categorization_onboarding_skipped", "0");
  upsertSetting("guided_categorization_onboarding_seen_at", now);
  res.json({ completed: true, seen_at: now });
});

router.post("/guided-categorization/skip", (req, res) => {
  const now = new Date().toISOString();
  upsertSetting("guided_categorization_onboarding_skipped", "1");
  upsertSetting("guided_categorization_onboarding_seen_at", now);
  res.json({ skipped: true, seen_at: now });
});

module.exports = router;
module.exports.ensureCanonicalCategories = ensureCanonicalCategories;
module.exports.ensureSeedRules = ensureSeedRules;
