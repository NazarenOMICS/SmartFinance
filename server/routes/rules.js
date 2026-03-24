const express = require("express");
const { db } = require("../db");

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

  const result = db.prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)").run(pattern, category_id);
  res.status(201).json(db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid));
});

router.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM rules WHERE id = ?").run(Number(req.params.id));
  res.status(204).send();
});

module.exports = router;

