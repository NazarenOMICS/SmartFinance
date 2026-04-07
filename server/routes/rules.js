const express = require("express");
const { db } = require("../db");
const { findCandidatesForRule } = require("../services/categorizer");
const { buildSeedRules, normalizePatternValue } = require("../services/taxonomy");
const { recordGlobalPatternLearning } = require("../services/global-learning");

const router = express.Router();

function reseedRules() {
  const categories = db.prepare("SELECT id, slug FROM categories").all();
  const bySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const insertRule = db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, currency, direction, merchant_key
    ) VALUES (?, ?, ?, 0, ?, ?, 'seed', NULL, NULL, ?, ?)`
  );

  db.transaction(() => {
    db.prepare("DELETE FROM rules WHERE source = 'seed'").run();
    for (const rule of buildSeedRules()) {
      const categoryId = bySlug.get(rule.slug);
      if (!categoryId) continue;
      insertRule.run(rule.pattern, rule.normalized_pattern, categoryId, rule.mode, rule.confidence, rule.direction, rule.merchant_key);
    }
  })();
}

router.get("/", (req, res) => {
  const rows = db.prepare(
    `SELECT r.*, c.name AS category_name, c.color AS category_color, c.slug AS category_slug, a.name AS account_name
     FROM rules r
     JOIN categories c ON c.id = r.category_id
     LEFT JOIN accounts a ON a.id = r.account_id
     WHERE r.source != 'guided_reject'
     ORDER BY datetime(r.created_at) DESC, r.match_count DESC, r.id ASC`
  ).all();
  res.json(rows);
});

router.post("/", (req, res) => {
  const { pattern, category_id, mode = "suggest", confidence = 0.72, account_id = null, currency = null, direction = "any", source = "manual" } = req.body;
  if (!pattern || !category_id) return res.status(400).json({ error: "pattern and category_id are required" });
  const normalizedPattern = normalizePatternValue(pattern);
  if (!normalizedPattern) return res.status(400).json({ error: "pattern and category_id are required" });
  if (!["auto", "suggest", "disabled"].includes(mode)) return res.status(400).json({ error: "mode must be auto, suggest or disabled" });
  if (!["manual", "guided", "guided_reject"].includes(source)) return res.status(400).json({ error: "source must be manual, guided or guided_reject" });
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    return res.status(400).json({ error: "confidence must be between 0 and 1" });
  }
  if (!["any", "expense", "income"].includes(direction)) return res.status(400).json({ error: "direction must be any, expense or income" });

  const category = db.prepare("SELECT id FROM categories WHERE id = ?").get(Number(category_id));
  if (!category) return res.status(404).json({ error: "category not found" });
  if (account_id) {
    const account = db.prepare("SELECT id FROM accounts WHERE id = ?").get(account_id);
    if (!account) return res.status(404).json({ error: "account not found" });
  }

  const existing = db.prepare(
    `SELECT id, category_id FROM rules
     WHERE normalized_pattern = ?
       AND COALESCE(account_id, '') = COALESCE(?, '')
       AND COALESCE(currency, '') = COALESCE(?, '')
       AND direction = ?
     LIMIT 1`
  ).get(normalizedPattern, account_id, currency, direction);
  if (existing) {
    if (existing.category_id === Number(category_id)) {
      const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(existing.id);
      return res.status(200).json({ ...rule, candidates_count: 0, duplicate: true });
    }
    return res.status(409).json({ error: `Pattern "${pattern}" already exists for a different category. Delete the existing rule first.` });
  }

  const result = db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, currency, direction, merchant_key
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
  ).run(String(pattern).trim(), normalizedPattern, category_id, mode, normalizedConfidence, source, account_id, currency, direction, normalizedPattern);

  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(result.lastInsertRowid);
  const candidates_count = findCandidatesForRule(db, String(pattern).trim(), Number(category_id)).length;
  if (source === "manual" || source === "guided") {
    recordGlobalPatternLearning(db, "local-user", String(pattern).trim(), category_id, "confirm");
  }
  res.status(201).json({ ...rule, candidates_count });
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "rule not found" });

  const next = {
    mode: req.body.mode ?? current.mode ?? "suggest",
    confidence: req.body.confidence !== undefined ? Number(req.body.confidence) : Number(current.confidence ?? 0.72),
  };
  if (!["auto", "suggest", "disabled"].includes(next.mode)) return res.status(400).json({ error: "mode must be auto, suggest or disabled" });
  if (!Number.isFinite(next.confidence) || next.confidence < 0 || next.confidence > 1) {
    return res.status(400).json({ error: "confidence must be between 0 and 1" });
  }

  db.prepare("UPDATE rules SET mode = ?, confidence = ? WHERE id = ?").run(next.mode, next.confidence, id);
  res.json(db.prepare("SELECT * FROM rules WHERE id = ?").get(id));
});

router.post("/reset", (req, res) => {
  const deleted_count = db.prepare("SELECT COUNT(*) AS count FROM rules WHERE source != 'seed'").get().count;
  db.transaction(() => {
    db.prepare("DELETE FROM rules WHERE source != 'seed'").run();
    db.prepare("DELETE FROM rule_exclusions").run();
    db.prepare("DELETE FROM categorization_events").run();
    db.prepare(
      `UPDATE transactions
       SET category_id = NULL,
           categorization_status = 'uncategorized',
           category_source = NULL,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE category_source IN ('rule_auto', 'rule_review', 'upload_review', 'ollama_auto', 'ollama_suggest')`
    ).run();
    db.prepare("DELETE FROM categories WHERE origin = 'auto'").run();
    reseedRules();
  })();
  const rules_count = db.prepare("SELECT COUNT(*) AS count FROM rules").get().count;
  res.json({ deleted_count, rules_count });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM rules WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "rule not found" });
  db.transaction(() => {
    db.prepare("DELETE FROM rule_exclusions WHERE rule_id = ?").run(id);
    db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  })();
  res.status(204).send();
});

module.exports = router;
