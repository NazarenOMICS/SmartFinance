const express = require("express");
const { db } = require("../db");

const router = express.Router();
const SUPPORTED_CATEGORY_TYPES = new Set(["variable", "fijo", "transferencia"]);

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all();
  res.json(rows);
});

router.post("/", (req, res) => {
  const { name, budget = 0, type = "variable", color = null } = req.body;
  const normalizedName = String(name || "").trim();
  const normalizedBudget = Number(budget);
  if (!normalizedName) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Number.isFinite(normalizedBudget)) {
    return res.status(400).json({ error: "budget must be a finite number" });
  }
  if (!SUPPORTED_CATEGORY_TYPES.has(type)) {
    return res.status(400).json({ error: "type must be fijo, variable or transferencia" });
  }
  const existing = db.prepare(
    "SELECT id FROM categories WHERE name = ? COLLATE NOCASE"
  ).get(normalizedName);
  if (existing) {
    return res.status(409).json({ error: `Ya existe una categoría con el nombre "${normalizedName}"` });
  }

  const result = db
    .prepare("INSERT INTO categories (name, budget, type, color) VALUES (?, ?, ?, ?)")
    .run(normalizedName, normalizedBudget, type, color);

  res.status(201).json(db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "category not found" });
  }

  const next = {
    name: req.body.name !== undefined ? String(req.body.name).trim() : current.name,
    budget: req.body.budget !== undefined ? Number(req.body.budget) : current.budget,
    type: req.body.type ?? current.type,
    color: req.body.color ?? current.color
  };
  if (!next.name) {
    return res.status(400).json({ error: "name is required" });
  }
  if (!Number.isFinite(next.budget)) {
    return res.status(400).json({ error: "budget must be a finite number" });
  }
  if (!SUPPORTED_CATEGORY_TYPES.has(next.type)) {
    return res.status(400).json({ error: "type must be fijo, variable or transferencia" });
  }
  const duplicate = db.prepare(
    "SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id != ?"
  ).get(next.name, id);
  if (duplicate) {
    return res.status(409).json({ error: `Ya existe una categoría con el nombre "${next.name}"` });
  }

  db.prepare("UPDATE categories SET name = ?, budget = ?, type = ?, color = ? WHERE id = ?").run(
    next.name,
    next.budget,
    next.type,
    next.color,
    id
  );

  res.json(db.prepare("SELECT * FROM categories WHERE id = ?").get(id));
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM categories WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "category not found" });
  }
  const hasTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?").get(id).count > 0;

  if (hasTransactions) {
    return res.status(409).json({ error: "category has linked transactions" });
  }

  // Delete linked rules first to avoid FK constraint violation
  db.transaction(() => {
    db.prepare("DELETE FROM rules WHERE category_id = ?").run(id);
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  })();
  res.status(204).send();
});

module.exports = router;

