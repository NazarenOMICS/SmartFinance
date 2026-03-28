const express = require("express");
const { getTransactionsForMonth, previousMonth } = require("../services/metrics");
const { db, getSettingsObject, isValidMonthString } = require("../db");

const router = express.Router();

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

// Normalize a description for recurring-detection comparisons:
// lowercase, strip digits and punctuation, collapse spaces
function normalizeDesc(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// GET /api/insights/recurring?month=YYYY-MM
// Returns expense patterns that appear in at least 2 of the 3 months ending
// at `month`. Grouped by normalized description, returning avg_amount,
// occurrences, months_seen, and category info.
router.get("/recurring", (req, res) => {
  const { month } = req.query;
  if (!isValidMonthString(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  const prev1 = previousMonth(month);
  const prev2 = previousMonth(prev1);
  const months = [prev2, prev1, month];

  const expenses = (m) =>
    getTransactionsForMonth(db, m).filter((tx) => tx.monto < 0 && tx.category_type !== "transferencia");

  // Collect all expense transactions across 3 months
  const allExpenses = months.flatMap((m) => expenses(m).map((tx) => ({ ...tx, month: m })));

  // Group by normalized description
  const groups = {};
  for (const tx of allExpenses) {
    const key = `${normalizeDesc(tx.desc_banco)}::${tx.moneda}`;
    if (!groups[key]) {
      groups[key] = {
        desc_banco: tx.desc_banco,
        moneda: tx.moneda,
        category_name: tx.category_name || null,
        category_color: null, // resolved below
        txs: []
      };
    }
    groups[key].desc_banco = tx.desc_banco;
    if (!groups[key].category_name && tx.category_name) {
      groups[key].category_name = tx.category_name;
    }
    groups[key].txs.push(tx);
  }

  // Resolve category color (join categories table)
  const categoryColors = db.prepare("SELECT name, color FROM categories").all()
    .reduce((acc, c) => { acc[c.name] = c.color; return acc; }, {});

  const recurring = Object.values(groups)
    .filter((g) => {
      const monthsSeen = new Set(g.txs.map((tx) => tx.month));
      return monthsSeen.size >= 2;
    })
    .map((g) => {
      const monthsSeen = [...new Set(g.txs.map((tx) => tx.month))].sort();
      const avg_amount = g.txs.reduce((s, tx) => s + Math.abs(tx.monto), 0) / g.txs.length;
      return {
        desc_banco: g.desc_banco,
        moneda: g.moneda,
        category_name: g.category_name,
        category_color: g.category_name ? (categoryColors[g.category_name] || null) : null,
        avg_amount: Number(avg_amount.toFixed(2)),
        occurrences: g.txs.length,
        months_seen: monthsSeen,
      };
    })
    .sort((a, b) => b.avg_amount - a.avg_amount);

  res.json(recurring);
});

// GET /api/insights/category-trend?end=YYYY-MM&months=N
// Returns spending per category for each month in [end-months+1 … end].
router.get("/category-trend", (req, res) => {
  const { end, months: monthsParam } = req.query;
  if (!isValidMonthString(end)) {
    return res.status(400).json({ error: "end is required in YYYY-MM format" });
  }

  const settings = getSettingsObject();
  const usdRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";
  const parsedMonths = Number(monthsParam || 3);
  const months = Number.isInteger(parsedMonths)
    ? Math.max(1, Math.min(parsedMonths, 12))
    : 3;
  const [endYear, endMonthNum] = end.split("-").map(Number);
  const series = [];

  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const total = endYear * 12 + (endMonthNum - 1) - offset;
    const year = Math.floor(total / 12);
    const monthIndex = (total % 12) + 1;
    const month = `${year}-${String(monthIndex).padStart(2, "0")}`;

    const byCategory = getTransactionsForMonth(db, month)
      .filter((tx) => tx.monto < 0 && tx.category_name && tx.category_type !== "transferencia")
      .reduce((acc, tx) => {
        acc[tx.category_name] = (acc[tx.category_name] || 0) + Math.abs(
          convertAmount(tx.monto, tx.moneda, displayCurrency, usdRate, arsRate)
        );
        return acc;
      }, {});

    series.push({ month, byCategory });
  }

  res.json(series);
});

module.exports = router;
