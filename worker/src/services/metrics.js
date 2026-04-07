import { convertAmount, getExchangeRateMap, getSettingsObject, monthWindow } from "../db.js";
import { isLikelyTransfer } from "./categorizer.js";

export function previousMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

export async function getTransactionsForMonth(db, month, userId, extraWhere = "", params = []) {
  const { start, end } = monthWindow(month);
  return db.prepare(
    `SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name,
            io.status AS internal_operation_status, io.kind AS internal_operation_kind
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     LEFT JOIN internal_operations io ON io.id = t.internal_operation_id AND io.user_id = t.user_id
     WHERE t.fecha >= ? AND t.fecha < ? AND t.user_id = ?
     ${extraWhere}
     ORDER BY t.fecha ASC, t.id ASC`
  ).all(start, end, userId, ...params);
}

function pctDelta(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

export async function computeSummary(db, env, month, userId) {
  const [current, previous, categories] = await Promise.all([
    getTransactionsForMonth(db, month, userId),
    getTransactionsForMonth(db, previousMonth(month), userId),
    db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order, id").all(userId),
  ]);

  const settings = await getSettingsObject(env, userId);
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const isTransfer = (tx) => tx.category_type === "transferencia";
  const isInternalMovement = (tx) => tx.movement_kind === "internal_transfer" || tx.movement_kind === "fx_exchange";

  const financialCurrent = current.filter((tx) => !isTransfer(tx) && !isInternalMovement(tx));
  const financialPrevious = previous.filter((tx) => !isTransfer(tx) && !isInternalMovement(tx));
  const toDisplayAmount = (tx) => convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRates);

  const currentIncome = financialCurrent
    .filter((tx) => tx.monto > 0)
    .reduce((sum, tx) => sum + toDisplayAmount(tx), 0);
  const currentExpenses = financialCurrent
    .filter((tx) => tx.monto < 0)
    .reduce((sum, tx) => sum + Math.abs(toDisplayAmount(tx)), 0);
  const previousIncome = financialPrevious
    .filter((tx) => tx.monto > 0)
    .reduce((sum, tx) => sum + convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRates), 0);
  const previousExpenses = financialPrevious
    .filter((tx) => tx.monto < 0)
    .reduce((sum, tx) => sum + Math.abs(convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRates)), 0);

  const byCategoryMap = financialCurrent
    .filter((tx) => tx.monto < 0 && tx.category_name)
    .reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(toDisplayAmount(tx));
      return acc;
    }, {});

  const byType = financialCurrent
    .filter((tx) => tx.monto < 0)
    .reduce((acc, tx) => {
      const type = tx.category_type || "variable";
      acc[type] = (acc[type] || 0) + Math.abs(toDisplayAmount(tx));
      return acc;
    }, { fijo: 0, variable: 0 });

  const budgets = categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    type: cat.type,
    budget: cat.type === "fijo"
      ? (byCategoryMap[cat.name] || 0)
      : convertAmount(cat.budget, "UYU", displayCurrency, exchangeRates),
    color: cat.color,
    spent: byCategoryMap[cat.name] || 0,
  }));

  const accountRows = await db.prepare("SELECT * FROM accounts WHERE user_id = ?").all(userId);
  const consolidated = accountRows.reduce(
    (sum, account) => sum + convertAmount(account.balance, account.currency, displayCurrency, exchangeRates),
    0
  );
  const savingsMonthlyTarget = Number(settings.savings_goal || 0) > 0
    ? Math.round(Number(settings.savings_goal) / 12)
    : 0;

  const installmentsMonth = current
    .filter((tx) => tx.es_cuota)
    .reduce((sum, tx) => sum + Math.abs(toDisplayAmount(tx)), 0);

  return {
    month,
    totals: {
      saldo: consolidated,
      income: currentIncome,
      expenses: currentExpenses,
      margin: currentIncome - currentExpenses,
      installments: installmentsMonth,
      savings_monthly_target: savingsMonthlyTarget,
    },
    deltas: {
      income: pctDelta(currentIncome, previousIncome),
      expenses: pctDelta(currentExpenses, previousExpenses),
    },
    byCategory: budgets.filter((item) => item.spent > 0).sort((a, b) => b.spent - a.spent),
    byType,
    budgets,
    pending_count: current.filter((tx) => tx.categorization_status !== "categorized" && !isLikelyTransfer(tx.desc_banco) && tx.movement_kind !== "internal_transfer" && tx.movement_kind !== "fx_exchange").length,
    currency: displayCurrency,
  };
}

export async function computeMonthlyEvolution(db, env, endMonth, months, userId) {
  const settings = await getSettingsObject(env, userId);
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  const series = [];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const total = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const tx = await getTransactionsForMonth(db, month, userId);
    const financial = tx.filter((item) => item.category_type !== "transferencia" && item.movement_kind !== "internal_transfer" && item.movement_kind !== "fx_exchange");
    series.push({
      month,
      ingresos: financial
        .filter((item) => item.monto > 0)
        .reduce((sum, item) => sum + convertAmount(item.monto, item.moneda, displayCurrency, exchangeRates), 0),
      gastos: financial
        .filter((item) => item.monto < 0)
        .reduce((sum, item) => sum + Math.abs(convertAmount(item.monto, item.moneda, displayCurrency, exchangeRates)), 0),
    });
  }
  return series;
}

export async function computeFutureCommitments(db, startMonth, months, userId, options = {}) {
  const installments = await db.prepare(
    `SELECT i.*, a.currency AS account_currency
     FROM installments i
     LEFT JOIN accounts a ON a.id = i.account_id AND a.user_id = i.user_id
     WHERE i.user_id = ?`
  ).all(userId);
  const targetCurrency = options.currency || null;
  const exchangeRates = options.exchangeRates || {};
  const [startYear, startMonthNum] = startMonth.split("-").map(Number);
  const fallbackInstallmentStart = [startYear, startMonthNum];
  const result = [];
  for (let offset = 0; offset < months; offset += 1) {
    const total = startYear * 12 + (startMonthNum - 1) + offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const monthTotal = installments.reduce((sum, inst) => {
      const instStart = inst.start_month ? inst.start_month.split("-").map(Number) : fallbackInstallmentStart;
      const startAbs = instStart[0] * 12 + (instStart[1] - 1);
      const absMonth = year * 12 + (monthIndex - 1);
      const instNum = absMonth - startAbs + 1;
      if (instNum < inst.cuota_actual || instNum > inst.cantidad_cuotas) return sum;
      const installmentAmount = targetCurrency
        ? convertAmount(inst.monto_cuota, inst.account_currency || targetCurrency, targetCurrency, exchangeRates)
        : inst.monto_cuota;
      return sum + installmentAmount;
    }, 0);
    result.push({ month, total: monthTotal });
  }
  return result;
}
