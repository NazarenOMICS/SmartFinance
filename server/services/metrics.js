const { getSettingsObject, monthWindow } = require("../db");

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

function computeSummary(db, month) {
  const current = getTransactionsForMonth(db, month);
  const previous = getTransactionsForMonth(db, previousMonth(month));
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all();
  const settings = getSettingsObject();
  const exchangeRate = Number(settings.exchange_rate_usd_uyu || 1);
  const displayCurrency = settings.display_currency || "UYU";

  const currentIncome = current.filter((tx) => tx.monto > 0).reduce((sum, tx) => sum + tx.monto, 0);
  const currentExpenses = current.filter((tx) => tx.monto < 0).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);
  const previousIncome = previous.filter((tx) => tx.monto > 0).reduce((sum, tx) => sum + tx.monto, 0);
  const previousExpenses = previous.filter((tx) => tx.monto < 0).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);

  const byCategoryMap = current
    .filter((tx) => tx.monto < 0 && tx.category_name)
    .reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto);
      return acc;
    }, {});

  const byType = current
    .filter((tx) => tx.monto < 0)
    .reduce(
      (acc, tx) => {
        const type = tx.category_type || "variable";
        acc[type] = (acc[type] || 0) + Math.abs(tx.monto);
        return acc;
      },
      { fijo: 0, variable: 0 }
    );

  const budgets = categories.map((category) => ({
    id: category.id,
    name: category.name,
    type: category.type,
    budget: category.budget,
    color: category.color,
    spent: byCategoryMap[category.name] || 0
  }));

  const accounts = db.prepare("SELECT * FROM accounts").all();
  const consolidated = accounts.reduce((sum, account) => {
    if (displayCurrency === account.currency) {
      return sum + account.balance;
    }
    if (displayCurrency === "UYU" && account.currency === "USD") {
      return sum + account.balance * exchangeRate;
    }
    if (displayCurrency === "USD" && account.currency === "UYU") {
      return sum + account.balance / exchangeRate;
    }
    return sum + account.balance;
  }, 0);

  const installmentsMonth = current.filter((tx) => tx.es_cuota).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);

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
    pending_count: current.filter((tx) => !tx.category_id).length,
    currency: displayCurrency
  };
}

function computeMonthlyEvolution(db, endMonth, months) {
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  const series = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const totalMonths = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = (totalMonths % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const tx = getTransactionsForMonth(db, month);

    series.push({
      month,
      ingresos: tx.filter((item) => item.monto > 0).reduce((sum, item) => sum + item.monto, 0),
      gastos: tx.filter((item) => item.monto < 0).reduce((sum, item) => sum + Math.abs(item.monto), 0)
    });
  }

  return series;
}

function computeFutureCommitments(db, startMonth, months) {
  const installments = db.prepare("SELECT * FROM installments").all();
  const [startYear, startMonthNum] = startMonth.split("-").map(Number);
  const result = [];

  for (let offset = 0; offset < months; offset += 1) {
    const totalMonths = startYear * 12 + (startMonthNum - 1) + offset;
    const year = Math.floor(totalMonths / 12);
    const monthIndex = (totalMonths % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const total = installments.reduce((sum, installment) => {
      const installmentStart = installment.start_month ? installment.start_month.split("-").map(Number) : [year, monthIndex];
      const startAbsolute = installmentStart[0] * 12 + (installmentStart[1] - 1);
      const absoluteMonth = year * 12 + (monthIndex - 1);
      const installmentNumber = absoluteMonth - startAbsolute + 1;

      if (installmentNumber < installment.cuota_actual || installmentNumber > installment.cantidad_cuotas) {
        return sum;
      }

      return sum + installment.monto_cuota;
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

