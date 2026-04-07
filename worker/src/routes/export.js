import { Hono } from "hono";
import { getDb, isValidMonthString, monthWindow } from "../db.js";

const router = new Hono();

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  const escaped = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${escaped.replace(/"/g, '""')}"`;
}

router.get("/csv", async (c) => {
  const userId = c.get("userId");
  const month  = c.req.query("month");
  if (!isValidMonthString(month)) return c.json({ error: "month is required in YYYY-MM format" }, 400);

  const { start, end } = monthWindow(month);
  const db   = getDb(c.env);
  const rows = await db.prepare(
    `SELECT t.fecha,t.desc_banco,t.desc_usuario,t.monto,t.moneda,
            c.name AS categoria,a.name AS cuenta,c.type AS tipo_gasto,t.es_cuota
     FROM transactions t
     LEFT JOIN categories c ON c.id=t.category_id AND c.user_id=t.user_id
     LEFT JOIN accounts a ON a.id=t.account_id AND a.user_id=t.user_id
     WHERE t.user_id=? AND t.fecha>=? AND t.fecha<? ORDER BY t.fecha ASC,t.id ASC`
  ).all(userId, start, end);

  const lines = [
    "fecha,descripcion_banco,descripcion_usuario,monto,moneda,categoria,cuenta,tipo_gasto,es_cuota",
    ...rows.map((row) =>
      [row.fecha, csvEscape(row.desc_banco), csvEscape(row.desc_usuario),
       row.monto, row.moneda, csvEscape(row.categoria), csvEscape(row.cuenta),
       csvEscape(row.tipo_gasto), row.es_cuota].join(",")
    )
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${month}.csv"`
    }
  });
});

export default router;
