import type { CreateCategoryInput, UpdateCategoryInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";

export async function listCategories(db: D1DatabaseLike, userId: string) {
  return allRows(
    db,
    `
      SELECT id, slug, name, type, budget, color, sort_order, created_at
      FROM categories
      WHERE user_id = ?
      ORDER BY sort_order ASC, id ASC
    `,
    [userId],
  );
}

export async function getCategoryById(db: D1DatabaseLike, userId: string, categoryId: number) {
  return firstRow(
    db,
    `
      SELECT id, slug, name, type, budget, color, sort_order, created_at
      FROM categories
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, categoryId],
  );
}

export async function createCategory(db: D1DatabaseLike, userId: string, input: CreateCategoryInput) {
  const result = await runStatement(
    db,
    `
      INSERT INTO categories (user_id, slug, name, type, budget, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      input.slug,
      input.name,
      input.type,
      input.budget,
      input.color ?? null,
      input.sort_order,
    ],
  );

  return getCategoryById(db, userId, Number(result.meta?.last_row_id || 0));
}

export async function updateCategory(db: D1DatabaseLike, userId: string, categoryId: number, input: UpdateCategoryInput) {
  const current = await getCategoryById(db, userId, categoryId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE categories
      SET slug = ?, name = ?, type = ?, budget = ?, color = ?, sort_order = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.slug ?? String(current.slug),
      input.name ?? String(current.name),
      input.type ?? String(current.type),
      input.budget ?? Number(current.budget),
      input.color === undefined ? current.color : input.color,
      input.sort_order ?? Number(current.sort_order),
      userId,
      categoryId,
    ],
  );

  return getCategoryById(db, userId, categoryId);
}

export async function deleteCategory(db: D1DatabaseLike, userId: string, categoryId: number) {
  const txCount = await firstRow<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  if (Number(txCount?.count || 0) > 0) {
    return { deleted: false, reason: "category_has_transactions" as const };
  }

  const ruleRows = await allRows<{ id: number }>(
    db,
    "SELECT id FROM rules WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  const ruleIds = ruleRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id));

  for (const ruleId of ruleIds) {
    await runStatement(
      db,
      "DELETE FROM rule_rejections WHERE user_id = ? AND rule_id = ?",
      [userId, ruleId],
    );
    await runStatement(
      db,
      "DELETE FROM rule_match_log WHERE user_id = ? AND rule_id = ?",
      [userId, ruleId],
    );
  }

  const profileRows = await allRows<{ id: number }>(
    db,
    "SELECT id FROM categorization_profiles WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  for (const profile of profileRows) {
    await runStatement(
      db,
      "DELETE FROM categorization_profile_rejections WHERE user_id = ? AND profile_id = ?",
      [userId, Number(profile.id)],
    );
  }
  await runStatement(
    db,
    "DELETE FROM categorization_profiles WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  await runStatement(
    db,
    "DELETE FROM merchant_dictionary WHERE user_id = ? AND default_category_id = ?",
    [userId, categoryId],
  );
  await runStatement(
    db,
    "DELETE FROM rule_match_log WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  await runStatement(
    db,
    "DELETE FROM rules WHERE user_id = ? AND category_id = ?",
    [userId, categoryId],
  );
  await runStatement(
    db,
    "DELETE FROM categories WHERE user_id = ? AND id = ?",
    [userId, categoryId],
  );

  const stillThere = await getCategoryById(db, userId, categoryId);
  if (stillThere) {
    return { deleted: false, reason: "category_delete_failed" as const };
  }

  return { deleted: true as const };
}
