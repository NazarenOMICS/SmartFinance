import { Hono } from "hono";
import { getDb } from "../db.js";
import { applyRuleRetroactively } from "../services/categorizer.js";

const router = new Hono();

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT r.*,c.name AS category_name,c.color AS category_color
     FROM rules r JOIN categories c ON c.id=r.category_id AND c.user_id=r.user_id
     WHERE r.user_id = ?
     ORDER BY r.match_count DESC, r.id ASC`
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const { pattern, category_id } = await c.req.json();
  if (!pattern || !category_id) return c.json({ error: "pattern and category_id are required" }, 400);
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) return c.json({ error: "pattern and category_id are required" }, 400);
  const db = getDb(c.env);
  const category = await db.prepare(
    "SELECT id FROM categories WHERE id = ? AND user_id = ?"
  ).get(Number(category_id), userId);
  if (!category) return c.json({ error: "category not found" }, 404);

  const existing = await db.prepare(
    "SELECT id, category_id FROM rules WHERE user_id = ? AND LOWER(pattern)=LOWER(?) LIMIT 1"
  ).get(userId, normalizedPattern);
  if (existing) {
    if (existing.category_id === Number(category_id)) {
      const rule = await db.prepare("SELECT * FROM rules WHERE id=? AND user_id=?").get(existing.id, userId);
      return c.json({ ...rule, retro_count: 0, duplicate: true }, 200);
    }
    return c.json({ error: `Pattern "${normalizedPattern}" already exists for a different category. Delete the existing rule first.` }, 409);
  }

  const result = await db.prepare(
    "INSERT INTO rules (pattern,category_id,match_count,user_id) VALUES (?,?,0,?)"
  ).run(normalizedPattern, category_id, userId);

  const retroCount = await applyRuleRetroactively(db, normalizedPattern, category_id, userId);
  const rule = await db.prepare("SELECT * FROM rules WHERE id=? AND user_id=?").get(result.lastInsertRowid, userId);
  return c.json({ ...rule, retro_count: retroCount }, 201);
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const existing = await db.prepare("SELECT id FROM rules WHERE id=? AND user_id=?").get(id, userId);
  if (!existing) return c.json({ error: "rule not found" }, 404);
  await db.prepare("DELETE FROM rules WHERE id=? AND user_id=?").run(id, userId);
  return c.json({ ok: true });
});

export default router;
