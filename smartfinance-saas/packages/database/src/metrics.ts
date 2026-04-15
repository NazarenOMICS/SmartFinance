import { allRows, type D1DatabaseLike } from "./client";

type MetricScopedTransaction = {
  movement_kind?: string | null;
  moneda?: string | null;
  account_link_id?: number | null;
};

export async function getPreferredCurrencyByLinkId(db: D1DatabaseLike, userId: string) {
  const rows = await allRows<{ id: number; preferred_currency: string | null }>(
    db,
    `
      SELECT id, preferred_currency
      FROM account_links
      WHERE user_id = ?
    `,
    [userId],
  );

  return new Map(
    rows.map((row) => [Number(row.id), row.preferred_currency ? String(row.preferred_currency).toUpperCase() : null]),
  );
}

export function isTransactionIncludedInMetricFlows(
  transaction: MetricScopedTransaction,
  preferredCurrencyByLinkId: Map<number, string | null>,
) {
  const movementKind = String(transaction.movement_kind || "normal");
  if (movementKind === "internal_transfer") return false;
  if (movementKind !== "fx_exchange") return true;

  const accountLinkId = Number(transaction.account_link_id || 0);
  if (!accountLinkId) return false;

  const preferredCurrency = preferredCurrencyByLinkId.get(accountLinkId);
  if (!preferredCurrency) return false;

  return String(transaction.moneda || "").toUpperCase() === preferredCurrency;
}

export function filterTransactionsForMetricFlows<T extends MetricScopedTransaction>(
  transactions: T[],
  preferredCurrencyByLinkId: Map<number, string | null>,
) {
  return transactions.filter((transaction) => isTransactionIncludedInMetricFlows(transaction, preferredCurrencyByLinkId));
}

export function markTransactionsForMetricFlows<T extends MetricScopedTransaction>(
  transactions: T[],
  preferredCurrencyByLinkId: Map<number, string | null>,
) {
  return transactions.map((transaction) => ({
    ...transaction,
    counts_in_metrics: isTransactionIncludedInMetricFlows(transaction, preferredCurrencyByLinkId),
  }));
}
