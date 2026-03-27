const express = require("express");
const { db } = require("../db");

const router = express.Router();

// Flatten stored config into the response shape expected by the frontend:
// { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto }
function formatRow(r) {
  const cfg = JSON.parse(r.config);
  return { format_key: r.key, created_at: r.created_at, ...cfg };
}

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT key, config, created_at FROM bank_formats").all();
  res.json(rows.map(formatRow));
});

router.get("/:key", (req, res) => {
  const row = db.prepare("SELECT key, config, created_at FROM bank_formats WHERE key = ?").get(req.params.key);
  if (!row) return res.status(404).json({ error: "bank format not found" });
  res.json(formatRow(row));
});

router.post("/", (req, res) => {
  // ColumnMapper sends: { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto }
  const { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto } = req.body;
  if (!format_key) {
    return res.status(400).json({ error: "format_key is required" });
  }
  const config = {
    bank_name:  bank_name  ?? null,
    col_fecha:  col_fecha  ?? -1,
    col_desc:   col_desc   ?? -1,
    col_debit:  col_debit  ?? -1,
    col_credit: col_credit ?? -1,
    col_monto:  col_monto  ?? -1,
  };
  db.prepare(
    "INSERT INTO bank_formats (key, config) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET config = excluded.config"
  ).run(format_key, JSON.stringify(config));
  res.status(201).json({ format_key, ...config });
});

router.delete("/:key", (req, res) => {
  db.prepare("DELETE FROM bank_formats WHERE key = ?").run(req.params.key);
  res.status(204).send();
});

module.exports = router;
