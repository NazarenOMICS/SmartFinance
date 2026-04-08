import { Hono } from "hono";
import { cors } from "hono/cors";
import { assertSchemaVersion } from "@smartfinance/database";
import { log } from "@smartfinance/observability";
import type { ApiBindings, ApiVariables } from "./env";
import { authMiddleware } from "./middleware/auth";
import { requestContextMiddleware } from "./middleware/request-context";
import accountsRouter from "./routes/accounts";
import billingRouter from "./routes/billing";
import categoriesRouter from "./routes/categories";
import onboardRouter from "./routes/onboard";
import rulesRouter from "./routes/rules";
import settingsRouter from "./routes/settings";
import systemRouter from "./routes/system";
import transactionsRouter from "./routes/transactions";
import uploadsRouter from "./routes/uploads";
import usageRouter from "./routes/usage";

const app = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));
app.use("*", requestContextMiddleware);

app.use("/api/system/limits", authMiddleware);
app.use("/api/system/limits/*", authMiddleware);
app.use("/api/usage", authMiddleware);
app.use("/api/usage/*", authMiddleware);
app.use("/api/onboard", authMiddleware);
app.use("/api/onboard/*", authMiddleware);
app.use("/api/billing", authMiddleware);
app.use("/api/billing/*", authMiddleware);
app.use("/api/accounts", authMiddleware);
app.use("/api/accounts/*", authMiddleware);
app.use("/api/categories", authMiddleware);
app.use("/api/categories/*", authMiddleware);
app.use("/api/settings", authMiddleware);
app.use("/api/settings/*", authMiddleware);
app.use("/api/rules", authMiddleware);
app.use("/api/rules/*", authMiddleware);
app.use("/api/transactions", authMiddleware);
app.use("/api/transactions/*", authMiddleware);
app.use("/api/uploads", authMiddleware);
app.use("/api/uploads/*", authMiddleware);
app.use("/api/usage", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/usage/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/system/limits", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/system/limits/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/onboard", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/onboard/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/billing", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/billing/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/accounts", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/accounts/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/categories", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/categories/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/settings", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/settings/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/rules", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/rules/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/transactions", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/transactions/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/uploads", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});
app.use("/api/uploads/*", async (c, next) => {
  await assertSchemaVersion(c.env.DB);
  await next();
});

app.route("/api", systemRouter);
app.route("/api/usage", usageRouter);
app.route("/api/onboard", onboardRouter);
app.route("/api/billing", billingRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/categories", categoriesRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/rules", rulesRouter);
app.route("/api/transactions", transactionsRouter);
app.route("/api/uploads", uploadsRouter);

app.onError((error, c) => {
  const typedError = error as unknown as {
    status?: number;
    schema?: Record<string, unknown>;
    message?: string;
  };
  const status = typeof typedError.status === "number" ? typedError.status : 500;
  const requestId = c.get("requestId");

  if (status >= 500) {
    log("error", "request.failed", {
      request_id: requestId,
      path: c.req.path,
      message: typedError.message || "Unexpected server error",
    });
  }

  if (status === 503 && typedError.schema) {
    return new Response(
      JSON.stringify({
        ...typedError.schema,
        request_id: requestId,
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  }

  return new Response(
    JSON.stringify({
      error: typedError.message || "Unexpected server error",
      code: status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
      request_id: requestId,
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
      },
    },
  );
});

export default app;
