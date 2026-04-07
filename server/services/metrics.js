const { convertAmount, getExchangeRateMap, getSettingsObject, monthWindow } = require("../db");
const { isLikelyTransfer } = require("./categorizer");

function isInternalTransfer(tx) {
  return (tx.movement_type || "standard") === "internal_transfer" ||
    tx.movement_kind === "internal_transfer" || tx.movement_kind === "fx_exchange";
}

function isCashflowTransaction(tx) {
  return !isInternalTransfer(tx) && tx.category_type !== "transferencia";
}

function previousMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function nextMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const absolute = year * 12 + (monthNum - 1) + 1;
  const nextYear = Math.floor(absolute / 12);
  const nextMonthNum = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonthNum).padStart(2, "0")}`;
}

function getMonthSeries(months, endMonth) {
  const [year, monthNum] = endMonth.split("-").map(Number);
  return Array.from({ length: months }, (_, index) => {
    const offset = months - 1 - index;
    const absolute = year * 12 + (monthNum - 1) - offset;
    const rowYear = Math.floor(absolute / 12);
    const rowMonth = (absolute % 12) + 1;
    return `${rowYear}-${String(rowMonth).padStart(2, "0")}`;
  });
}

function getTransactionsForMonth(db, month, extraWhere = "", params = []) {
  const { start, end } = monthWindow(month);
  return db
    .prepare(
      `
      SELECT
        t.*,
        c.name AS category_name,
        c.type AS category_type,
        a.name AS account_name,
        lt.account_id AS linked_account_id,
        la.name AS linked_account_name,
        io.status AS internal_operation_status,
        io.kind AS internal_operation_kind
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN transactions lt ON lt.id = t.linked_transaction_id
      LEFT JOIN accounts la ON la.id = lt.account_id
      LEFT JOIN internal_operations io ON io.id = t.internal_operation_id
      WHERE t.fecha >= ? AND t.fecha < ?
      ${extraWhere}
      ORDER BY t.fecha ASC, t.id ASC
    `
    )
    .all(start, end, ...params);
}

function pctDelta(current, previous) {
  if (!previous) {
    return current ? 100 : 0;
  }
  return ((current - previous) / previous) * 100;
}

function computeSummary(db, month) {
  const current = getTransactionsForMonth(db, month);
  const previous = getTransactionsForMonth(db, previousMonth(month));
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
  const settings = getSettingsObject();
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
    .reduce(
      (acc, tx) => {
        const type = tx.category_type || "variable";
        acc[type] = (acc[type] || 0) + Math.abs(toDisplayAmount(tx));
        return acc;
      },
      { fijo: 0, variable: 0 }
    );

  const budgets = categories.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type,
    budget: category.type === "fijo"
      ? (byCategoryMap[category.name] || 0)
      : convertAmount(category.budget, "UYU", displayCurrency, exchangeRates),
    color: category.color,
    spent: byCategoryMap[category.name] || 0,
  }));

  const accounts = db.prepare("SELECT * FROM accounts").all();
  const consolidated = accounts.reduce((sum, account) => {
    return sum + convertAmount(account.balance, account.currency, displayCurrency, exchangeRates);
  }, 0);

  const installmentsMonth = current
    .filter((tx) => tx.es_cuota)
    .reduce((sum, tx) => sum + Math.abs(toDisplayAmount(tx)), 0);

  const byCategory = budgets.filter((item) => item.spent > 0).sort((left, right) => right.spent - left.spent);

  return {
    month,
    totals: {
      patrimonio: consolidated,
      income: currentIncome,
      expenses: currentExpenses,
      margin: currentIncome - currentExpenses,
      installments: installmentsMonth,
    },
    deltas: {
      income: pctDelta(currentIncome, previousIncome),
      expenses: pctDelta(currentExpenses, previousExpenses),
    },
    byCategory,
    byType,
    budgets,
    pending_count: current.filter((tx) => tx.categorization_status !== "categorized" && !isLikelyTransfer(tx.desc_banco)).length,
    currency: displayCurrency,
  };
}

function computeMonthlyEvolution(db, endMonth, months) {
  const settings = getSettingsObject();
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  const series = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const totalMonths = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = (totalMonths % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const tx = getTransactionsForMonth(db, month).filter(isCashflowTransaction);

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

function computeMonthNet(db, month) {
  return getTransactionsForMonth(db, month)
    .filter(isCashflowTransaction)
    .reduce((sum, row) => sum + row.monto, 0);
}

function computeFutureCommitments(db, startMonth, months, options = {}) {
  const installments = db.prepare(
    `SELECT i.*, a.currency AS account_currency
     FROM installments i
     LEFT JOIN accounts a ON a.id = i.account_id`
  ).all();
  const targetCurrency = options.currency || null;
  const exchangeRates = options.exchangeRates || {
    UYU: 1,
    USD: Number(options.exchangeRateUsd || 42.5),
    EUR: Number(options.exchangeRateEur || 46.5),
    ARS: Number(options.exchangeRateArs || 0.045),
  };
  const [startYear, startMonthNum] = startMonth.split("-").map(Number);
  const fallbackInstallmentStart = [startYear, startMonthNum];
  const result = [];

  for (let offset = 0; offset < months; offset += 1) {
    const totalMonths = startYear * 12 + (startMonthNum - 1) + offset;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = (totalMonths % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const total = installments.reduce((sum, installment) => {
      const installmentStart = installment.start_month
        ? installment.start_month.split("-").map(Number)
        : fallbackInstallmentStart;
      const startAbsolute = installmentStart[0] * 12 + (installmentStart[1] - 1);
      const absoluteMonth = year * 12 + (monthIndex - 1);
      const installmentNumber = absoluteMonth - startAbsolute + 1;

      if (installmentNumber < installment.cuota_actual || installmentNumber > installment.cantidad_cuotas) {
        return sum;
      }

      const installmentAmount = targetCurrency
        ? convertAmount(installment.monto_cuota, installment.account_currency || targetCurrency, targetCurrency, exchangeRates)
        : installment.monto_cuota;

      return sum + installmentAmount;
    }, 0);

    result.push({ month, total });
  }

  return result;
}

function computeInsights(db, month) {
  const current = getTransactionsForMonth(db, month).filter(isCashflowTransaction);
  const previous = getTransactionsForMonth(db, previousMonth(month)).filter(isCashflowTransaction);

  const byCategory = (rows) =>
    rows.filter((tx) => tx.monto < 0 && tx.category_name).reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto);
      return acc;
    }, {});

  const currentByCategory = byCategory(current);
  const previousByCategory = byCategory(previous);
  let growth = null;

  Object.keys(currentByCategory).forEach((category) => {
    const prev = previousByCategory[category] || 0;
    if (!prev) return;

    const curr = currentByCategory[category];
    const deltaPct = ((curr - prev) / prev) * 100;
    if (!growth || deltaPct > growth.delta_pct) {
      growth = { category, delta_pct: deltaPct, current_amount: curr, previous_amount: prev };
    }
  });

  const totalExpenses = current.filter((tx) => tx.monto < 0).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);
  const totalBudget = db.prepare("SELECT COALESCE(SUM(budget), 0) AS total FROM categories").get().total;
  const today = new Date();
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const isActiveMonth = today.getFullYear() === year && today.getMonth() + 1 === monthNum;
  const activeDay = isActiveMonth ? today.getDate() : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - activeDay);
  const remainingBudget = totalBudget - totalExpenses;

  const commitments = computeFutureCommitments(db, month, 6);
  const lastSixMonths = getMonthSeries(6, month);
  const avgSavings = lastSixMonths.reduce((sum, item) => sum + computeMonthNet(db, item), 0) / Math.max(1, lastSixMonths.length);
  const settings = getSettingsObject();
  const currentSaved = Number(settings.savings_initial || 0) + lastSixMonths.reduce((sum, item) => sum + computeMonthNet(db, item), 0);
  const avgNet = avgSavings - (commitments[0]?.total || 0);
  const remainingGoal = Number(settings.savings_goal || 0) - currentSaved;
  const etaMonths = avgNet > 0 && remainingGoal > 0 ? Math.ceil(remainingGoal / avgNet) : null;

  return {
    growth,
    daily_average_spend: Math.round(totalExpenses / Math.max(1, activeDay)),
    days_left: daysLeft,
    remaining_budget: remainingBudget,
    budget_per_day: daysLeft > 0 ? Math.round(remainingBudget / daysLeft) : 0,
    eta_months: etaMonths
  };
}

function computeDashboardPayload(db, month) {
  return {
    month,
    summary: computeSummary(db, month),
    evolution: computeMonthlyEvolution(db, month, 6),
    transactions: getTransactionsForMonth(db, month),
    categories: db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all()
  };
}

module.exports = {
  computeDashboardPayload,
  computeFutureCommitments,
  computeInsights,
  computeMonthNet,
  computeMonthlyEvolution,
  computeSummary,
  getMonthSeries,
  getTransactionsForMonth,
  isCashflowTransaction,
  isInternalTransfer,
  nextMonth,
  previousMonth,
};
