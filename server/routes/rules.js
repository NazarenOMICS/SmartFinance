const express = require("express");
const { db } = require("../db");
const { extractMerchantKey, findCandidatesForRule } = require("../services/categorizer");
const { buildSeedRules, normalizePatternValue } = require("../services/taxonomy");
const { recordGlobalPatternLearning } = require("../services/global-learning");

const router = express.Router();

function reseedRules() {
  const categories = db.prepare("SELECT id, slug FROM categories").all();
  const bySlug = new Map(categories.map((row) => [row.slug, row.id]));
  const insertRule = db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, account_scope, currency, currency_scope, direction, merchant_key, merchant_scope, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, 'seed', NULL, '', NULL, '', ?, ?, ?, datetime('now'))`
  );

  db.transaction(() => {
    db.prepare("DELETE FROM rules WHERE source = 'seed'").run();
    for (const rule of buildSeedRules()) {
      const categoryId = bySlug.get(rule.slug);
      if (!categoryId) continue;
      insertRule.run(
        rule.pattern,
        rule.normalized_pattern,
        categoryId,
        rule.mode,
        rule.confidence,
        rule.direction,
        rule.merchant_key,
        rule.merchant_key || rule.normalized_pattern
      );
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

  const merchantKey = extractMerchantKey(pattern) || normalizedPattern;
  const merchantScope = merchantKey || normalizedPattern;
  const accountScope = account_id || "";
  const currencyScope = currency || "";
  const existing = db.prepare(
    `SELECT id FROM rules
     WHERE merchant_scope = ?
       AND account_scope = ?
       AND currency_scope = ?
       AND direction = ?
     LIMIT 1`
  ).get(merchantScope, accountScope, currencyScope, direction);

  const result = db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, mode, confidence, source,
      account_id, account_scope, currency, currency_scope, direction, merchant_key, merchant_scope, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(merchant_scope, account_scope, currency_scope, direction)
    DO UPDATE SET
      pattern = excluded.pattern,
      normalized_pattern = excluded.normalized_pattern,
      merchant_key = excluded.merchant_key,
      category_id = excluded.category_id,
      mode = excluded.mode,
      confidence = MAX(rules.confidence, excluded.confidence),
      source = excluded.source,
      match_count = rules.match_count + 1,
      last_matched_at = datetime('now'),
      updated_at = datetime('now')`
  ).run(
    String(pattern).trim(),
    normalizedPattern,
    category_id,
    mode,
    normalizedConfidence,
    source,
    account_id,
    accountScope,
    currency,
    currencyScope,
    direction,
    merchantKey,
    merchantScope
  );

  const rule = db.prepare(
    `SELECT * FROM rules
     WHERE merchant_scope = ?
       AND account_scope = ?
       AND currency_scope = ?
       AND direction = ?
     LIMIT 1`
  ).get(merchantScope, accountScope, currencyScope, direction);
  const candidates_count = findCandidatesForRule(db, String(pattern).trim(), Number(category_id)).length;
  if (source === "manual" || source === "guided") {
    recordGlobalPatternLearning(db, "local-user", String(pattern).trim(), category_id, "confirm");
  }
  res.status(existing ? 200 : 201).json({ ...rule, candidates_count, upserted: Boolean(existing || result.changes) });
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

router.post("/:id/apply-retroactively", (req, res) => {
  const id = Number(req.params.id);
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(id);
  if (!rule) return res.status(404).json({ error: "rule not found" });
  if (!rule.category_id) return res.status(400).json({ error: "rule has no category assigned" });

  const jobResult = db.transaction(() => {
    const insertJob = db.prepare(
      `INSERT INTO categorization_jobs (kind, status, total_count, processed_count, result_json)
       VALUES ('apply_rule_retroactively', 'running', 0, 0, '{}')`
    ).run();

    // Fetch uncategorized candidates that match the rule pattern (paginated, max 500 per run)
    const candidates = db.prepare(
      `SELECT id, desc_banco, monto, moneda, account_id, entry_type
       FROM transactions
       WHERE categorization_status != 'categorized'
         AND LOWER(desc_banco) LIKE '%' || LOWER(?) || '%'
       ORDER BY fecha DESC, id DESC
       LIMIT 500`
    ).all(rule.normalized_pattern || "");

    let affected = 0;
    let categorized = 0;
    let suggested = 0;

    for (const candidate of candidates) {
      if (rule.mode === 'disabled') continue;

      const update = db.prepare(
        `UPDATE transactions
         SET category_id = ?,
             categorization_status = ?,
             category_source = 'rule_retroactive',
             category_confidence = ?,
             category_rule_id = ?
         WHERE id = ?`
      ).run(
        Number(rule.category_id),
        rule.mode === 'auto' ? 'categorized' : 'suggested',
        Number(rule.confidence ?? 0.72),
        id,
        candidate.id
      );

      if (update.changes > 0) {
        affected += 1;
        if (rule.mode === 'auto') categorized += 1;
        else suggested += 1;
      }
    }

    db.prepare(
      `UPDATE categorization_jobs
       SET status = 'completed',
           total_count = ?,
           processed_count = ?,
           result_json = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(affected, affected, JSON.stringify({ updated_transactions: affected, categorized, suggested }), insertJob.lastInsertRowid);

    return { id: insertJob.lastInsertRowid, affected, categorized, suggested };
  })();

  res.status(202).json({
    job_id: jobResult.id,
    status: "completed",
    total_count: jobResult.affected,
    processed_count: jobResult.affected,
    updated_transactions: jobResult.affected,
    categorized_count: jobResult.categorized,
    suggested_count: jobResult.suggested,
  });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM rules WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "rule not found" });
  db.transaction(() => {
    db.prepare("DELETE FROM rule_exclusions WHERE rule_id = ?").run(id);
    db.prepare("DELETE FROM rule_rejections WHERE rule_id = ?").run(id);
    db.prepare("DELETE FROM rule_match_log WHERE rule_id = ?").run(id);
    db.prepare("DELETE FROM rules WHERE id = ?").run(id);
  })();
  res.status(204).send();
});

module.exports = router;
