const express = require("express");
const { getTransactionsForMonth, previousMonth } = require("../services/metrics");
const { db } = require("../db");

const router = express.Router();

// Normalize a description for recurring-detection comparisons:
// lowercase, strip digits and punctuation, collapse spaces
function normalizeDesc(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^a-záéíóúüñ\s]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// GET /api/insights/recurring?month=YYYY-MM
// Returns expense transactions from `month` that also appear in at least one
// of the two preceding months (same normalized description → recurring).
router.get("/recurring", (req, res) => {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  const prev1 = previousMonth(month);
  const prev2 = previousMonth(prev1);

  const expenses = (m) =>
    getTransactionsForMonth(db, m).filter((tx) => tx.monto < 0);

  const current = expenses(month);
  const historicDescs = new Set([
    ...expenses(prev1).map((tx) => normalizeDesc(tx.desc_banco)),
    ...expenses(prev2).map((tx) => normalizeDesc(tx.desc_banco)),
  ]);

  const recurring = current.filter((tx) => historicDescs.has(normalizeDesc(tx.desc_banco)));

  res.json(recurring);
});

// GET /api/insights/category-trend?end=YYYY-MM&months=N
// Returns spending per category for each month in [end-months+1 … end].
router.get("/category-trend", (req, res) => {
  const { end, months: monthsParam } = req.query;
  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: "end is required in YYYY-MM format" });
  }

  const months = Math.max(1, Math.min(Number(monthsParam || 3), 12));
  const [endYear, endMonthNum] = end.split("-").map(Number);
  const series = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const total = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;

    const byCategory = getTransactionsForMonth(db, month)
      .filter((tx) => tx.monto < 0 && tx.category_name)
      .reduce((acc, tx) => {
        acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(tx.monto);
        return acc;
      }, {});

    series.push({ month, byCategory });
  }

  res.json(series);
});

module.exports = router;
