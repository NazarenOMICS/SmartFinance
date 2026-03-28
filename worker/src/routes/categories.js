import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();
const SUPPORTED_CATEGORY_TYPES = new Set(["variable", "fijo", "transferencia"]);

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
  const normalizedName = String(name || "").trim();
  const normalizedBudget = Number(budget);
  if (!normalizedName) return c.json({ error: "name is required" }, 400);
  if (!Number.isFinite(normalizedBudget)) return c.json({ error: "budget must be a finite number" }, 400);
  if (!SUPPORTED_CATEGORY_TYPES.has(type)) {
    return c.json({ error: "type must be fijo, variable or transferencia" }, 400);
  }
  const db = getDb(c.env);
  const existing = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE"
  ).get(userId, normalizedName);
  if (existing) return c.json({ error: `Ya existe una categoría con el nombre "${normalizedName}"` }, 409);
  const result = await db.prepare(
    "INSERT INTO categories (name,budget,type,color,user_id) VALUES (?,?,?,?,?)"
  ).run(normalizedName, normalizedBudget, type, color, userId);
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
    name: body.name !== undefined ? String(body.name).trim() : current.name,
    budget: body.budget !== undefined ? Number(body.budget) : current.budget,
    type: body.type ?? current.type,
    color: body.color ?? current.color
  };
  if (!next.name) return c.json({ error: "name is required" }, 400);
  if (!Number.isFinite(next.budget)) return c.json({ error: "budget must be a finite number" }, 400);
  if (!SUPPORTED_CATEGORY_TYPES.has(next.type)) {
    return c.json({ error: "type must be fijo, variable or transferencia" }, 400);
  }
  const duplicate = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?"
  ).get(userId, next.name, id);
  if (duplicate) return c.json({ error: `Ya existe una categoría con el nombre "${next.name}"` }, 409);
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
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM rules WHERE category_id = ? AND user_id = ?").bind(id, userId),
    c.env.DB.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return new Response(null, { status: 204 });
});

export default router;
