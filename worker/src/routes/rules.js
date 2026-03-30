import { Hono } from "hono";
import { getDb } from "../db.js";
import { findCandidatesForRule } from "../services/categorizer.js";
import { resetLearnedCategorization } from "../services/taxonomy-store.js";
import { normalizePatternValue } from "../services/taxonomy.js";

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

  const existing = await db.prepare(
    `SELECT id, category_id
     FROM rules
     WHERE user_id = ?
       AND normalized_pattern = ?
       AND COALESCE(account_id, '') = COALESCE(?, '')
       AND COALESCE(currency, '') = COALESCE(?, '')
       AND direction = ?
     LIMIT 1`
  ).get(userId, normalizedPattern, account_id, currency, direction);
  if (existing) {
    if (existing.category_id === Number(category_id)) {
      const rule = await db.prepare("SELECT * FROM rules WHERE id = ? AND user_id = ?").get(existing.id, userId);
      return c.json({ ...rule, candidates_count: 0, duplicate: true }, 200);
    }
    return c.json({ error: `Pattern "${pattern}" already exists for a different category. Delete the existing rule first.` }, 409);
  }

  const result = await db.prepare(
    `INSERT INTO rules (
      pattern, normalized_pattern, category_id, match_count, user_id, mode, confidence, source,
      account_id, currency, direction, merchant_key
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    String(pattern).trim(),
    normalizedPattern,
    category_id,
    userId,
    mode,
    normalizedConfidence,
    source,
    account_id,
    currency,
    direction,
    normalizedPattern
  );

  const candidates_count = (await findCandidatesForRule(db, pattern, category_id, userId)).length;
  const rule = await db.prepare("SELECT * FROM rules WHERE id = ? AND user_id = ?").get(result.lastInsertRowid, userId);
  return c.json({ ...rule, candidates_count }, 201);
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

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const existing = await db.prepare("SELECT id FROM rules WHERE id = ? AND user_id = ?").get(id, userId);
  if (!existing) return c.json({ error: "rule not found" }, 404);
  await db.prepare("DELETE FROM rule_exclusions WHERE user_id = ? AND rule_id = ?").run(userId, id);
  await db.prepare("DELETE FROM rules WHERE id = ? AND user_id = ?").run(id, userId);
  return new Response(null, { status: 204 });
});

export default router;
