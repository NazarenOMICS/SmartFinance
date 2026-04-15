import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

router.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = String(c.req.param("id") || "");
  const db = getDb(c.env);
  const job = await db.prepare(
    "SELECT * FROM categorization_jobs WHERE user_id = ? AND id = ? LIMIT 1"
  ).get(userId, id);
  if (!job) return c.json({ error: "job not found" }, 404);
  return c.json({ ...job, result: JSON.parse(job.result_json || "{}") });
});

export default router;
