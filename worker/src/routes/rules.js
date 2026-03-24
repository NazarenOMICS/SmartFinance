import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

router.get("/", async (c) => {
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT r.*,c.name AS category_name,c.color AS category_color
     FROM rules r JOIN categories c ON c.id=r.category_id
     ORDER BY r.match_count DESC,r.id ASC`
  ).all());
});

router.post("/", async (c) => {
  const { pattern, category_id } = await c.req.json();
  if (!pattern || !category_id) return c.json({ error: "pattern and category_id are required" }, 400);
  const db = getDb(c.env);
  const result = await db.prepare("INSERT INTO rules (pattern,category_id,match_count) VALUES (?,?,0)").run(pattern, category_id);
  return c.json(await db.prepare("SELECT * FROM rules WHERE id=?").get(result.lastInsertRowid), 201);
});

router.delete("/:id", async (c) => {
  const db = getDb(c.env);
  await db.prepare("DELETE FROM rules WHERE id=?").run(Number(c.req.param("id")));
  return new Response(null, { status: 204 });
});

export default router;
