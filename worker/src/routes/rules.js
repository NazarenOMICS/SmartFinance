import { Hono } from "hono";
import { getDb } from "../db.js";
import { findCandidatesForRule } from "../services/categorizer.js";
import { resetLearnedCategorization } from "../services/taxonomy-store.js";
import { normalizePatternValue } from "../services/taxonomy.js";
import { recordGlobalPatternLearning } from "../services/global-learning.js";

const router = new Hono();

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT r.*, c.name AS category_name, c.color AS category_color,
            c.slug AS category_slug, a.name AS account_name
     FROM rules r
     JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id
     LEFT JOIN accounts a ON a.id = r.account_id AND a.user_id = r.user_id
     WHERE r.user_id = ?
       AND r.source != 'guided_reject'
     ORDER BY datetime(r.created_at) DESC, r.match_count DESC, r.id ASC`
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const {
    pattern,
    category_id,
    mode = "suggest",
    confidence = 0.72,
    account_id = null,
    currency = null,
    direction = "any",
    source = "manual",
  } = await c.req.json();

  if (!pattern || !category_id) return c.json({ error: "pattern and category_id are required" }, 400);
  const normalizedPattern = normalizePatternValue(pattern);
  if (!normalizedPattern) return c.json({ error: "pattern and category_id are required" }, 400);
  if (!["auto", "suggest", "disabled"].includes(mode)) {
    return c.json({ error: "mode must be auto, suggest or disabled" }, 400);
  }
  const normalizedConfidence = Number(confidence);
  if (!Number.isFinite(normalizedConfidence) || normalizedConfidence < 0 || normalizedConfidence > 1) {
    return c.json({ error: "confidence must be between 0 and 1" }, 400);
  }
  if (!["any", "expense", "income"].includes(direction)) {
    return c.json({ error: "direction must be any, expense or income" }, 400);
  }
  if (!["manual", "guided", "guided_reject"].includes(source)) {
    return c.json({ error: "source must be manual, guided or guided_reject" }, 400);
  }

  const db = getDb(c.env);
  const category = await db.prepare(
    "SELECT id FROM categories WHERE id = ? AND user_id = ?"
  ).get(Number(category_id), userId);
  if (!category) return c.json({ error: "category not found" }, 404);
  if (account_id) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }

  const merchantScope = normalizedPattern;
  const accountScope = account_id || "";
  const currencyScope = currency || "";
  const before = await db.prepare(
    `SELECT id, category_id
     FROM rules
     WHERE user_id = ? AND merchant_scope = ? AND account_scope = ? AND currency_scope = ? AND direction = ?
     LIMIT 1`
  ).get(userId, merchantScope, accountScope, currencyScope, direction);

  await db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, user_id, mode, confidence, source,
      account_id, account_scope, currency, currency_scope, direction, merchant_key, merchant_scope, updated_at
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, merchant_scope, account_scope, currency_scope, direction)
    DO UPDATE SET
      pattern = excluded.pattern,
      normalized_pattern = excluded.normalized_pattern,
      category_id = excluded.category_id,
      mode = excluded.mode,
      confidence = MAX(rules.confidence, excluded.confidence),
      source = excluded.source,
      merchant_key = excluded.merchant_key,
      updated_at = datetime('now')`
  ).run(
    String(pattern).trim(),
    normalizedPattern,
    category_id,
    userId,
    mode,
    normalizedConfidence,
    source,
    account_id,
    accountScope,
    currency,
    currencyScope,
    direction,
    normalizedPattern,
    merchantScope
  );

  const candidates_count = (await findCandidatesForRule(db, pattern, category_id, userId)).length;
  const rule = await db.prepare(
    "SELECT * FROM rules WHERE user_id = ? AND merchant_scope = ? AND account_scope = ? AND currency_scope = ? AND direction = ?"
  ).get(userId, merchantScope, accountScope, currencyScope, direction);
  if (source === "manual" || source === "guided") {
    await recordGlobalPatternLearning(db, userId, String(pattern).trim(), category_id, "confirm");
  }
  return c.json({ ...rule, candidates_count, duplicate: Boolean(before) }, before ? 200 : 201);
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const body = await c.req.json();
  const db = getDb(c.env);
  const current = await db.prepare("SELECT * FROM rules WHERE id = ? AND user_id = ?").get(id, userId);
  if (!current) return c.json({ error: "rule not found" }, 404);

  const next = {
    mode: body.mode ?? current.mode ?? "suggest",
    confidence: body.confidence !== undefined ? Number(body.confidence) : Number(current.confidence ?? 0.72),
  };

  if (!["auto", "suggest", "disabled"].includes(next.mode)) {
    return c.json({ error: "mode must be auto, suggest or disabled" }, 400);
  }
  if (!Number.isFinite(next.confidence) || next.confidence < 0 || next.confidence > 1) {
    return c.json({ error: "confidence must be between 0 and 1" }, 400);
  }

  await db.prepare(
    "UPDATE rules SET mode = ?, confidence = ? WHERE id = ? AND user_id = ?"
  ).run(next.mode, next.confidence, id, userId);

  return c.json(await db.prepare("SELECT * FROM rules WHERE id = ? AND user_id = ?").get(id, userId));
});

