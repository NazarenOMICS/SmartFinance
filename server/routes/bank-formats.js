const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT key, config, created_at FROM bank_formats").all();
  res.json(rows.map((r) => ({ ...r, config: JSON.parse(r.config) })));
});

router.get("/:key", (req, res) => {
  const row = db.prepare("SELECT key, config, created_at FROM bank_formats WHERE key = ?").get(req.params.key);
  if (!row) return res.status(404).json({ error: "bank format not found" });
  res.json({ ...row, config: JSON.parse(row.config) });
});

router.post("/", (req, res) => {
  const { key, config } = req.body;
  if (!key || !config) {
    return res.status(400).json({ error: "key and config are required" });
  }
  db.prepare(
    "INSERT INTO bank_formats (key, config) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET config = excluded.config"
  ).run(key, JSON.stringify(config));
  res.status(201).json({ key, config });
});

router.delete("/:key", (req, res) => {
  db.prepare("DELETE FROM bank_formats WHERE key = ?").run(req.params.key);
  res.status(204).send();
});

module.exports = router;
