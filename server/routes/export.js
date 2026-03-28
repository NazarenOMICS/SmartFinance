const express = require("express");
const { db, isValidMonthString, monthWindow } = require("../db");

const router = express.Router();

function csvEscape(value) {
  const raw = value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

router.get("/csv", (req, res) => {
  const { month } = req.query;
  if (!isValidMonthString(month)) {
    return res.status(400).json({ error: "month is required in YYYY-MM format" });
  }

  const { start, end } = monthWindow(month);
  const rows = db
    .prepare(
      `
      SELECT
        t.fecha,
        t.desc_banco,
        t.desc_usuario,
        t.monto,
        t.moneda,
        c.name AS categoria,
        a.name AS cuenta,
        c.type AS tipo_gasto,
        t.es_cuota
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.fecha >= ? AND t.fecha < ?
      ORDER BY t.fecha ASC, t.id ASC
    `
    )
    .all(start, end);

  const lines = [
    "fecha,descripcion_banco,descripcion_usuario,monto,moneda,categoria,cuenta,tipo_gasto,es_cuota",
    ...rows.map((row) =>
      [
        row.fecha,
        csvEscape(row.desc_banco),
        csvEscape(row.desc_usuario),
        row.monto,
        row.moneda,
        csvEscape(row.categoria),
        csvEscape(row.cuenta),
        csvEscape(row.tipo_gasto),
        row.es_cuota
      ].join(",")
    )
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="transactions-${month}.csv"`);
  res.send(lines.join("\n"));
});

module.exports = router;
