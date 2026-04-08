import { allRows, runStatement, type D1DatabaseLike } from "./client";
import { DEFAULT_SETTINGS } from "./schema";

export async function getSettingsObject(db: D1DatabaseLike, userId: string) {
  const rows = await allRows<{ key: string; value: string }>(
    db,
    "SELECT key, value FROM settings WHERE user_id = ?",
    [userId],
  );

  return rows.reduce<Record<string, string>>(
    (acc, row) => {
      acc[row.key] = row.value;
      return acc;
    },
    { ...DEFAULT_SETTINGS },
  );
}

export async function upsertSetting(db: D1DatabaseLike, userId: string, key: string, value: string) {
  await runStatement(
    db,
    `
      INSERT INTO settings (user_id, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
    `,
    [userId, key, value],
  );

  return getSettingsObject(db, userId);
}

