const express = require("express");
const { db, getSettingsObject } = require("../db");
const { computeFutureCommitments } = require("../services/metrics");

const router = express.Router();

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

router.get("/commitments", (req, res) => {
  const months = parsePositiveInt(req.query.months || 6, 6, 24);
  const start = req.query.start;
  if (!start || !/^\d{4}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: "start is required in YYYY-MM format" });
  }
  const settings = getSettingsObject();
  res.json(computeFutureCommitments(db, start, months, {
    currency: settings.display_currency || "UYU",
    exchangeRateUsd: Number(settings.exchange_rate_usd_uyu || 42.5),
    exchangeRateArs: Number(settings.exchange_rate_ars_uyu || 0.045)
  }));
});

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT i.*, a.name AS account_name, a.currency AS account_currency
      FROM installments i
      LEFT JOIN accounts a ON a.id = i.account_id
      WHERE i.cuota_actual <= i.cantidad_cuotas
      ORDER BY i.created_at DESC
    `
    )
    .all();
  res.json(rows);
});

router.post("/", (req, res) => {
  const { descripcion, monto_total, cantidad_cuotas, account_id = null, start_month } = req.body;
  if (!descripcion || !monto_total || !cantidad_cuotas || !start_month) {
    return res.status(400).json({ error: "descripcion, monto_total, cantidad_cuotas and start_month are required" });
  }
  if (!/^\d{4}-\d{2}$/.test(start_month)) {
    return res.status(400).json({ error: "start_month must be in YYYY-MM format" });
  }
  const cuotas = parsePositiveInt(cantidad_cuotas, null);
  const total = Number(monto_total);
  if (!cuotas || !Number.isFinite(total)) {
    return res.status(400).json({ error: "monto_total and cantidad_cuotas must be valid numbers" });
  }
  if (account_id) {
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id);
    if (!account) {
      return res.status(404).json({ error: "account not found" });
    }
  }

  const monto_cuota = Math.round(total / cuotas);
  const result = db
    .prepare(
      `
      INSERT INTO installments (
        descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
    `
    )
    .run(descripcion, total, cuotas, monto_cuota, account_id, start_month);

  res.status(201).json(db.prepare("SELECT * FROM installments WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM installments WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "installment not found" });
  }

  const cuotaActual = req.body.cuota_actual ?? current.cuota_actual;
  if (!parsePositiveInt(cuotaActual, null)) {
    return res.status(400).json({ error: "cuota_actual must be a positive integer" });
  }
  db.prepare("UPDATE installments SET cuota_actual = ? WHERE id = ?").run(cuotaActual, id);
  res.json(db.prepare("SELECT * FROM installments WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM installments WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "installment not found" });
  }
  db.prepare("DELETE FROM installments WHERE id = ?").run(id);
  res.status(204).send();
});

module.exports = router;

