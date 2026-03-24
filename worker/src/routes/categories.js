import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

router.get("/", async (c) => {
  const db = getDb(c.env);
  return c.json(await db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all());
});

router.post("/", async (c) => {
  const { name, budget = 0, type = "variable", color = null } = await c.req.json();
  if (!name) return c.json({ error: "name is required" }, 400);
  const db = getDb(c.env);
  const result = await db.prepare("INSERT INTO categories (name,budget,type,color) VALUES (?,?,?,?)").run(name, budget, type, color);
  return c.json(await db.prepare("SELECT * FROM categories WHERE id=?").get(result.lastInsertRowid), 201);
});

router.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const current = await db.prepare("SELECT * FROM categories WHERE id=?").get(id);
  if (!current) return c.json({ error: "category not found" }, 404);
  const body = await c.req.json();
  const next = {
    name:   body.name   ?? current.name,
    budget: body.budget ?? current.budget,
    type:   body.type   ?? current.type,
    color:  body.color  ?? current.color
  };
  await db.prepare("UPDATE categories SET name=?,budget=?,type=?,color=? WHERE id=?").run(next.name, next.budget, next.type, next.color, id);
  return c.json(await db.prepare("SELECT * FROM categories WHERE id=?").get(id));
});

router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE category_id=?").get(id);
  if (count.count > 0) return c.json({ error: "category has linked transactions" }, 409);
  await db.prepare("DELETE FROM categories WHERE id=?").run(id);
  return new Response(null, { status: 204 });
});

export default router;
