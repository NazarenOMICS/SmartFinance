const express = require("express");
const { db, getSettingsObject } = require("../db");
const { computeFutureCommitments, computeInsights, computeMonthNet, getMonthSeries, nextMonth } = require("../services/metrics");

const router = express.Router();

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

router.get("/projection", (req, res) => {
  const months = Math.max(1, Number(req.query.months || 12));
  const settings = getSettingsObject();
  const baseMonth = req.query.end || currentMonth();
  const historicalMonths = getMonthSeries(6, baseMonth);
  const avgSavings =
    historicalMonths.reduce((sum, month) => sum + computeMonthNet(db, month), 0) / Math.max(1, historicalMonths.length);
  const commitments = computeFutureCommitments(db, nextMonth(baseMonth), months);
  const initial = Number(settings.savings_initial || 0);
  const goal = Number(settings.savings_goal || 0);
  let accumulated = initial;

  const historical = historicalMonths.map((month) => {
    accumulated += computeMonthNet(db, month);
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

  res.json(computeInsights(db, month));
});

module.exports = router;
