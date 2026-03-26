import { Hono } from "hono";
import { cors } from "hono/cors";
import { clerkAuth } from "./src/middleware/auth.js";
import transactionsRouter  from "./src/routes/transactions.js";
import categoriesRouter    from "./src/routes/categories.js";
import accountsRouter      from "./src/routes/accounts.js";
import rulesRouter         from "./src/routes/rules.js";
import installmentsRouter  from "./src/routes/installments.js";
import savingsRouter       from "./src/routes/savings.js";
import settingsRouter      from "./src/routes/settings.js";
import uploadRouter        from "./src/routes/upload.js";
import exportRouter        from "./src/routes/export.js";
import insightsRouter      from "./src/routes/insights.js";
import onboardRouter       from "./src/routes/onboard.js";
import bankFormatsRouter   from "./src/routes/bank-formats.js";

const app = new Hono();

// ── CORS ─────────────────────────────────────────────────────────────────────
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

// ── Public health check (no auth) ────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true }));

// ── Auth middleware for all /api/* routes ─────────────────────────────────────
app.use("/api/*", clerkAuth);

// ── Protected routes ─────────────────────────────────────────────────────────
app.route("/api/onboard",      onboardRouter);
app.route("/api/transactions", transactionsRouter);
app.route("/api/categories",   categoriesRouter);
app.route("/api/accounts",     accountsRouter);
app.route("/api/rules",        rulesRouter);
app.route("/api/installments", installmentsRouter);
app.route("/api/savings",      savingsRouter);
app.route("/api/settings",     settingsRouter);
app.route("/api/upload",       uploadRouter);
app.route("/api/export",       exportRouter);
app.route("/api/insights",     insightsRouter);
app.route("/api/bank-formats", bankFormatsRouter);

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Unexpected server error" }, 500);
});

export default app;
