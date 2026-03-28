import { Hono } from "hono";
import { getDb, getSettingsObject, isValidMonthString } from "../db.js";

const router = new Hono();

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

function normalizeDesc(desc) {
  return String(desc || "")
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

router.get("/recurring", async (c) => {
  const userId = c.get("userId");
  const month = c.req.query("month");
  if (!isValidMonthString(month)) {
    return c.json({ error: "month is required in YYYY-MM format" }, 400);
  }
  const db = getDb(c.env);

  const months = [];
  let [year, monthNumber] = month.split("-").map(Number);
  for (let i = 0; i < 3; i += 1) {
    months.push(`${year}-${String(monthNumber).padStart(2, "0")}`);
    monthNumber -= 1;
    if (monthNumber === 0) {
      monthNumber = 12;
      year -= 1;
    }
  }

  const rows = await db.prepare(
    `SELECT t.fecha, t.desc_banco, t.monto, t.moneda,
            c.name AS category_name, c.color AS category_color, c.type AS category_type
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.user_id = ?
       AND substr(t.fecha, 1, 7) IN (${months.map(() => "?").join(",")})
       AND t.monto < 0
       AND (c.type IS NULL OR c.type != 'transferencia')
     ORDER BY t.fecha DESC`
  ).all(userId, ...months);

  const groups = {};
  rows.forEach((tx) => {
    const key = `${normalizeDesc(tx.desc_banco)}::${tx.moneda}`;
    if (!groups[key]) {
      groups[key] = {
        key,
        txs: [],
        months: new Set(),
        category_name: tx.category_name || null,
        category_color: tx.category_color || null,
      };
    }
    groups[key].txs.push(tx);
    groups[key].months.add(tx.fecha.slice(0, 7));
    if (!groups[key].category_name && tx.category_name) {
      groups[key].category_name = tx.category_name;
      groups[key].category_color = tx.category_color || null;
    }
  });

  const recurring = Object.values(groups)
    .filter((group) => group.months.size >= 2)
    .map((group) => {
      const latest = [...group.txs].sort((left, right) => right.fecha.localeCompare(left.fecha))[0];
      const amounts = group.txs.map((tx) => Math.abs(tx.monto));
      const avgAmount = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
      return {
        pattern: group.key,
        desc_banco: latest.desc_banco,
        category_name: group.category_name,
        category_color: group.category_color,
        moneda: latest.moneda,
        avg_amount: Number(avgAmount.toFixed(2)),
        months_seen: [...group.months].sort().reverse(),
        occurrences: group.txs.length,
      };
    })
    .sort((left, right) => right.avg_amount - left.avg_amount)
    .slice(0, 20);

  return c.json(recurring);
});

router.get("/category-trend", async (c) => {
  const userId = c.get("userId");
  const end = c.req.query("end") || c.req.query("month");
  const parsedMonths = Number(c.req.query("months") || 3);
  const monthsCount = Number.isInteger(parsedMonths) ? Math.max(1, Math.min(parsedMonths, 12)) : 3;
  if (!isValidMonthString(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const db = getDb(c.env);
  const settings = await getSettingsObject(c.env, userId);
  const usdRate = Number(settings.exchange_rate_usd_uyu || 42.5);
  const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
  const displayCurrency = settings.display_currency || "UYU";

  const months = [];
  let [year, monthNumber] = end.split("-").map(Number);
  for (let i = 0; i < monthsCount; i += 1) {
    months.push(`${year}-${String(monthNumber).padStart(2, "0")}`);
    monthNumber -= 1;
    if (monthNumber === 0) {
      monthNumber = 12;
      year -= 1;
    }
  }
  months.reverse();

  const rows = await db.prepare(
    `SELECT substr(t.fecha,1,7) AS month, c.name AS cat_name, t.moneda, ABS(t.monto) AS spent
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.monto < 0
       AND t.user_id = ?
       AND c.type != 'transferencia'
       AND substr(t.fecha,1,7) IN (${months.map(() => "?").join(",")})
     ORDER BY month, c.name`
  ).all(userId, ...months);

  const byMonth = Object.fromEntries(months.map((monthKey) => [monthKey, {}]));
  rows.forEach((row) => {
    const converted = convertAmount(row.spent, row.moneda, displayCurrency, usdRate, arsRate);
    byMonth[row.month][row.cat_name] = (byMonth[row.month][row.cat_name] || 0) + converted;
  });

  return c.json(months.map((monthKey) => ({
    month: monthKey,
    byCategory: byMonth[monthKey],
  })));
});

export default router;
