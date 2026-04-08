import { Hono } from "hono";
import { healthResponseSchema, schemaStatusSchema, usageResponseSchema } from "@smartfinance/contracts";
import { getSchemaStatus, getUsageSnapshot } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { getRuntimeEnv } from "../env";

const systemRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

systemRouter.get("/health", async (c) => {
  const payload = healthResponseSchema.parse({
    ok: true,
    service: "api",
    env: getRuntimeEnv(c.env).AUTH_MODE,
    request_id: c.get("requestId"),
  });

  return c.json(payload);
});

systemRouter.get("/system/schema", async (c) => {
  const status = await getSchemaStatus(c.env.DB);
  const payload = schemaStatusSchema.parse({
    ...status,
    request_id: c.get("requestId"),
  });

  return c.json(payload, status.ok ? 200 : 503);
});

systemRouter.get("/system/limits", async (c) => {
  const auth = c.get("auth");
  const usage = await getUsageSnapshot(c.env.DB, auth.userId);
  const payload = usageResponseSchema.parse({
    ...usage,
    request_id: c.get("requestId"),
  });

  return c.json(payload);
});

export default systemRouter;
