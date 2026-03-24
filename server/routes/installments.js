const express = require("express");
const { db } = require("../db");
const { computeFutureCommitments } = require("../services/metrics");

const router = express.Router();

router.get("/commitments", (req, res) => {
  const months = Math.max(1, Number(req.query.months || 6));
  const start = req.query.start;
  if (!start || !/^\d{4}-\d{2}$/.test(start)) {
    return res.status(400).json({ error: "start is required in YYYY-MM format" });
  }
  res.json(computeFutureCommitments(db, start, months));
});

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT i.*, a.name AS account_name
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

  const monto_cuota = Math.round(Number(monto_total) / Number(cantidad_cuotas));
  const result = db
    .prepare(
      `
      INSERT INTO installments (
        descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
    `
    )
    .run(descripcion, monto_total, cantidad_cuotas, monto_cuota, account_id, start_month);

  res.status(201).json(db.prepare("SELECT * FROM installments WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM installments WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "installment not found" });
  }

  const cuotaActual = req.body.cuota_actual ?? current.cuota_actual;
  db.prepare("UPDATE installments SET cuota_actual = ? WHERE id = ?").run(cuotaActual, id);
  res.json(db.prepare("SELECT * FROM installments WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM installments WHERE id = ?").run(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;

