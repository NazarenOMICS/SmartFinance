import { Hono } from "hono";
import { getDb } from "../db.js";
import { createOrUpdateManualCategory } from "../services/taxonomy-store.js";
import { getCanonicalCategoryBySlug, slugifyCategoryName } from "../services/taxonomy.js";

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
  const normalizedBudget = type === "fijo" ? 0 : Number(budget);
  if (!normalizedName) return c.json({ error: "name is required" }, 400);
  if (!Number.isFinite(normalizedBudget)) return c.json({ error: "budget must be a finite number" }, 400);
  if (!SUPPORTED_CATEGORY_TYPES.has(type)) {
    return c.json({ error: "type must be fijo, variable or transferencia" }, 400);
  }

  const slug = slugifyCategoryName(normalizedName);
  if (getCanonicalCategoryBySlug(slug)) {
    const db = getDb(c.env);
    const existingCanonical = await db.prepare(
      "SELECT id FROM categories WHERE user_id = ? AND slug = ? LIMIT 1"
    ).get(userId, slug);
    if (existingCanonical) {
      return c.json({ error: `Ya existe una categoria canonica con el nombre "${normalizedName}"` }, 409);
    }
  }

  const db = getDb(c.env);
  const created = await createOrUpdateManualCategory(db, userId, {
    name: normalizedName,
    budget: normalizedBudget,
    type,
    color,
  });
  return c.json(await db.prepare("SELECT * FROM categories WHERE id=? AND user_id=?").get(created.id, userId), 201);
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const current = await db.prepare(
    "SELECT * FROM categories WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!current) return c.json({ error: "category not found" }, 404);

  const body = await c.req.json();
  const next = {
    name: body.name !== undefined ? String(body.name).trim() : current.name,
    budget: (body.type ?? current.type) === "fijo"
      ? 0
      : (body.budget !== undefined ? Number(body.budget) : current.budget),
    type: body.type ?? current.type,
    color: body.color ?? current.color
  };
  if (!next.name) return c.json({ error: "name is required" }, 400);
  if (!Number.isFinite(next.budget)) return c.json({ error: "budget must be a finite number" }, 400);
  if (!SUPPORTED_CATEGORY_TYPES.has(next.type)) {
    return c.json({ error: "type must be fijo, variable or transferencia" }, 400);
  }

  const nextSlug = slugifyCategoryName(next.name);
  const duplicate = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND slug = ? AND id != ?"
  ).get(userId, nextSlug, id);
  if (duplicate) return c.json({ error: `Ya existe una categoria con el nombre "${next.name}"` }, 409);

  const origin = current.origin === "seed" ? "seed" : "manual";
  await db.prepare(
    "UPDATE categories SET name=?,slug=?,budget=?,type=?,color=?,origin=? WHERE id=? AND user_id=?"
  ).run(next.name, nextSlug, next.budget, next.type, next.color, origin, id, userId);

  return c.json(await db.prepare("SELECT * FROM categories WHERE id=? AND user_id=?").get(id, userId));
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const existing = await db.prepare(
    "SELECT * FROM categories WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!existing) return c.json({ error: "category not found" }, 404);
  if (existing.origin === "seed") {
    return c.json({ error: "No se puede borrar una categoria canonica" }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE transactions
       SET category_id = NULL,
           categorization_status = 'uncategorized',
           category_source = NULL,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE category_id = ? AND user_id = ?`
    ).bind(id, userId),
    c.env.DB.prepare("DELETE FROM rule_exclusions WHERE user_id = ? AND rule_id IN (SELECT id FROM rules WHERE category_id = ? AND user_id = ?)").bind(userId, id, userId),
    c.env.DB.prepare("DELETE FROM rules WHERE category_id = ? AND user_id = ?").bind(id, userId),
    c.env.DB.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").bind(id, userId),
  ]);
  return new Response(null, { status: 204 });
});

export default router;
