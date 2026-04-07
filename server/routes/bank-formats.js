const express = require("express");
const { db } = require("../db");

const router = express.Router();

function parseColumnIndex(value) {
  if (value == null || value === "") return -1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -1 ? parsed : null;
}

// Flatten stored config into the response shape expected by the frontend:
// { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto }
function formatRow(r) {
  let cfg;
  try {
    cfg = JSON.parse(r.config);
  } catch (_) {
    return null;
  }
  return { format_key: r.key, created_at: r.created_at, ...cfg };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT key, config, created_at FROM bank_formats").all();
  res.json(rows.map(formatRow).filter(Boolean));
});

router.get("/:key", (req, res) => {
  const row = db.prepare("SELECT key, config, created_at FROM bank_formats WHERE key = ?").get(req.params.key);
  if (!row) return res.status(404).json({ error: "bank format not found" });
  const formatted = formatRow(row);
  if (!formatted) return res.status(500).json({ error: "bank format config is invalid" });
  res.json(formatted);
});

router.post("/", (req, res) => {
  // ColumnMapper sends: { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto }
  const formatKey = String(req.body.format_key || "").trim();
  const bankName = req.body.bank_name == null ? null : String(req.body.bank_name).trim() || null;
  const colFecha = parseColumnIndex(req.body.col_fecha);
  const colDesc = parseColumnIndex(req.body.col_desc);
  const colDebit = parseColumnIndex(req.body.col_debit);
  const colCredit = parseColumnIndex(req.body.col_credit);
  const colMonto = parseColumnIndex(req.body.col_monto);

  if (!formatKey) {
    return res.status(400).json({ error: "format_key is required" });
  }
  if ([colFecha, colDesc, colDebit, colCredit, colMonto].some((value) => value === null)) {
    return res.status(400).json({ error: "column indexes must be integers greater than or equal to -1" });
  }
  if (colFecha < 0 || colDesc < 0 || (colMonto < 0 && colDebit < 0 && colCredit < 0)) {
    return res.status(400).json({ error: "format must include fecha, descripcion and at least one amount column" });
  }
  const assignedColumns = [colFecha, colDesc, colDebit, colCredit, colMonto].filter((value) => value >= 0);
  if (new Set(assignedColumns).size !== assignedColumns.length) {
    return res.status(400).json({ error: "each role must use a different column" });
  }

  const config = {
    bank_name: bankName,
    col_fecha: colFecha,
    col_desc: colDesc,
    col_debit: colDebit,
    col_credit: colCredit,
    col_monto: colMonto,
  };
  db.prepare(
    "INSERT INTO bank_formats (key, config) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET config = excluded.config"
  ).run(formatKey, JSON.stringify(config));
  res.status(201).json({ format_key: formatKey, ...config });
});

router.delete("/:key", (req, res) => {
  const result = db.prepare("DELETE FROM bank_formats WHERE key = ?").run(req.params.key);
  if (result.changes === 0) {
    return res.status(404).json({ error: "bank format not found" });
  }
  res.status(204).send();
});

module.exports = router;
