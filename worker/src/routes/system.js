import { Hono } from "hono";
import { getSchemaStatus } from "../db.js";

const router = new Hono();

router.get("/schema", async (c) => {
  const status = await getSchemaStatus(c.env);
  return c.json(status, status.ok ? 200 : 503);
});

export default router;
