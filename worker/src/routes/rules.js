import { Hono } from "hono";
import { getDb } from "../db.js";
import { applyAllRulesRetroactively } from "../services/categorizer.js";

const router = new Hono();

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT r.*,c.name AS category_name,c.color AS category_color
     FROM rules r JOIN categories c ON c.id=r.category_id
     WHERE r.user_id = ?
     ORDER BY r.match_count DESC, r.id ASC`
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const { pattern, category_id } = await c.req.json();
  if (!pattern || !category_id) return c.json({ error: "pattern and category_id are required" }, 400);
  const db = getDb(c.env);

  const existing = await db.prepare(
    "SELECT id FROM rules WHERE user_id = ? AND LOWER(pattern)=LOWER(?) AND category_id=?"
  ).get(userId, pattern, category_id);
  if (existing) return c.json({ error: "Ya existe una regla con ese patrón para esa categoría" }, 409);

  const result = await db.prepare(
    "INSERT INTO rules (pattern,category_id,match_count,user_id) VALUES (?,?,0,?)"
  ).run(pattern, category_id, userId);

  const retroCount = await applyAllRulesRetroactively(db, userId);
  const rule = await db.prepare("SELECT * FROM rules WHERE id=?").get(result.lastInsertRowid);
  return c.json({ ...rule, retro_count: retroCount }, 201);
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  await db.prepare("DELETE FROM rules WHERE id=? AND user_id=?").run(id, userId);
  return c.json({ ok: true });
});

export default router;
