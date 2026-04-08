import { allRows, type D1DatabaseLike } from "./client";
import { getSettingsObject } from "./settings";
import { getInstallmentCommitments, listInstallments } from "./installments";

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeMatcher(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveRecurringKey(value: string) {
  return normalizeMatcher(value)
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getExchangeRateMap(settings: Record<string, string>) {
  return {
    UYU: 1,
    USD: Number(settings.effective_exchange_rate_usd_uyu || settings.exchange_rate_usd_uyu || 42.5),
    EUR: Number(settings.effective_exchange_rate_eur_uyu || settings.exchange_rate_eur_uyu || 46.5),
    ARS: Number(settings.effective_exchange_rate_ars_uyu || settings.exchange_rate_ars_uyu || 0.045),
  };
}

function convertCurrencyAmount(amount: number, sourceCurrency: string, targetCurrency: string, exchangeRates: Record<string, number>) {
  const source = String(sourceCurrency || targetCurrency || "UYU").toUpperCase();
  const target = String(targetCurrency || source || "UYU").toUpperCase();
  if (source === target) return Number(amount || 0);

  let inUyu = Number(amount || 0);
  if (source !== "UYU") {
    const sourceRate = Number(exchangeRates[source]);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) return inUyu;
    inUyu *= sourceRate;
  }

  if (target === "UYU") return inUyu;
  const targetRate = Number(exchangeRates[target]);
  if (!Number.isFinite(targetRate) || targetRate <= 0) return inUyu;
  return inUyu / targetRate;
}

export async function listTransactionsWindow(db: D1DatabaseLike, userId: string, startMonth: string, endMonth: string) {
  return allRows<{
    id: number;
    period: string;
    fecha: string;
    desc_banco: string;
    desc_usuario: string | null;
    monto: number;
    moneda: string;
    category_id: number | null;
    category_name: string | null;
    category_type: string | null;
    category_color: string | null;
    account_id: string | null;
    account_name: string | null;
    movement_kind: string;
    categorization_status: string;
    es_cuota: number;
  }>(
    db,
    `
      SELECT
        transactions.id,
        transactions.period,
        transactions.fecha,
        transactions.desc_banco,
        transactions.desc_usuario,
        transactions.monto,
        transactions.moneda,
        transactions.category_id,
        categories.name AS category_name,
        categories.type AS category_type,
        categories.color AS category_color,
        transactions.account_id,
        accounts.name AS account_name,
        transactions.movement_kind,
        transactions.categorization_status,
        CASE WHEN installments.id IS NULL THEN 0 ELSE 1 END AS es_cuota
      FROM transactions
      LEFT JOIN categories
        ON categories.user_id = transactions.user_id
       AND categories.id = transactions.category_id
      LEFT JOIN accounts
        ON accounts.user_id = transactions.user_id
       AND accounts.id = transactions.account_id
      LEFT JOIN installments
        ON installments.user_id = transactions.user_id
       AND installments.id = transactions.installment_id
      WHERE transactions.user_id = ?
        AND transactions.period >= ?
        AND transactions.period <= ?
      ORDER BY transactions.fecha ASC, transactions.id ASC
    `,
    [userId, startMonth, endMonth],
  );
}

export async function getConsolidatedAccounts(db: D1DatabaseLike, userId: string) {
  const [accounts, settings] = await Promise.all([
    allRows<{ id: string; name: string; currency: string; balance: number }>(
      db,
      "SELECT id, name, currency, balance FROM accounts WHERE user_id = ? ORDER BY created_at ASC, id ASC",
      [userId],
    ),
    getSettingsObject(db, userId),
  ]);

  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const enriched = accounts.map((account) => ({
    ...account,
    converted_balance: convertCurrencyAmount(Number(account.balance || 0), account.currency, displayCurrency, exchangeRates),
  }));

  return {
    total: Number(enriched.reduce((sum, account) => sum + Number(account.converted_balance || 0), 0).toFixed(2)),
    currency: displayCurrency,
    accounts: enriched,
  };
}

export async function getLegacyCategoryTrend(db: D1DatabaseLike, userId: string, endMonth: string, months: number) {
  const startMonth = shiftMonth(endMonth, -(months - 1));
  const transactions = await listTransactionsWindow(db, userId, startMonth, endMonth);
  const monthKeys = Array.from({ length: months }, (_, index) => shiftMonth(startMonth, index));

  return monthKeys.map((month) => {
    const byCategory = transactions
      .filter((transaction) => transaction.period === month && Number(transaction.monto) < 0 && transaction.movement_kind !== "internal_transfer" && transaction.movement_kind !== "fx_exchange")
      .reduce<Record<string, number>>((acc, transaction) => {
        const key = transaction.category_name || "Sin categoria";
        acc[key] = (acc[key] || 0) + Math.abs(Number(transaction.monto));
        return acc;
      }, {});

    return { month, byCategory };
  });
}

export async function getRecurringExpenses(db: D1DatabaseLike, userId: string, month: string) {
  const startMonth = shiftMonth(month, -5);
  const transactions = await listTransactionsWindow(db, userId, startMonth, month);
  const grouped = new Map<string, {
    desc_banco: string;
    moneda: string;
    total_amount: number;
    occurrences: number;
    months_seen: Set<string>;
    category_name: string | null;
    category_color: string | null;
  }>();

  transactions
    .filter((transaction) => Number(transaction.monto) < 0 && transaction.movement_kind !== "internal_transfer" && transaction.movement_kind !== "fx_exchange")
    .forEach((transaction) => {
      const key = deriveRecurringKey(transaction.desc_banco);
      if (!key) return;

      const current = grouped.get(key) || {
        desc_banco: transaction.desc_banco,
        moneda: transaction.moneda,
        total_amount: 0,
        occurrences: 0,
        months_seen: new Set<string>(),
        category_name: transaction.category_name,
        category_color: transaction.category_color,
      };

      current.total_amount += Math.abs(Number(transaction.monto));
      current.occurrences += 1;
      current.months_seen.add(transaction.period);
      if (!current.category_name && transaction.category_name) {
        current.category_name = transaction.category_name;
        current.category_color = transaction.category_color;
      }
      grouped.set(key, current);
    });

  return [...grouped.values()]
    .filter((item) => item.months_seen.size >= 2)
    .map((item) => ({
      desc_banco: item.desc_banco,
      moneda: item.moneda,
      avg_amount: Number((item.total_amount / Math.max(item.occurrences, 1)).toFixed(2)),
      occurrences: item.occurrences,
      months_seen: [...item.months_seen].sort(),
      category_name: item.category_name,
      category_color: item.category_color,
    }))
    .sort((left, right) => right.occurrences - left.occurrences || right.avg_amount - left.avg_amount);
}

export async function getSavingsProjection(db: D1DatabaseLike, userId: string, endMonth: string, months: number) {
  const settings = await getSettingsObject(db, userId);
  const currency = settings.savings_currency || settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const startMonth = shiftMonth(endMonth, -(Math.max(months, 6) - 1));
  const transactions = await listTransactionsWindow(db, userId, startMonth, endMonth);
  const commitments = await getInstallmentCommitments(db, userId, shiftMonth(endMonth, 1), Math.max(6, Math.min(months, 12)));
  const historicalMonths = Array.from({ length: 6 }, (_, index) => shiftMonth(endMonth, -(5 - index)));

  const monthlySavings = historicalMonths.map((month) => {
    const monthTransactions = transactions.filter((transaction) => transaction.period === month && transaction.movement_kind !== "internal_transfer" && transaction.movement_kind !== "fx_exchange");
    const income = monthTransactions
      .filter((transaction) => Number(transaction.monto) > 0)
      .reduce((sum, transaction) => sum + convertCurrencyAmount(Number(transaction.monto), transaction.moneda, currency, exchangeRates), 0);
    const expenses = monthTransactions
      .filter((transaction) => Number(transaction.monto) < 0)
      .reduce((sum, transaction) => sum + convertCurrencyAmount(Math.abs(Number(transaction.monto)), transaction.moneda, currency, exchangeRates), 0);

    return {
      month,
      net: Number((income - expenses).toFixed(2)),
    };
  });

  const averageMonthlySavings = monthlySavings.length
    ? monthlySavings.reduce((sum, point) => sum + point.net, 0) / monthlySavings.length
    : Number(settings.savings_monthly || 0);

  const initial = Number(settings.savings_initial || 0);
  const goal = Number(settings.savings_goal || 0);
  let running = initial;
  const series: Array<{ month: string; real: number | null; projected: number | null; goal: number | null }> = monthlySavings.map((point) => {
    running += point.net;
    return {
      month: point.month,
      real: Number(running.toFixed(2)),
      projected: null,
      goal: goal || null,
    };
  });

  let projectedRunning = running;
  const futureMonths = Array.from({ length: Math.max(6, months) }, (_, index) => shiftMonth(endMonth, index + 1));
  for (const month of futureMonths) {
    const commitment = commitments.find((item) => item.month === month);
    projectedRunning += averageMonthlySavings - Number(commitment?.total || 0);
    series.push({
      month,
      real: null,
      projected: Number(projectedRunning.toFixed(2)),
      goal: goal || null,
    });
  }

  return {
    currency,
    average_monthly_savings: Number(averageMonthlySavings.toFixed(2)),
    commitments,
    series,
  };
}

export async function getSavingsInsights(db: D1DatabaseLike, userId: string, month: string) {
  const [settings, projection, trend] = await Promise.all([
    getSettingsObject(db, userId),
    getSavingsProjection(db, userId, month, 12),
    getLegacyCategoryTrend(db, userId, month, 2),
  ]);

  const currency = projection.currency;
  const currentMonth = trend[trend.length - 1]?.byCategory || {};
  const previousMonth = trend[trend.length - 2]?.byCategory || {};
  const growthCandidates = Object.keys(currentMonth).map((name) => {
    const currentAmount = Number(currentMonth[name] || 0);
    const previousAmount = Number(previousMonth[name] || 0);
    const deltaPct = previousAmount === 0 ? (currentAmount > 0 ? 100 : 0) : ((currentAmount - previousAmount) / Math.abs(previousAmount)) * 100;
    return {
      category: name,
      delta_pct: deltaPct,
      current_amount: currentAmount,
      previous_amount: previousAmount,
    };
  });
  const growth = growthCandidates.sort((left, right) => right.delta_pct - left.delta_pct)[0] || null;

  const currentSeriesPoint = projection.series.find((point) => point.month === month) || null;
  const totalSpentThisMonth = currentMonth
    ? Object.values(currentMonth).reduce((sum, value) => sum + Number(value || 0), 0)
    : 0;
  const monthlyBudget = Number(settings.savings_monthly || 0);
  const remainingBudget = monthlyBudget - totalSpentThisMonth;
  const now = new Date();
  const [year, monthNumber] = month.split("-").map(Number);
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === monthNumber;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const daysLeft = isCurrentMonth ? Math.max(0, daysInMonth - now.getDate()) : 0;
  const currentSavings = currentSeriesPoint?.real ?? Number(settings.savings_initial || 0);
  const etaMonths = projection.average_monthly_savings > 0
    ? Math.ceil(Math.max(0, Number(settings.savings_goal || 0) - currentSavings) / projection.average_monthly_savings)
    : null;

  return {
    currency,
    growth,
    daily_average_spend: Number((totalSpentThisMonth / Math.max(daysInMonth, 1)).toFixed(2)),
    budget_per_day: daysLeft > 0 ? Number((remainingBudget / daysLeft).toFixed(2)) : 0,
    remaining_budget: Number(remainingBudget.toFixed(2)),
    days_left: daysLeft,
    budget_exhausted: remainingBudget < 0,
    eta_months: etaMonths && Number.isFinite(etaMonths) && etaMonths > 0 ? etaMonths : null,
  };
}
