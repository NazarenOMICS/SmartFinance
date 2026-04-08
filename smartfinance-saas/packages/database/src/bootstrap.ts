import { DEFAULT_CATEGORY_SEEDS, DEFAULT_RULE_SEEDS } from "@smartfinance/domain";
import { allRows, runStatement, type D1DatabaseLike } from "./client";
import { DEFAULT_SETTINGS } from "./schema";

export async function ensureUserBootstrap(db: D1DatabaseLike, userId: string) {
  let seededSettings = 0;
  let seededCategories = 0;
  let seededRules = 0;

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const result = await runStatement(
      db,
      "INSERT OR IGNORE INTO settings (user_id, key, value) VALUES (?, ?, ?)",
      [userId, key, value]
    );
    seededSettings += Number(result.meta?.changes || 0);
  }

  for (const category of DEFAULT_CATEGORY_SEEDS) {
    const result = await runStatement(
      db,
      `
        INSERT OR IGNORE INTO categories
        (user_id, slug, name, type, budget, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        category.slug,
        category.name,
        category.type,
        category.budget,
        category.color,
        category.sortOrder,
      ]
    );
    seededCategories += Number(result.meta?.changes || 0);
  }

  const categories = await allRows<{ id: number; slug: string }>(
    db,
    "SELECT id, slug FROM categories WHERE user_id = ?",
    [userId],
  );
  const categoryBySlug = new Map(categories.map((category) => [category.slug, category.id]));

  for (const rule of DEFAULT_RULE_SEEDS) {
    const categoryId = categoryBySlug.get(rule.slug);
    if (!categoryId) continue;

    const result = await runStatement(
      db,
      `
        INSERT OR IGNORE INTO rules (
          user_id, pattern, normalized_pattern, category_id, match_count, mode, confidence, source, account_id, currency, direction, merchant_key
        )
        VALUES (?, ?, ?, ?, 0, ?, ?, 'seed', NULL, NULL, ?, ?)
      `,
      [
        userId,
        rule.pattern,
        rule.normalized_pattern,
        categoryId,
        rule.mode,
        rule.confidence,
        rule.direction ?? "any",
        rule.normalized_pattern,
      ],
    );
    seededRules += Number(result.meta?.changes || 0);
  }

  return {
    seededSettings,
    seededCategories,
    seededRules,
  };
}
