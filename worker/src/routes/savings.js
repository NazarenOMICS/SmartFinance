import { Hono } from "hono";
import { getDb, getSettingsObject, monthWindow } from "../db.js";
import { computeFutureCommitments, previousMonth } from "../services/metrics.js";

const router = new Hono();

function getMonthSeries(months, endMonth) {
  const [year, monthNum] = endMonth.split("-").map(Number);
  return Array.from({ length: months }, (_, i) => {
    const offset = months - 1 - i;
    const abs = year * 12 + (monthNum - 1) - offset;
    return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}`;
  });
}

// Net savings = income - expenses (positive = saved money)
async function monthNet(db, month) {
  const { start, end } = monthWindow(month);
  const row = await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN monto > 0 THEN monto ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN monto < 0 THEN ABS(monto) ELSE 0 END), 0) AS expenses
     FROM transactions WHERE fecha >= ? AND fecha < ?`
  ).get(start, end);
  return (row?.income || 0) - (row?.expenses || 0);
}

function nextMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const abs = year * 12 + (monthNum - 1) + 1;
  return `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, "0")}`;
}

router.get("/projection", async (c) => {
  const months = Math.max(1, Number(c.req.query("months") || 12));
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const baseMonth = c.req.query("end") || currentMonth;
  const db = getDb(c.env);
  const settings = await getSettingsObject(c.env);
  const historicalMonths = getMonthSeries(6, baseMonth);
  const nets = await Promise.all(historicalMonths.map((m) => monthNet(db, m)));
  const avgSavings = nets.reduce((s, n) => s + n, 0) / Math.max(1, nets.length);
  const commitments = await computeFutureCommitments(db, nextMonth(baseMonth), months);
  const initial = Number(settings.savings_initial || 0);
  let accumulated = initial;

  const historical = historicalMonths.map((month, i) => {
    accumulated += nets[i];
    return { month, real: Math.max(0, accumulated), projected: null, goal: Number(settings.savings_goal || 0) };
  });

  const goal = Number(settings.savings_goal || 0);
  const projected = commitments.map((commitment) => {
    accumulated += avgSavings - commitment.total;
    return { month: commitment.month, real: null, projected: Math.max(0, accumulated), goal };
  });

  return c.json({
    average_monthly_savings: Math.round(avgSavings),
    initial, goal,
    currency: settings.savings_currency || "UYU",
    commitments,
    series: [...historical, ...projected]
  });
});

router.get("/insights", async (c) => {
  const month = c.req.query("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "month is required in YYYY-MM format" }, 400);

  const db = getDb(c.env);
  const settings = await getSettingsObject(c.env);
  const prevMonth = previousMonth(month);
  const { start, end } = monthWindow(month);
  const prevWindow = monthWindow(prevMonth);

  const [current, previous] = await Promise.all([
    db.prepare(`SELECT t.*,c.name AS category_name,c.budget FROM transactions t
                LEFT JOIN categories c ON c.id=t.category_id WHERE t.fecha>=? AND t.fecha<?`).all(start, end),
    db.prepare(`SELECT t.*,c.name AS category_name FROM transactions t
                LEFT JOIN categories c ON c.id=t.category_id WHERE t.fecha>=? AND t.fecha<?`).all(prevWindow.start, prevWindow.end)
  ]);

  const byCategory = (rows) => rows
    .filter((tx) => tx.monto < 0 && tx.category_name)
    .reduce((acc, tx) => { acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto); return acc; }, {});

  const currentByCat = byCategory(current);
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

  const totalExpenses = current.filter((tx) => tx.monto < 0).reduce((s, tx) => s + Math.abs(tx.monto), 0);
  const totalBudget = (await db.prepare("SELECT COALESCE(SUM(budget),0) AS total FROM categories").get()).total;
  const today = new Date();
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const activeDay = today.getFullYear() === year && today.getMonth() + 1 === monthNum ? today.getDate() : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - activeDay);
  const remainingBudget = totalBudget - totalExpenses;

  const commitments = await computeFutureCommitments(db, month, 6);
  const seriesNets = await Promise.all(getMonthSeries(6, month).map((m) => monthNet(db, m)));
  const avgSavings = seriesNets.reduce((s, n) => s + n, 0) / 6;
  const currentSaved = Number(settings.savings_initial || 0) + seriesNets.reduce((s, n) => s + n, 0);
  const avgNet = avgSavings - (commitments[0]?.total || 0);
  const remainingGoal = Number(settings.savings_goal || 0) - currentSaved;
  const etaMonths = avgNet > 0 && remainingGoal > 0 ? Math.ceil(remainingGoal / avgNet) : null;

  return c.json({
    growth,
    daily_average_spend: Math.round(totalExpenses / Math.max(1, activeDay)),
    days_left: daysLeft,
    remaining_budget: remainingBudget,
    budget_per_day: daysLeft > 0 ? Math.round(remainingBudget / daysLeft) : 0,
    eta_months: etaMonths
  });
});

export default router;
