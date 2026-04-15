import { Hono } from "hono";
import { healthResponseSchema, schemaStatusSchema, usageResponseSchema } from "@smartfinance/contracts";
import { getSchemaStatus, getUsageSnapshot } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { getRuntimeEnv } from "../env";
import { reportError } from "../services/error-reporting";
import { getLocalTestUserId, resetLocalTestDataset } from "../services/local-test-data";

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

systemRouter.post("/system/test/reset", async (c) => {
  const runtime = getRuntimeEnv(c.env);
  if (runtime.APP_ENV !== "local") {
    return c.json({ error: "Not found" }, 404);
  }

  const result = await resetLocalTestDataset(c.env.DB, getLocalTestUserId());
  return c.json({
    ...result,
    request_id: c.get("requestId"),
  });
});

systemRouter.post("/system/client-error", async (c) => {
  const requestId = c.get("requestId");
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const path = typeof body?.path === "string" ? body.path.slice(0, 300) : "";
  const stack = typeof body?.stack === "string" ? body.stack.slice(0, 4000) : null;
  const kind = typeof body?.kind === "string" && /^(browser_error|unhandled_rejection|react_error|api_error)$/.test(body.kind)
    ? body.kind
    : "browser_error";

  if (!message || message.length > 500) {
    return c.json({ error: "Invalid client error payload", code: "VALIDATION_ERROR", request_id: requestId }, 400);
  }

  c.executionCtx.waitUntil(
    reportError(c.env, {
      request_id: requestId,
      path,
      method: "CLIENT",
      user_id: c.get("auth")?.userId || null,
      message,
      source: "web",
      extra: {
        stack,
        kind,
      },
    }),
  );

  return c.json({ ok: true, request_id: requestId });
});

export default systemRouter;
