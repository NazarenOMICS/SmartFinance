const { getSettingsObject, monthWindow } = require("../db");
const { isLikelyTransfer } = require("./categorizer");

function previousMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
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
        a.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
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

function convertAmount(amount, currency, targetCurrency, usdRate, arsRate) {
  const value = Number(amount || 0);
  const sourceCurrency = currency || targetCurrency || "UYU";
  const safeUsdRate = usdRate > 0 ? usdRate : 42.5;
  const safeArsRate = arsRate > 0 ? arsRate : 0.045;

  if (!targetCurrency || sourceCurrency === targetCurrency) return value;

  let inUYU = value;
  if (sourceCurrency === "USD") inUYU = value * safeUsdRate;
  else if (sourceCurrency === "ARS") inUYU = value * safeArsRate;

  if (targetCurrency === "UYU") return inUYU;
  if (targetCurrency === "USD") return inUYU / safeUsdRate;
  if (targetCurrency === "ARS") return inUYU / safeArsRate;
  return inUYU;
}

function computeSummary(db, month) {
  const current = getTransactionsForMonth(db, month);
  const previous = getTransactionsForMonth(db, previousMonth(month));
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
  const settings = getSettingsObject();
  const exchangeRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";

  // Exclude inter-account transfers / currency exchanges from all financial totals.
  // These have category_type = 'transferencia' and represent money moving between
  // the user's own accounts, not real income or expenses.
  const isTransfer = (tx) => tx.category_type === "transferencia";

  const financialCurrent  = current.filter((tx) => !isTransfer(tx));
  const financialPrevious = previous.filter((tx) => !isTransfer(tx));
  const toDisplayAmount = (tx) =>
    convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRate, arsRate);

  const currentIncome = financialCurrent
    .filter((tx) => tx.monto > 0)
    .reduce((sum, tx) => sum + toDisplayAmount(tx), 0);
  const currentExpenses = financialCurrent
    .filter((tx) => tx.monto < 0)
    .reduce((sum, tx) => sum + Math.abs(toDisplayAmount(tx)), 0);
  const previousIncome = financialPrevious
    .filter((tx) => tx.monto > 0)
    .reduce((sum, tx) => sum + convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRate, arsRate), 0);
  const previousExpenses = financialPrevious
    .filter((tx) => tx.monto < 0)
    .reduce((sum, tx) => sum + Math.abs(convertAmount(tx.monto, tx.moneda, displayCurrency, exchangeRate, arsRate)), 0);

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
      : convertAmount(category.budget, "UYU", displayCurrency, exchangeRate, arsRate),
    color: category.color,
    spent: byCategoryMap[category.name] || 0
  }));

  const accounts = db.prepare("SELECT * FROM accounts").all();
  const consolidated = accounts.reduce((sum, account) => {
    return sum + convertAmount(account.balance, account.currency, displayCurrency, exchangeRate, arsRate);
  }, 0);

  const installmentsMonth = current
    .filter((tx) => tx.es_cuota)
    .reduce((sum, tx) => sum + Math.abs(toDisplayAmount(tx)), 0);

  return {
    month,
    totals: {
      patrimonio: consolidated,
      income: currentIncome,
      expenses: currentExpenses,
      margin: currentIncome - currentExpenses,
      installments: installmentsMonth
    },
    deltas: {
      income: pctDelta(currentIncome, previousIncome),
      expenses: pctDelta(currentExpenses, previousExpenses)
    },
    byCategory: budgets.filter((item) => item.spent > 0),
    byType,
    budgets,
    // Transfers are auto-categorized system entries — don't count as pending review
    pending_count: current.filter((tx) => tx.categorization_status !== "categorized" && !isLikelyTransfer(tx.desc_banco)).length,
    currency: displayCurrency
  };
}

function computeMonthlyEvolution(db, endMonth, months) {
  const settings = getSettingsObject();
  const exchangeRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  const series = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const totalMonths = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = (totalMonths % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const tx = getTransactionsForMonth(db, month);

    const financial = tx.filter((item) => item.category_type !== "transferencia");
    series.push({
      month,
      ingresos: financial
        .filter((item) => item.monto > 0)
        .reduce((sum, item) => sum + convertAmount(item.monto, item.moneda, displayCurrency, exchangeRate, arsRate), 0),
      gastos: financial
        .filter((item) => item.monto < 0)
        .reduce((sum, item) => sum + Math.abs(convertAmount(item.monto, item.moneda, displayCurrency, exchangeRate, arsRate)), 0)
    });
  }

  return series;
}

function computeFutureCommitments(db, startMonth, months, options = {}) {
  const installments = db.prepare(
    `SELECT i.*, a.currency AS account_currency
     FROM installments i
     LEFT JOIN accounts a ON a.id = i.account_id`
  ).all();
  const targetCurrency = options.currency || null;
  const exchangeRate = Number(options.exchangeRateUsd || 42.5);
  const arsRate = Number(options.exchangeRateArs || 0.045);
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
        ? convertAmount(
            installment.monto_cuota,
            installment.account_currency || targetCurrency,
            targetCurrency,
            exchangeRate,
            arsRate
          )
        : installment.monto_cuota;

      return sum + installmentAmount;
    }, 0);

    result.push({ month, total });
  }

  return result;
}

module.exports = {
  computeFutureCommitments,
  computeMonthlyEvolution,
  computeSummary,
  getTransactionsForMonth,
  previousMonth
};

