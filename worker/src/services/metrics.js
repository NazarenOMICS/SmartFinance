import { monthWindow, getSettingsObject } from "../db.js";

export function previousMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const prevYear = monthNum === 1 ? year - 1 : year;
  const prevMonth = monthNum === 1 ? 12 : monthNum - 1;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

export async function getTransactionsForMonth(db, month, userId, extraWhere = "", params = []) {
  const { start, end } = monthWindow(month);
  return db.prepare(
    `SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
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
    db.prepare("SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order, id").all(userId)
  ]);

  const settings = await getSettingsObject(env, userId);
  const exchangeRate    = Number(settings.exchange_rate_usd_uyu || 42.5);
  const exchangeRateArs = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";

  const currentIncome    = current.filter((tx) => tx.monto > 0).reduce((s, tx) => s + tx.monto, 0);
  const currentExpenses  = current.filter((tx) => tx.monto < 0).reduce((s, tx) => s + Math.abs(tx.monto), 0);
  const previousIncome   = previous.filter((tx) => tx.monto > 0).reduce((s, tx) => s + tx.monto, 0);
  const previousExpenses = previous.filter((tx) => tx.monto < 0).reduce((s, tx) => s + Math.abs(tx.monto), 0);

  const byCategoryMap = current
    .filter((tx) => tx.monto < 0 && tx.category_name)
    .reduce((acc, tx) => { acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto); return acc; }, {});

  const byType = current
    .filter((tx) => tx.monto < 0)
    .reduce((acc, tx) => {
      const type = tx.category_type || "variable";
      acc[type] = (acc[type] || 0) + Math.abs(tx.monto);
      return acc;
    }, { fijo: 0, variable: 0 });

  const budgets = categories.map((cat) => ({
    id: cat.id, name: cat.name, type: cat.type, budget: cat.budget,
    color: cat.color, spent: byCategoryMap[cat.name] || 0
  }));

  const accounts = await db.prepare("SELECT * FROM accounts WHERE user_id = ?").all(userId);
  const toDisplay = (balance, currency) => {
    if (currency === displayCurrency) return balance;
    if (displayCurrency === "UYU") {
      if (currency === "USD") return balance * exchangeRate;
      if (currency === "ARS") return balance * exchangeRateArs;
    }
    if (displayCurrency === "USD") {
      if (currency === "UYU") return balance / exchangeRate;
      if (currency === "ARS") return (balance * exchangeRateArs) / exchangeRate;
    }
    return balance;
  };
  const consolidated = accounts.reduce((sum, acc) => sum + toDisplay(acc.balance, acc.currency), 0);

  const installmentsMonth = current.filter((tx) => tx.es_cuota).reduce((s, tx) => s + Math.abs(tx.monto), 0);

  return {
    month,
    totals: { patrimonio: consolidated, income: currentIncome, expenses: currentExpenses,
              margin: currentIncome - currentExpenses, installments: installmentsMonth },
    deltas: { income: pctDelta(currentIncome, previousIncome), expenses: pctDelta(currentExpenses, previousExpenses) },
    byCategory: budgets.filter((item) => item.spent > 0),
    byType, budgets,
    pending_count: current.filter((tx) => !tx.category_id).length,
    currency: displayCurrency
  };
}

export async function computeMonthlyEvolution(db, endMonth, months, userId) {
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  const series = [];
  for (let offset = months - 1; offset >= 0; offset--) {
    const total = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const tx = await getTransactionsForMonth(db, month, userId);
    series.push({
      month,
      ingresos: tx.filter((t) => t.monto > 0).reduce((s, t) => s + t.monto, 0),
      gastos:   tx.filter((t) => t.monto < 0).reduce((s, t) => s + Math.abs(t.monto), 0)
    });
  }
  return series;
}

export async function computeFutureCommitments(db, startMonth, months, userId) {
  const installments = await db.prepare("SELECT * FROM installments WHERE user_id = ?").all(userId);
  const [startYear, startMonthNum] = startMonth.split("-").map(Number);
  const result = [];
  for (let offset = 0; offset < months; offset++) {
    const total = startYear * 12 + (startMonthNum - 1) + offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;
    const monthTotal = installments.reduce((sum, inst) => {
      const instStart = inst.start_month ? inst.start_month.split("-").map(Number) : [year, monthIndex];
      const startAbs = instStart[0] * 12 + (instStart[1] - 1);
      const absMonth = year * 12 + (monthIndex - 1);
      const instNum = absMonth - startAbs + 1;
      if (instNum < inst.cuota_actual || instNum > inst.cantidad_cuotas) return sum;
      return sum + inst.monto_cuota;
    }, 0);
    result.push({ month, total: monthTotal });
  }
  return result;
}
