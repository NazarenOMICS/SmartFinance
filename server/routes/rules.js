const express = require("express");
const { db } = require("../db");
const { ensureDefaultRules, findCandidatesForRule } = require("../services/categorizer");

const router = express.Router();

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT r.*, c.name AS category_name, c.color AS category_color, a.name AS account_name
      FROM rules r
      JOIN categories c ON c.id = r.category_id
      LEFT JOIN accounts a ON a.id = r.account_id
      ORDER BY datetime(r.created_at) DESC, r.match_count DESC, r.id ASC
    `
    )
    .all();

  res.json(rows);
});

router.post("/", (req, res) => {
  const { pattern, category_id, mode = "suggest", confidence = 0.72, account_id = null, currency = null, direction = "any" } = req.body;
  if (!pattern || !category_id) {
    return res.status(400).json({ error: "pattern and category_id are required" });
  }
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return res.status(400).json({ error: "pattern and category_id are required" });
  }
  if (!["auto", "suggest", "disabled"].includes(mode)) {
    return res.status(400).json({ error: "mode must be auto, suggest or disabled" });
  }
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    return res.status(400).json({ error: "confidence must be between 0 and 1" });
  }
  if (!["any", "expense", "income"].includes(direction)) {
    return res.status(400).json({ error: "direction must be any, expense or income" });
  }
  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(category_id));
  if (!category) {
    return res.status(404).json({ error: "category not found" });
  }
  if (account_id) {
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id);
    if (!account) {
      return res.status(404).json({ error: "account not found" });
    }
  }

  const existing = db
    .prepare(
      `SELECT id, category_id FROM rules
       WHERE LOWER(pattern) = LOWER(?)
         AND COALESCE(account_id, '') = COALESCE(?, '')
         AND COALESCE(currency, '') = COALESCE(?, '')
         AND direction = ?
       LIMIT 1`
    )
    .get(normalizedPattern, account_id, currency, direction);

  if (existing) {
    if (existing.category_id === Number(category_id)) {
      const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(existing.id);
      return res.status(200).json({ ...rule, candidates_count: 0, duplicate: true });
    }
    return res.status(409).json({
      error: `Pattern "${normalizedPattern}" already exists for a different category. Delete the existing rule first.`
    });
  }

  const result = db
    .prepare(
      `INSERT INTO rules (
        pattern, category_id, match_count, mode, confidence, source,
        account_id, currency, direction, merchant_key
      ) VALUES (?, ?, 0, ?, ?, 'manual', ?, ?, ?, ?)`
    )
    .run(normalizedPattern, category_id, mode, normalizedConfidence, account_id, currency, direction, normalizedPattern.toLowerCase());
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  const candidates_count = findCandidatesForRule(db, normalizedPattern, Number(category_id)).length;

  res.status(201).json({ ...rule, candidates_count });
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!current) {
    return res.status(404).json({ error: "rule not found" });
  }

  const next = {
    mode: req.body.mode ?? current.mode ?? "suggest",
    confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : Number(current.confidence ?? 0.72),
  };
  if (!["auto", "suggest", "disabled"].includes(next.mode)) {
    return res.status(400).json({ error: "mode must be auto, suggest or disabled" });
  }
  if (!Number.isFinite(next.confidence) || next.confidence < 0 || next.confidence > 1) {
    return res.status(400).json({ error: "confidence must be between 0 and 1" });
  }

  db.prepare("UPDATE rules SET mode = ?, confidence = ? WHERE id = ?").run(next.mode, next.confidence, id);
  res.json(db.prepare("SELECT * FROM rules WHERE id = ?").get(id));
});

router.post("/reset", (req, res) => {
  const deleted_count = db.prepare("SELECT COUNT(*) AS count FROM rules").get().count;

  db.transaction(() => {
    db.prepare("DELETE FROM rules").run();
    ensureDefaultRules(db);
  })();

  const rules_count = db.prepare("SELECT COUNT(*) AS count FROM rules").get().count;
  res.json({ deleted_count, rules_count });
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
