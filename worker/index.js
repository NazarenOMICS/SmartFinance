import { Hono } from "hono";
import { cors } from "hono/cors";
import { assertSchemaVersion } from "./src/db.js";
import { clerkAuth } from "./src/middleware/auth.js";
import accountsRouter from "./src/routes/accounts.js";
import bankFormatsRouter from "./src/routes/bank-formats.js";
import categoriesRouter from "./src/routes/categories.js";
import exportRouter from "./src/routes/export.js";
import insightsRouter from "./src/routes/insights.js";
import installmentsRouter from "./src/routes/installments.js";
import onboardRouter from "./src/routes/onboard.js";
import rulesRouter from "./src/routes/rules.js";
import savingsRouter from "./src/routes/savings.js";
import settingsRouter from "./src/routes/settings.js";
import systemRouter from "./src/routes/system.js";
import transactionsRouter from "./src/routes/transactions.js";
import uploadRouter from "./src/routes/upload.js";

const app = new Hono();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/api/health", (c) => c.json({ ok: true }));

app.use("/api/*", clerkAuth);
app.route("/api/system", systemRouter);
app.use("/api/*", async (c, next) => {
  if (c.req.path.startsWith("/api/system/")) {
    return next();
  }
  await assertSchemaVersion(c.env);
  return next();
});

app.route("/api/onboard", onboardRouter);
app.route("/api/transactions", transactionsRouter);
app.route("/api/categories", categoriesRouter);
app.route("/api/accounts", accountsRouter);
app.route("/api/rules", rulesRouter);
app.route("/api/installments", installmentsRouter);
app.route("/api/savings", savingsRouter);
app.route("/api/settings", settingsRouter);
app.route("/api/upload", uploadRouter);
app.route("/api/export", exportRouter);
app.route("/api/insights", insightsRouter);
app.route("/api/bank-formats", bankFormatsRouter);

app.onError((err, c) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  if (status === 503 && err?.schema) {
    return c.json(err.schema, 503);
  }
  if (status >= 500) {
    console.error(err);
  }
  return c.json({ error: err.message || "Unexpected server error" }, status);
});

export default app;
