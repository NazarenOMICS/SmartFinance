const express = require("express");
const { db } = require("../db");
const { applyRuleRetroactively } = require("../services/categorizer");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT r.*, c.name AS category_name, c.color AS category_color
      FROM rules r
      JOIN categories c ON c.id = r.category_id
      ORDER BY r.match_count DESC, r.id ASC
    `
    )
    .all();

  res.json(rows);
});

router.post("/", (req, res) => {
  const { pattern, category_id } = req.body;
  if (!pattern || !category_id) {
    return res.status(400).json({ error: "pattern and category_id are required" });
  }
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return res.status(400).json({ error: "pattern and category_id are required" });
  }
  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(category_id));
  if (!category) {
    return res.status(404).json({ error: "category not found" });
  }

  // Prevent duplicate patterns (same pattern, same or different category)
  const existing = db
    .prepare("SELECT id, category_id FROM rules WHERE LOWER(pattern) = LOWER(?) LIMIT 1")
    .get(normalizedPattern);

  if (existing) {
    if (existing.category_id === Number(category_id)) {
      // Identical rule already exists — return it with retro_count = 0
      const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(existing.id);
      return res.status(200).json({ ...rule, retro_count: 0, duplicate: true });
    }
    return res.status(409).json({
      error: `Pattern "${normalizedPattern}" already exists for a different category. Delete the existing rule first.`
    });
  }

  const result = db.prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)").run(normalizedPattern, category_id);
  const retro_count = applyRuleRetroactively(db, normalizedPattern, category_id);
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ ...rule, retro_count });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM rules WHERE id = ?").get(id);
  if (!existing) {
    return res.status(404).json({ error: "rule not found" });
  }
  db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  res.status(204).send();
});

module.exports = router;

