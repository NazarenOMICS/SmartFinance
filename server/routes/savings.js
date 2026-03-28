const express = require("express");
const { db, getSettingsObject, isValidMonthString, monthWindow } = require("../db");
const { computeFutureCommitments, previousMonth } = require("../services/metrics");

const router = express.Router();

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
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

function monthNet(month, targetCurrency, usdRate, arsRate) {
  const { start, end } = monthWindow(month);
  const rows = db
    .prepare(
      `SELECT t.monto, t.moneda FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.fecha >= ? AND t.fecha < ?
       AND (c.type IS NULL OR c.type != 'transferencia')`
    )
    .all(start, end);
  return rows.reduce(
    (sum, row) => sum + convertAmount(row.monto, row.moneda, targetCurrency, usdRate, arsRate),
    0
  );
}

function nextMonth(month) {
  const [year, monthNum] = month.split("-").map(Number);
  const absolute = year * 12 + (monthNum - 1) + 1;
  const nextYear = Math.floor(absolute / 12);
  const nextMonthNum = (absolute % 12) + 1;
  return `${nextYear}-${String(nextMonthNum).padStart(2, "0")}`;
}

router.get("/projection", (req, res) => {
  const months = parsePositiveInt(req.query.months || 12, 12, 60);
  const settings = getSettingsObject();
  const today = new Date();
  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const baseMonth = req.query.end || currentMonth;
  if (req.query.end && !isValidMonthString(req.query.end)) {
    return res.status(400).json({ error: "end must be in YYYY-MM format" });
  }
  const savingsCurrency = settings.savings_currency || "UYU";
  const usdRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const historicalMonths = getMonthSeries(6, baseMonth);
  const avgSavings =
    historicalMonths.reduce((sum, month) => sum + monthNet(month, savingsCurrency, usdRate, arsRate), 0) / Math.max(1, historicalMonths.length);
  const commitments = computeFutureCommitments(db, nextMonth(baseMonth), months, {
    currency: savingsCurrency,
    exchangeRateUsd: usdRate,
    exchangeRateArs: arsRate
  });
  const initial = Number(settings.savings_initial || 0);
  const goal = Number(settings.savings_goal || 0);
  let accumulated = initial;

  const historical = historicalMonths.map((month) => {
    accumulated += monthNet(month, savingsCurrency, usdRate, arsRate);
    return { month, real: Math.max(0, accumulated), projected: null, goal };
  });

  const projected = commitments.map((commitment) => {
    accumulated += avgSavings - commitment.total;
    return { month: commitment.month, real: null, projected: Math.max(0, accumulated), goal };
  });

  res.json({
    average_monthly_savings: Number(avgSavings.toFixed(2)),
    initial,
    goal,
    currency: savingsCurrency,
    commitments,
    series: [...historical, ...projected]
  });
});

router.get("/insights", (req, res) => {
  const month = req.query.month;
  if (!isValidMonthString(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  const settings = getSettingsObject();
  const savingsCurrency = settings.savings_currency || "UYU";
  const usdRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const prevMonth = previousMonth(month);
  const { start, end } = monthWindow(month);
  const prevWindow = monthWindow(prevMonth);

  const current = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.type AS category_type, c.budget
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.fecha >= ? AND t.fecha < ?
      AND (c.type IS NULL OR c.type != 'transferencia')
    `
    )
    .all(start, end);

  const previous = db
    .prepare(
      `
      SELECT t.*, c.name AS category_name, c.type AS category_type
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE t.fecha >= ? AND t.fecha < ?
      AND (c.type IS NULL OR c.type != 'transferencia')
    `
    )
    .all(prevWindow.start, prevWindow.end);

  const byCategory = (rows) =>
    rows.filter((tx) => tx.monto < 0 && tx.category_name).reduce((acc, tx) => {
      acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(
        convertAmount(tx.monto, tx.moneda, savingsCurrency, usdRate, arsRate)
      );
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

  const totalExpenses = current
    .filter((tx) => tx.monto < 0 && tx.category_name !== "Transferencia")
    .reduce((sum, tx) => sum + Math.abs(convertAmount(tx.monto, tx.moneda, savingsCurrency, usdRate, arsRate)), 0);
  const totalBudgetUyu = db.prepare("SELECT COALESCE(SUM(budget), 0) AS total FROM categories").get().total;
  const totalBudget = convertAmount(totalBudgetUyu, "UYU", savingsCurrency, usdRate, arsRate);
  const today = new Date();
  const [year, monthNum] = month.split("-").map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();
  const activeDay =
    today.getFullYear() === year && today.getMonth() + 1 === monthNum ? today.getDate() : daysInMonth;
  const daysLeft = Math.max(0, daysInMonth - activeDay);
  const remainingBudget = totalBudget - totalExpenses;

  const commitments = computeFutureCommitments(db, month, 6, {
    currency: savingsCurrency,
    exchangeRateUsd: usdRate,
    exchangeRateArs: arsRate
  });
  const historicalNets = getMonthSeries(6, month).map((m) => monthNet(m, savingsCurrency, usdRate, arsRate));
  const totalHistoricalNet = historicalNets.reduce((s, n) => s + n, 0);
  const avgSavings = totalHistoricalNet / 6;
  const currentSaved = Number(settings.savings_initial || 0) + totalHistoricalNet;
  const avgNet = avgSavings - (commitments[0]?.total || 0);
  const remainingGoal = Number(settings.savings_goal || 0) - currentSaved;
  const etaMonths = avgNet > 0 && remainingGoal > 0 ? Math.ceil(remainingGoal / avgNet) : null;

  res.json({
    growth,
    daily_average_spend: Number((totalExpenses / Math.max(1, activeDay)).toFixed(2)),
    days_left: daysLeft,
    remaining_budget: remainingBudget,
    budget_exhausted: remainingBudget < 0,
    budget_per_day: daysLeft > 0 ? Number((remainingBudget / daysLeft).toFixed(2)) : 0,
    eta_months: etaMonths,
    currency: savingsCurrency
  });
});

module.exports = router;
