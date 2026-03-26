import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

router.get("/recurring", async (c) => {
  const userId = c.get("userId");
  const month  = c.req.query("month");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ error: "month is required in YYYY-MM format" }, 400);
  }
  const db = getDb(c.env);

  const months = [];
  let [y, m]   = month.split("-").map(Number);
  for (let i = 0; i < 4; i++) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m--; if (m === 0) { m = 12; y--; }
  }

  const rows = await db.prepare(
    `SELECT t.fecha, t.desc_banco, t.monto, t.moneda,
            c.name AS category_name, c.color AS category_color
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ?
       AND substr(t.fecha, 1, 7) IN (${months.map(() => "?").join(",")})
       AND t.monto < 0
     ORDER BY t.fecha DESC`
  ).all(userId, ...months);

  const groups = {};
  rows.forEach((tx) => {
    const key = tx.desc_banco.toLowerCase().replace(/\d+/g, "").replace(/[^a-záéíóúñ\s]/gi, "").trim().split(/\s+/).slice(0, 3).join(" ");
    if (!groups[key]) groups[key] = { key, txs: [], months: new Set() };
    groups[key].txs.push(tx);
    groups[key].months.add(tx.fecha.slice(0, 7));
  });

  const recurring = Object.values(groups)
    .filter((g) => g.months.size >= 2)
    .map((g) => {
      const sorted    = [...g.txs].sort((a, b) => b.fecha.localeCompare(a.fecha));
      const latest    = sorted[0];
      const amounts   = g.txs.map((t) => Math.abs(t.monto));
      const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      return {
        pattern:        g.key,
        desc_banco:     latest.desc_banco,
        category_name:  latest.category_name,
        category_color: latest.category_color,
        moneda:         latest.moneda,
        avg_amount:     Math.round(avgAmount),
        months_seen:    [...g.months].sort().reverse(),
        occurrences:    g.txs.length,
      };
    })
    .sort((a, b) => b.avg_amount - a.avg_amount)
    .slice(0, 20);

  return c.json(recurring);
});

router.get("/category-trend", async (c) => {
  const userId = c.get("userId");
  const end    = c.req.query("end") || c.req.query("month");
  const n      = Math.min(12, Number(c.req.query("months") || 3));
  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const db = getDb(c.env);

  const months = [];
  let [y, m]   = end.split("-").map(Number);
  for (let i = 0; i < n; i++) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    m--; if (m === 0) { m = 12; y--; }
  }
  months.reverse();

  const rows = await db.prepare(
    `SELECT substr(t.fecha,1,7) AS month, c.id AS cat_id, c.name AS cat_name, c.color,
            SUM(ABS(t.monto)) AS spent
     FROM transactions t
     JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     WHERE t.monto < 0 AND t.user_id = ?
       AND substr(t.fecha,1,7) IN (${months.map(() => "?").join(",")})
     GROUP BY month, c.id
     ORDER BY month, c.name`
  ).all(userId, ...months);

  const catMap = {};
  rows.forEach((r) => {
    if (!catMap[r.cat_id]) catMap[r.cat_id] = { id: r.cat_id, name: r.cat_name, color: r.color, data: {} };
    catMap[r.cat_id].data[r.month] = r.spent;
  });

  const result = Object.values(catMap).map((cat) => ({
    ...cat,
    series: months.map((mo) => ({ month: mo, spent: cat.data[mo] || 0 })),
  }));

  return c.json({ months, categories: result });
});

export default router;
