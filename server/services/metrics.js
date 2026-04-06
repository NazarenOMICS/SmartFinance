const { getSettingsObject, monthWindow } = require("../db");
const { getConsolidatedSnapshot } = require("./accounts");

function isInternalTransfer(tx) {
  return (tx.movement_type || "standard") === "internal_transfer";
}

function isCashflowTransaction(tx) {
  return !isInternalTransfer(tx);
}

function isPendingReview(tx) {
  return isCashflowTransaction(tx) && tx.entry_type !== "income" && !tx.category_id;
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
        la.name AS linked_account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN transactions lt ON lt.id = t.linked_transaction_id
      LEFT JOIN accounts la ON la.id = lt.account_id
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
  const currentCashflow = current.filter(isCashflowTransaction);
  const previousCashflow = previous.filter(isCashflowTransaction);
  const consolidated = getConsolidatedSnapshot(db);

  const currentIncome = currentCashflow.filter((tx) => tx.monto > 0).reduce((sum, tx) => sum + tx.monto, 0);
  const currentExpenses = currentCashflow.filter((tx) => tx.monto < 0).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);
  const previousIncome = previousCashflow.filter((tx) => tx.monto > 0).reduce((sum, tx) => sum + tx.monto, 0);
  const previousExpenses = previousCashflow.filter((tx) => tx.monto < 0).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);

  const byCategoryMap = currentCashflow
    .filter((tx) => tx.monto < 0 && tx.category_name)
    .reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto);
      return acc;
    }, {});

  const byType = currentCashflow
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

  const installmentsMonth = currentCashflow.filter((tx) => tx.es_cuota).reduce((sum, tx) => sum + Math.abs(tx.monto), 0);
  const byCategory = budgets.filter((item) => item.spent > 0).sort((left, right) => right.spent - left.spent);

  return {
    month,
    totals: {
      patrimonio: consolidated.total,
      income: currentIncome,
      expenses: currentExpenses,
      margin: currentIncome - currentExpenses,
      installments: installmentsMonth
    },
    deltas: {
      income: pctDelta(currentIncome, previousIncome),
      expenses: pctDelta(currentExpenses, previousExpenses)
    },
    byCategory,
    byType,
    budgets,
    pending_count: current.filter(isPendingReview).length,
    currency: consolidated.currency
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
    const tx = getTransactionsForMonth(db, month).filter(isCashflowTransaction);

    series.push({
      month,
      ingresos: tx.filter((item) => item.monto > 0).reduce((sum, item) => sum + item.monto, 0),
      gastos: tx.filter((item) => item.monto < 0).reduce((sum, item) => sum + Math.abs(item.monto), 0)
    });
  }

  return series;
}

function computeMonthNet(db, month) {
  return getTransactionsForMonth(db, month)
    .filter(isCashflowTransaction)
    .reduce((sum, row) => sum + row.monto, 0);
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
  previousMonth
};

