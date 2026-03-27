import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    "SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const { name, budget = 0, type = "variable", color = null } = await c.req.json();
  if (!name) return c.json({ error: "name is required" }, 400);
  const db = getDb(c.env);
  const existing = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE"
  ).get(userId, name.trim());
  if (existing) return c.json({ error: `Ya existe una categoría con el nombre "${name}"` }, 409);
  const result = await db.prepare(
    "INSERT INTO categories (name,budget,type,color,user_id) VALUES (?,?,?,?,?)"
  ).run(name.trim(), budget, type, color, userId);
  return c.json(await db.prepare("SELECT * FROM categories WHERE id=? AND user_id=?").get(result.lastInsertRowid, userId), 201);
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const current = await db.prepare(
    "SELECT * FROM categories WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!current) return c.json({ error: "category not found" }, 404);
  const body = await c.req.json();
  const next = {
    name:   body.name?.trim() ?? current.name,
    budget: body.budget ?? current.budget,
    type:   body.type   ?? current.type,
    color:  body.color  ?? current.color
  };
  const duplicate = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?"
  ).get(userId, next.name, id);
  if (duplicate) return c.json({ error: `Ya existe una categorÃ­a con el nombre "${next.name}"` }, 409);
  await db.prepare(
    "UPDATE categories SET name=?,budget=?,type=?,color=? WHERE id=? AND user_id=?"
  ).run(next.name, next.budget, next.type, next.color, id, userId);
  return c.json(await db.prepare("SELECT * FROM categories WHERE id=? AND user_id=?").get(id, userId));
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const existing = await db.prepare(
    "SELECT id FROM categories WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!existing) return c.json({ error: "category not found" }, 404);
  const txCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM transactions WHERE category_id = ? AND user_id = ?"
  ).get(id, userId);
  if (txCount.count > 0) return c.json({ error: "category has linked transactions" }, 409);
  await db.prepare("DELETE FROM rules WHERE category_id = ? AND user_id = ?").run(id, userId);
  await db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(id, userId);
  return new Response(null, { status: 204 });
});

export default router;
