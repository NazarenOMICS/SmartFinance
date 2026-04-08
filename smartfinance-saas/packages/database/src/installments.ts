import type { CreateInstallmentInput, UpdateInstallmentInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function listInstallments(db: D1DatabaseLike, userId: string) {
  return allRows(
    db,
    `
      SELECT
        installments.id,
        installments.descripcion,
        installments.monto_total,
        installments.cantidad_cuotas,
        installments.cuota_actual,
        installments.monto_cuota,
        installments.account_id,
        accounts.name AS account_name,
        accounts.currency AS account_currency,
        installments.start_month,
        installments.created_at
      FROM installments
      LEFT JOIN accounts
        ON accounts.user_id = installments.user_id
       AND accounts.id = installments.account_id
      WHERE installments.user_id = ?
        AND installments.cuota_actual <= installments.cantidad_cuotas
      ORDER BY installments.created_at DESC, installments.id DESC
    `,
    [userId],
  );
}

export async function getInstallmentById(db: D1DatabaseLike, userId: string, installmentId: number) {
  return firstRow(
    db,
    `
      SELECT
        installments.id,
        installments.descripcion,
        installments.monto_total,
        installments.cantidad_cuotas,
        installments.cuota_actual,
        installments.monto_cuota,
        installments.account_id,
        accounts.name AS account_name,
        accounts.currency AS account_currency,
        installments.start_month,
        installments.created_at
      FROM installments
      LEFT JOIN accounts
        ON accounts.user_id = installments.user_id
       AND accounts.id = installments.account_id
      WHERE installments.user_id = ? AND installments.id = ?
      LIMIT 1
    `,
    [userId, installmentId],
  );
}

export async function createInstallment(db: D1DatabaseLike, userId: string, input: CreateInstallmentInput) {
  const montoCuota = Number((input.monto_total / input.cantidad_cuotas).toFixed(2));
  const result = await runStatement(
    db,
    `
      INSERT INTO installments (
        user_id, descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month
      )
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `,
    [
      userId,
      input.descripcion,
      input.monto_total,
      input.cantidad_cuotas,
      montoCuota,
      input.account_id ?? null,
      input.start_month ?? null,
    ],
  );

  return getInstallmentById(db, userId, Number(result.meta?.last_row_id || 0));
}

export async function updateInstallment(db: D1DatabaseLike, userId: string, installmentId: number, input: UpdateInstallmentInput) {
  const current = await getInstallmentById(db, userId, installmentId);
  if (!current) return null;

  const cuotaActual = Math.max(1, Math.min(Number(input.cuota_actual ?? current.cuota_actual), Number(current.cantidad_cuotas)));
  await runStatement(
    db,
    "UPDATE installments SET cuota_actual = ? WHERE user_id = ? AND id = ?",
    [cuotaActual, userId, installmentId],
  );

  return getInstallmentById(db, userId, installmentId);
}

export async function deleteInstallment(db: D1DatabaseLike, userId: string, installmentId: number) {
  const current = await getInstallmentById(db, userId, installmentId);
  if (!current) return { deleted: false };

  await runStatement(
    db,
    "DELETE FROM installments WHERE user_id = ? AND id = ?",
    [userId, installmentId],
  );

  return { deleted: true };
}

export async function getInstallmentCommitments(db: D1DatabaseLike, userId: string, startMonth: string, months: number) {
  const installments = await listInstallments(db, userId);
  const monthKeys = Array.from({ length: months }, (_, index) => shiftMonth(startMonth, index));

  return monthKeys.map((month) => {
    const total = installments.reduce((sum, installment) => {
      const start = String(installment.start_month || month);
      const offset = (() => {
        const [startYear, startNumber] = start.split("-").map(Number);
        const [year, monthNumber] = month.split("-").map(Number);
        return (year - startYear) * 12 + (monthNumber - startNumber);
      })();
      if (offset < 0) return sum;

      const installmentNumber = offset + 1;
      if (installmentNumber < Number(installment.cuota_actual) || installmentNumber > Number(installment.cantidad_cuotas)) {
        return sum;
      }

      return sum + Number(installment.monto_cuota);
    }, 0);

    return {
      month,
      total: Number(total.toFixed(2)),
    };
  });
}
