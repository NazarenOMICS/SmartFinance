import type { CreateTransactionInput, UpdateTransactionInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { classifyTransactionByRules, incrementRuleMatchCount, rejectRuleForDescription } from "./rules";

function toPeriod(fecha: string) {
  return fecha.slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildDedupHash(input: { fecha: string; monto: number; desc_banco: string }) {
  const normalized = `${input.fecha}|${input.monto}|${input.desc_banco.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return `tx_${Math.abs(hash)}`;
}

export async function listTransactionsByMonth(db: D1DatabaseLike, userId: string, month: string) {
  return allRows(
    db,
    `
      SELECT
        id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
        categorization_status, category_source, category_confidence, category_rule_id, created_at
      FROM transactions
      WHERE user_id = ? AND period = ?
      ORDER BY fecha DESC, id DESC
    `,
    [userId, month],
  );
}

export async function listPendingTransactionsByMonth(db: D1DatabaseLike, userId: string, month: string) {
  return allRows(
    db,
    `
      SELECT
        id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
        categorization_status, category_source, category_confidence, category_rule_id, created_at
      FROM transactions
      WHERE user_id = ? AND period = ? AND categorization_status != 'categorized'
      ORDER BY fecha DESC, id DESC
    `,
    [userId, month],
  );
}

export async function getTransactionById(db: D1DatabaseLike, userId: string, transactionId: number) {
  return firstRow(
    db,
    `
      SELECT
        id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
        categorization_status, category_source, category_confidence, category_rule_id, created_at
      FROM transactions
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, transactionId],
  );
}

export async function acceptSuggestedTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;
  if (current.category_id == null) return current;

  await runStatement(
    db,
    `
      UPDATE transactions
      SET categorization_status = 'categorized',
          category_source = CASE
            WHEN category_source = 'rule_suggest' THEN 'rule_confirmed'
            ELSE category_source
          END
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  if (current.category_rule_id != null) {
    await incrementRuleMatchCount(db, userId, Number(current.category_rule_id));
  }

  return getTransactionById(db, userId, transactionId);
}

export async function rejectSuggestedTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  if (current.category_rule_id != null) {
    await rejectRuleForDescription(db, userId, Number(current.category_rule_id), String(current.desc_banco));
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET category_id = NULL,
          categorization_status = 'uncategorized',
          category_source = NULL,
          category_confidence = NULL,
          category_rule_id = NULL
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function acceptSuggestedTransactions(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await acceptSuggestedTransaction(db, userId, transactionId);
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function rejectSuggestedTransactions(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await rejectSuggestedTransaction(db, userId, transactionId);
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function assignCategoryToTransactions(
  db: D1DatabaseLike,
  userId: string,
  transactionIds: number[],
  categoryId: number,
) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await updateTransaction(db, userId, transactionId, { category_id: categoryId });
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function createTransaction(
  db: D1DatabaseLike,
  userId: string,
  input: CreateTransactionInput,
  options: { uploadId?: number } = {},
) {
  const signedAmount = input.entry_type === "expense" ? -Math.abs(input.monto) : Math.abs(input.monto);
  const period = toPeriod(input.fecha);
  const classification = await classifyTransactionByRules(db, userId, {
    descBanco: input.desc_banco,
    amount: signedAmount,
    currency: input.moneda,
    accountId: input.account_id ?? null,
    entryType: input.entry_type,
    categoryId: input.category_id ?? null,
  });
  const dedupHash = buildDedupHash({
    fecha: input.fecha,
    monto: signedAmount,
    desc_banco: input.desc_banco,
  });
  const duplicate = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM transactions
      WHERE user_id = ? AND period = ? AND dedup_hash = ?
      LIMIT 1
    `,
    [userId, period, dedupHash],
  );
  if (duplicate) {
    throw new Error("transaction already exists for this month");
  }

  await runStatement(
    db,
    `
      INSERT INTO transactions
      (
        user_id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
        categorization_status, category_source, category_confidence, category_rule_id, dedup_hash, upload_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      period,
      input.fecha,
      input.desc_banco,
      input.desc_usuario ?? null,
      signedAmount,
      input.moneda,
      classification.categoryId,
      input.account_id ?? null,
      input.entry_type,
      classification.categorizationStatus,
      classification.categorySource,
      classification.categoryConfidence,
      classification.categoryRuleId,
      dedupHash,
      options.uploadId ?? null,
    ],
  );

  const created = await firstRow<{ id: number }>(
    db,
    "SELECT id FROM transactions WHERE user_id = ? AND period = ? AND dedup_hash = ? LIMIT 1",
    [userId, period, dedupHash],
  );

  if (classification.matchedRule?.id) {
    await incrementRuleMatchCount(db, userId, classification.matchedRule.id);
  }

  return getTransactionById(db, userId, Number(created?.id || 0));
}

export async function updateTransaction(db: D1DatabaseLike, userId: string, transactionId: number, input: UpdateTransactionInput) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  const nextFecha = input.fecha ?? String(current.fecha);
  const nextMonto = input.monto ?? Number(current.monto);
  const nextAccountId = input.account_id === undefined ? current.account_id : input.account_id;
  const dedupHash = buildDedupHash({
    fecha: nextFecha,
    monto: nextMonto,
    desc_banco: String(current.desc_banco),
  });
  const duplicate = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM transactions
      WHERE user_id = ? AND id != ? AND period = ? AND dedup_hash = ?
      LIMIT 1
    `,
    [userId, transactionId, toPeriod(nextFecha), dedupHash],
  );
  if (duplicate) {
    throw new Error("transaction already exists for this month");
  }

  let nextCategoryId = input.category_id === undefined ? current.category_id : input.category_id;
  let nextStatus = current.categorization_status;
  let nextSource = current.category_source;
  let nextConfidence = current.category_confidence;
  let nextRuleId = current.category_rule_id;

  if (input.category_id !== undefined) {
    if (input.category_id === null) {
      nextCategoryId = null;
      nextStatus = "uncategorized";
      nextSource = null;
      nextConfidence = null;
      nextRuleId = null;
    } else {
      nextCategoryId = input.category_id;
      nextStatus = "categorized";
      nextSource = "manual";
      nextConfidence = null;
      nextRuleId = null;
    }
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET desc_usuario = ?,
          category_id = ?,
          account_id = ?,
          fecha = ?,
          period = ?,
          monto = ?,
          dedup_hash = ?,
          categorization_status = ?,
          category_source = ?,
          category_confidence = ?,
          category_rule_id = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.desc_usuario === undefined ? current.desc_usuario : input.desc_usuario,
      nextCategoryId,
      nextAccountId,
      nextFecha,
      toPeriod(nextFecha),
      nextMonto,
      dedupHash,
      nextStatus,
      nextSource,
      nextConfidence,
      nextRuleId,
      userId,
      transactionId,
    ],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function deleteTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) {
    return { deleted: false };
  }

  await runStatement(
    db,
    "DELETE FROM transactions WHERE user_id = ? AND id = ?",
    [userId, transactionId],
  );

  return { deleted: true, transaction: current };
}

