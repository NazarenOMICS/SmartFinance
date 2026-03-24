import { Hono } from "hono";
import { cors } from "hono/cors";
import transactionsRouter from "./src/routes/transactions.js";
import categoriesRouter  from "./src/routes/categories.js";
import accountsRouter    from "./src/routes/accounts.js";
import rulesRouter       from "./src/routes/rules.js";
import installmentsRouter from "./src/routes/installments.js";
import savingsRouter     from "./src/routes/savings.js";
import settingsRouter    from "./src/routes/settings.js";
import uploadRouter      from "./src/routes/upload.js";
import exportRouter      from "./src/routes/export.js";

const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"] }));

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/transactions", transactionsRouter);
app.route("/api/categories",   categoriesRouter);
app.route("/api/accounts",     accountsRouter);
app.route("/api/rules",        rulesRouter);
app.route("/api/installments", installmentsRouter);
app.route("/api/savings",      savingsRouter);
app.route("/api/settings",     settingsRouter);
app.route("/api/upload",       uploadRouter);
app.route("/api/export",       exportRouter);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Unexpected server error" }, 500);
});

export default app;
