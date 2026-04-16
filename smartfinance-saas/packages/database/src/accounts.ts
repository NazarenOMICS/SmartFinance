import type { CreateAccountInput, UpdateAccountInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";

export async function listAccounts(db: D1DatabaseLike, userId: string) {
  return allRows(
    db,
    `
      SELECT id, name, currency, balance, opening_balance, created_at
      FROM accounts
      WHERE user_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [userId],
  );
}

export async function getAccountById(db: D1DatabaseLike, userId: string, accountId: string) {
  return firstRow(
    db,
    `
      SELECT id, name, currency, balance, opening_balance, created_at
      FROM accounts
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, accountId],
  );
}

export async function createAccount(db: D1DatabaseLike, userId: string, input: CreateAccountInput) {
  await runStatement(
    db,
    `
      INSERT INTO accounts (user_id, id, name, currency, balance, opening_balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      input.id,
      input.name,
      input.currency,
      input.balance,
      input.opening_balance ?? input.balance,
    ],
  );

  return getAccountById(db, userId, input.id);
}

export async function updateAccount(db: D1DatabaseLike, userId: string, accountId: string, input: UpdateAccountInput) {
  const current = await getAccountById(db, userId, accountId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE accounts
      SET name = ?, balance = ?, opening_balance = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.name ?? String(current.name),
      input.balance ?? Number(current.balance),
      input.opening_balance ?? Number(current.opening_balance),
      userId,
      accountId,
    ],
  );

  return getAccountById(db, userId, accountId);
}

export async function deleteAccount(db: D1DatabaseLike, userId: string, accountId: string) {
  const txCount = await firstRow<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  if (Number(txCount?.count || 0) > 0) {
    return { deleted: false, reason: "account_has_transactions" as const };
  }

  const uploadCount = await firstRow<{ count: number }>(
    db,
    "SELECT COUNT(*) AS count FROM uploads WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  if (Number(uploadCount?.count || 0) > 0) {
    return { deleted: false, reason: "account_has_uploads" as const };
  }

  await runStatement(
    db,
    "DELETE FROM accounts WHERE user_id = ? AND id = ?",
    [userId, accountId],
  );

  return { deleted: true as const };
}

export async function deleteAccountCascade(db: D1DatabaseLike, userId: string, accountId: string) {
  await runStatement(
    db,
    `DELETE FROM rule_match_log
     WHERE user_id = ?
       AND transaction_id IN (
         SELECT id FROM transactions WHERE user_id = ? AND account_id = ?
       )`,
    [userId, userId, accountId],
  );
  await runStatement(
    db,
    `DELETE FROM rule_rejections
     WHERE user_id = ?
       AND transaction_id IN (
         SELECT id FROM transactions WHERE user_id = ? AND account_id = ?
       )`,
    [userId, userId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM rules WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM account_links WHERE user_id = ? AND (account_a_id = ? OR account_b_id = ?)",
    [userId, accountId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM uploads WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM installments WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM transactions WHERE user_id = ? AND account_id = ?",
    [userId, accountId],
  );
  await runStatement(
    db,
    "DELETE FROM accounts WHERE user_id = ? AND id = ?",
    [userId, accountId],
  );

  return { deleted: true as const };
}