export async function getTransactionSummary(db: D1DatabaseLike, userId: string, month: string) {
  const rows = await allRows<{ monto: number }>(
    db,
    "SELECT monto FROM transactions WHERE user_id = ? AND period = ?",
    [userId, month],
  );

  const income = rows.filter((row) => Number(row.monto) > 0).reduce((sum, row) => sum + Number(row.monto), 0);
  const expenses = rows.filter((row) => Number(row.monto) < 0).reduce((sum, row) => sum + Math.abs(Number(row.monto)), 0);

  return {
    month,
    income,
    expenses,
    net: income - expenses,
    transaction_count: rows.length,
  };
}

export async function getTransactionMonthlyEvolution(
  db: D1DatabaseLike,
  userId: string,
  months: number,
  endMonth: string,
) {
  const windowMonths = Array.from({ length: months }, (_, index) => shiftMonth(endMonth, index - months + 1));
  const rows = await allRows<{ period: string; monto: number }>(
    db,
    `
      SELECT period, monto
      FROM transactions
      WHERE user_id = ?
        AND period >= ?
        AND period <= ?
      ORDER BY period ASC
    `,
    [userId, windowMonths[0], endMonth],
  );

  return windowMonths.map((month) => {
    const periodRows = rows.filter((row) => String(row.period) === month);
    const income = periodRows
      .filter((row) => Number(row.monto) > 0)
      .reduce((sum, row) => sum + Number(row.monto), 0);
    const expenses = periodRows
      .filter((row) => Number(row.monto) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.monto)), 0);

    return {
      month,
      income,
      expenses,
      net: income - expenses,
      transaction_count: periodRows.length,
    };
  });
}
