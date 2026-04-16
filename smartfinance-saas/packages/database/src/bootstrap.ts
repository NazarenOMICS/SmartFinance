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
        INSERT INTO categories
        (user_id, slug, name, type, budget, color, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, slug) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          budget = excluded.budget,
          color = excluded.color,
          sort_order = excluded.sort_order
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
        INSERT INTO rules (
          user_id, pattern, normalized_pattern, merchant_key, merchant_scope,
          category_id, match_count, mode, confidence, source,
          account_id, account_scope, currency, currency_scope, direction
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'seed', NULL, '', NULL, '', ?)
        ON CONFLICT(user_id, merchant_scope, account_scope, currency_scope, direction) DO UPDATE SET
          pattern = CASE WHEN rules.source = 'seed' THEN excluded.pattern ELSE rules.pattern END,
          normalized_pattern = CASE WHEN rules.source = 'seed' THEN excluded.normalized_pattern ELSE rules.normalized_pattern END,
          merchant_key = CASE WHEN rules.source = 'seed' THEN excluded.merchant_key ELSE rules.merchant_key END,
          category_id = CASE WHEN rules.source = 'seed' THEN excluded.category_id ELSE rules.category_id END,
          mode = CASE WHEN rules.source = 'seed' THEN excluded.mode ELSE rules.mode END,
          confidence = CASE WHEN rules.source = 'seed' THEN excluded.confidence ELSE rules.confidence END,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        userId,
        rule.pattern,
        rule.normalized_pattern,
        rule.normalized_pattern,
        rule.normalized_pattern,
        categoryId,
        rule.mode,
        rule.confidence,
        rule.direction ?? "any",
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
