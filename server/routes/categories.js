const express = require("express");
const { db } = require("../db");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all();
  res.json(rows);
});

router.post("/", (req, res) => {
  const { name, budget = 0, type = "variable", color = null } = req.body;
  if (!name) {
    return res.status(400).json({ error: "name is required" });
  }

  const result = db
    .prepare("INSERT INTO categories (name, budget, type, color) VALUES (?, ?, ?, ?)")
    .run(name, budget, type, color);

  res.status(201).json(db.prepare("SELECT * FROM categories WHERE id = ?").get(result.lastInsertRowid));
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "category not found" });
  }

  const next = {
    name: req.body.name ?? current.name,
    budget: req.body.budget ?? current.budget,
    type: req.body.type ?? current.type,
    color: req.body.color ?? current.color
  };

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
  const hasTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?").get(id).count > 0;

  if (hasTransactions) {
    return res.status(409).json({ error: "category has linked transactions" });
  }

  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  res.status(204).send();
});

module.exports = router;

