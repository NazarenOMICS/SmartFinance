const express = require("express");
const { db, getSettingsObject, monthWindow } = require("../db");
const { computeFutureCommitments, previousMonth } = require("../services/metrics");

const router = express.Router();

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

function monthNet(month) {
  const { start, end } = monthWindow(month);
  const rows = db.prepare("SELECT monto FROM transactions WHERE fecha >= ? AND fecha < ?").all(start, end);
  return rows.reduce((sum, row) => sum + row.monto, 0);
}

function nextMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const absolute = year * 12 + (monthNum - 1) + 1;
  const nextYear = Math.floor(absolute / 12);
  const nextMonthNum = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonthNum).padStart(2, "0")}`;
}

router.get("/projection", (req, res) => {
  const months = Math.max(1, Number(req.query.months || 12));
  const settings = getSettingsObject();
  const baseMonth = req.query.end || "2026-03";
  const historicalMonths = getMonthSeries(6, baseMonth);
  const avgSavings =
    historicalMonths.reduce((sum, month) => sum + monthNet(month), 0) / Math.max(1, historicalMonths.length);
  const commitments = computeFutureCommitments(db, nextMonth(baseMonth), months);
  const initial = Number(settings.savings_initial || 0);
  const goal = Number(settings.savings_goal || 0);
  let accumulated = initial;

  const historical = historicalMonths.map((month) => {
    accumulated += monthNet(month);
    return { month, real: Math.max(0, accumulated), projected: null, goal };
  });

  const projected = commitments.map((commitment) => {
    accumulated += avgSavings - commitment.total;
    return { month: commitment.month, real: null, projected: Math.max(0, accumulated), goal };
  });

  res.json({
    average_monthly_savings: Math.round(avgSavings),
    initial,
    goal,
    currency: settings.savings_currency || "UYU",
    commitments,
    series: [...historical, ...projected]
  });
});

router.get("/insights", (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  const settings = getSettingsObject();
  const prevMonth = previousMonth(month);
  const { start, end } = monthWindow(month);
  const prevWindow = monthWindow(prevMonth);

  const current = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.budget
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.fecha >= ? AND t.fecha < ?
    `
    )
    .all(start, end);

  const previous = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.fecha >= ? AND t.fecha < ?
    `
    )
    .all(prevWindow.start, prevWindow.end);

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
  const activeDay =
    today.getFullYear() === year && today.getMonth() + 1 === monthNum ? today.getDate() : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - activeDay);
  const remainingBudget = totalBudget - totalExpenses;

  const commitments = computeFutureCommitments(db, month, 6);
  const avgSavings =
    getMonthSeries(6, month).reduce((sum, item) => sum + monthNet(item), 0) / 6;
  const currentSaved = Number(settings.savings_initial || 0) + getMonthSeries(6, month).reduce((sum, item) => sum + monthNet(item), 0);
  const avgNet = avgSavings - (commitments[0]?.total || 0);
  const remainingGoal = Number(settings.savings_goal || 0) - currentSaved;
  const etaMonths = avgNet > 0 && remainingGoal > 0 ? Math.ceil(remainingGoal / avgNet) : null;

  res.json({
    growth,
    daily_average_spend: Math.round(totalExpenses / Math.max(1, activeDay)),
    days_left: daysLeft,
    remaining_budget: remainingBudget,
    budget_per_day: daysLeft > 0 ? Math.round(remainingBudget / daysLeft) : 0,
    eta_months: etaMonths
  });
});

module.exports = router;
