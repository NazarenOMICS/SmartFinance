import { Hono } from "hono";
import { getSettingsObject, upsertSetting } from "../db.js";

const router = new Hono();

router.get("/", async (c) => c.json(await getSettingsObject(c.env)));

router.put("/", async (c) => {
  const { key, value } = await c.req.json();
  if (!key) return c.json({ error: "key is required" }, 400);
  await upsertSetting(c.env, key, value);
  return c.json({ key, value: String(value) });
});

export default router;
