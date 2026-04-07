import { Hono } from "hono";
import { convertAmount, getDb, getExchangeRateMap, getSettingsObject, isValidMonthString, monthWindow } from "../db.js";
import { computeFutureCommitments, previousMonth } from "../services/metrics.js";

const router = new Hono();

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

function getMonthSeries(months, endMonth) {
  const [year, monthNum] = endMonth.split("-").map(Number);
  return Array.from({ length: months }, (_, i) => {
    const offset = months - 1 - i;
    const abs = year * 12 + (monthNum - 1) - offset;
    return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}`;
  });
}

async function monthNet(db, month, userId, targetCurrency, exchangeRates) {
  const { start, end } = monthWindow(month);
  const rows = await db.prepare(
    `SELECT t.monto, t.moneda
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.fecha >= ? AND t.fecha < ? AND t.user_id = ?
       AND (c.type IS NULL OR c.type != 'transferencia')`
  ).all(start, end, userId);
  return rows.reduce(
    (sum, row) => sum + convertAmount(row.monto, row.moneda, targetCurrency, exchangeRates),
    0
  );
}

function nextMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const abs = year * 12 + (monthNum - 1) + 1;
  return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}`;
}

router.get("/projection", async (c) => {
  const userId  = c.get("userId");
  const months  = parsePositiveInt(c.req.query("months") || 12, 12, 60);
  const now     = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const baseMonth    = c.req.query("end") || currentMonth;
  if (c.req.query("end") && !isValidMonthString(c.req.query("end"))) {
    return c.json({ error: "end must be in YYYY-MM format" }, 400);
  }
  const db       = getDb(c.env);
  const settings = await getSettingsObject(c.env, userId);
  const savingsCurrency = settings.savings_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const historicalMonths = getMonthSeries(6, baseMonth);
  const nets = await Promise.all(
    historicalMonths.map((m) => monthNet(db, m, userId, savingsCurrency, exchangeRates))
  );
  const avgSavings = nets.reduce((s, n) => s + n, 0) / Math.max(1, nets.length);
  const commitments = await computeFutureCommitments(db, nextMonth(baseMonth), months, userId, {
    currency: savingsCurrency,
    exchangeRates,
  });
  const initial = Number(settings.savings_initial || 0);
  let accumulated = initial;

  const historical = historicalMonths.map((month, i) => {
    accumulated += nets[i];
    return { month, real: Math.max(0, accumulated), projected: null, goal: Number(settings.savings_goal || 0) };
  });

  const goal      = Number(settings.savings_goal || 0);
  const projected = commitments.map((commitment) => {
    accumulated += avgSavings - commitment.total;
    return { month: commitment.month, real: null, projected: Math.max(0, accumulated), goal };
  });

  return c.json({
    average_monthly_savings: Number(avgSavings.toFixed(2)),
    initial, goal,
    currency: savingsCurrency,
    commitments,
    series: [...historical, ...projected]
  });
});

router.get("/insights", async (c) => {
  const userId = c.get("userId");
  const month  = c.req.query("month");
  if (!isValidMonthString(month)) return c.json({ error: "month is required in YYYY-MM format" }, 400);

  const db       = getDb(c.env);
  const settings = await getSettingsObject(c.env, userId);
  const savingsCurrency = settings.savings_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const prevMo   = previousMonth(month);
  const { start, end }       = monthWindow(month);
  const prevWindow           = monthWindow(prevMo);

  const [current, previous] = await Promise.all([
    db.prepare(
      `SELECT t.*,c.name AS category_name,c.type AS category_type,c.budget FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
       WHERE t.fecha>=? AND t.fecha<? AND t.user_id=?
         AND (c.type IS NULL OR c.type != 'transferencia')`
     ).all(start, end, userId),
    db.prepare(
      `SELECT t.*,c.name AS category_name,c.type AS category_type FROM transactions t
       LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
       WHERE t.fecha>=? AND t.fecha<? AND t.user_id=?
         AND (c.type IS NULL OR c.type != 'transferencia')`
     ).all(prevWindow.start, prevWindow.end, userId)
  ]);

  const byCategory = (rows) => rows
    .filter((tx) => tx.monto < 0 && tx.category_name)
        .reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(
        convertAmount(tx.monto, tx.moneda, savingsCurrency, exchangeRates)
      );
      return acc;
    }, {});

  const currentByCat  = byCategory(current);
  const previousByCat = byCategory(previous);

  let growth = null;
  Object.keys(currentByCat).forEach((cat) => {
    const prev = previousByCat[cat] || 0;
    if (!prev) return;
    const deltaPct = ((currentByCat[cat] - prev) / prev) * 100;
    if (!growth || deltaPct > growth.delta_pct) {
      growth = { category: cat, delta_pct: deltaPct, current_amount: currentByCat[cat], previous_amount: prev };
    }
  });

  const totalExpenses = current
    .filter((tx) => tx.monto < 0)
    .reduce((s, tx) => s + Math.abs(convertAmount(tx.monto, tx.moneda, savingsCurrency, exchangeRates)), 0);
  const totalBudgetUyu = (await db.prepare(
    "SELECT COALESCE(SUM(budget),0) AS total FROM categories WHERE user_id=? AND type != 'fijo'"
  ).get(userId)).total;
  const totalBudget = convertAmount(totalBudgetUyu, "UYU", savingsCurrency, exchangeRates);

  const today = new Date();
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const activeDay   = today.getFullYear() === year && today.getMonth() + 1 === monthNum ? today.getDate() : daysInMonth;
  const daysLeft    = Math.max(0, daysInMonth - activeDay);
  const remainingBudget = totalBudget - totalExpenses;

  const commitments = await computeFutureCommitments(db, month, 6, userId, {
    currency: savingsCurrency,
    exchangeRates,
  });
  const seriesNets = await Promise.all(
    getMonthSeries(6, month).map((m) => monthNet(db, m, userId, savingsCurrency, exchangeRates))
  );
  const avgSavings   = seriesNets.reduce((s, n) => s + n, 0) / 6;
  const currentSaved = Number(settings.savings_initial || 0) + seriesNets.reduce((s, n) => s + n, 0);
  const avgNet       = avgSavings - (commitments[0]?.total || 0);
  const remainingGoal = Number(settings.savings_goal || 0) - currentSaved;
  const etaMonths     = avgNet > 0 && remainingGoal > 0 ? Math.ceil(remainingGoal / avgNet) : null;

  return c.json({
    growth,
    daily_average_spend: Number((totalExpenses / Math.max(1, activeDay)).toFixed(2)),
    days_left:     daysLeft,
    remaining_budget: remainingBudget,
    budget_exhausted: remainingBudget < 0,
    budget_per_day: daysLeft > 0 ? Number((remainingBudget / daysLeft).toFixed(2)) : 0,
    eta_months:    etaMonths,
    currency: savingsCurrency
  });
});

export default router;