router.post("/reset", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  const before = await db.prepare("SELECT COUNT(*) AS count FROM rules WHERE user_id = ?").get(userId);
  await resetLearnedCategorization(db, userId);
  const after = await db.prepare("SELECT COUNT(*) AS count FROM rules WHERE user_id = ?").get(userId);
  return c.json({
    deleted_count: Math.max(Number(before?.count || 0) - Number(after?.count || 0), 0),
    rules_count: Number(after?.count || 0),
  });
});

router.post("/:id/apply-retroactively", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const rule = await db.prepare("SELECT * FROM rules WHERE id = ? AND user_id = ?").get(id, userId);
  if (!rule) return c.json({ error: "rule not found" }, 404);
  const result = await db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = CASE WHEN ? = 'auto' THEN 'categorized' ELSE 'suggested' END,
         category_source = CASE WHEN ? = 'auto' THEN 'rule_auto' ELSE 'rule_suggest' END,
         category_confidence = ?,
         category_rule_id = ?
     WHERE user_id = ?
       AND categorization_status != 'categorized'
       AND merchant_key = ?`
  ).run(rule.category_id, rule.mode, rule.mode, rule.confidence, rule.id, userId, rule.merchant_key || rule.normalized_pattern);
  const affected = Number(result.changes || 0);
  const summary = {
    affected_transactions: affected,
    categorized_transactions: rule.mode === "auto" ? affected : 0,
    suggested_transactions: rule.mode === "auto" ? 0 : affected,
  };
  const jobId = `rule_${id}_${Date.now()}`;
  await db.prepare(
    `INSERT INTO categorization_jobs (id, user_id, type, status, total, processed, result_json, updated_at)
     VALUES (?, ?, 'apply_rule_retroactively', 'completed', ?, ?, ?, datetime('now'))`
  ).run(jobId, userId, affected, affected, JSON.stringify(summary));
  return c.json({ job_id: jobId, status: "completed", ...summary }, 202);
});

router.get("/jobs/:id", async (c) => {
  const userId = c.get("userId");
  const jobId = String(c.req.param("id") || "");
  const db = getDb(c.env);
  const job = await db.prepare(
    "SELECT * FROM categorization_jobs WHERE user_id = ? AND id = ? LIMIT 1"
  ).get(userId, jobId);
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json({ ...job, result: JSON.parse(job.result_json || "{}") });
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const existing = await db.prepare("SELECT id FROM rules WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return c.json({ error: "rule not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM rule_rejections WHERE user_id = ? AND rule_id = ?").bind(userId, id),
    c.env.DB.prepare("DELETE FROM rule_match_log WHERE user_id = ? AND rule_id = ?").bind(userId, id),
    c.env.DB.prepare("DELETE FROM rules WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return new Response(null, { status: 204 });
});

export default router;
