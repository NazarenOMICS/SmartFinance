import type { UpsertBankFormatInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";

function parseFormatRow(row: { id: number; format_key: string; bank_name: string | null; config_json: string; created_at: string; updated_at?: string | null }) {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(row.config_json || "{}");
  } catch {
    parsed = {};
  }

  return {
    id: row.id,
    format_key: row.format_key,
    bank_name: row.bank_name,
    col_fecha: Number(parsed.col_fecha ?? -1),
    col_desc: Number(parsed.col_desc ?? -1),
    col_debit: Number(parsed.col_debit ?? -1),
    col_credit: Number(parsed.col_credit ?? -1),
    col_monto: Number(parsed.col_monto ?? -1),
    created_at: row.created_at,
    updated_at: row.updated_at ?? null,
  };
}

export async function listBankFormats(db: D1DatabaseLike, userId: string) {
  const rows = await allRows<{
    id: number;
    format_key: string;
    bank_name: string | null;
    config_json: string;
    created_at: string;
    updated_at?: string | null;
  }>(
    db,
    `
      SELECT id, format_key, bank_name, config_json, created_at, updated_at
      FROM bank_formats
      WHERE user_id = ?
      ORDER BY COALESCE(bank_name, format_key) ASC, id ASC
    `,
    [userId],
  );

  return rows.map(parseFormatRow);
}

export async function getBankFormatByKey(db: D1DatabaseLike, userId: string, formatKey: string) {
  const row = await firstRow<{
    id: number;
    format_key: string;
    bank_name: string | null;
    config_json: string;
    created_at: string;
    updated_at?: string | null;
  }>(
    db,
    `
      SELECT id, format_key, bank_name, config_json, created_at, updated_at
      FROM bank_formats
      WHERE user_id = ? AND format_key = ?
      LIMIT 1
    `,
    [userId, formatKey],
  );

  return row ? parseFormatRow(row) : null;
}

export async function upsertBankFormat(db: D1DatabaseLike, userId: string, input: UpsertBankFormatInput) {
  const configJson = JSON.stringify({
    col_fecha: input.col_fecha,
    col_desc: input.col_desc,
    col_debit: input.col_debit,
    col_credit: input.col_credit,
    col_monto: input.col_monto,
  });

  await runStatement(
    db,
    `
      INSERT INTO bank_formats (user_id, format_key, bank_name, config_json, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, format_key)
      DO UPDATE SET
        bank_name = excluded.bank_name,
        config_json = excluded.config_json,
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, input.format_key, input.bank_name ?? null, configJson],
  );

  return getBankFormatByKey(db, userId, input.format_key);
}

export async function deleteBankFormat(db: D1DatabaseLike, userId: string, formatKey: string) {
  const current = await getBankFormatByKey(db, userId, formatKey);
  if (!current) {
    return { deleted: false };
  }

  await runStatement(
    db,
    "DELETE FROM bank_formats WHERE user_id = ? AND format_key = ?",
    [userId, formatKey],
  );

  return { deleted: true };
}
