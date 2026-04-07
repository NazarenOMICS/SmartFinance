const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const { getSchemaStatus } = require("./db");
const { startDailyRefresh } = require("./services/exchange-rates");
const transactionsRouter = require("./routes/transactions");
const categoriesRouter = require("./routes/categories");
const accountsRouter = require("./routes/accounts");
const rulesRouter = require("./routes/rules");
const installmentsRouter = require("./routes/installments");
const savingsRouter = require("./routes/savings");
const settingsRouter = require("./routes/settings");
const uploadRouter = require("./routes/upload");
const exportRouter = require("./routes/export");
const dashboardRouter = require("./routes/dashboard");
const accountLinksRouter = require("./routes/account-links");
const assistantRouter = require("./routes/assistant");
const onboardRouter = require("./routes/onboard");
const insightsRouter = require("./routes/insights");
const bankFormatsRouter = require("./routes/bank-formats");

const app = express();
const PORT = process.env.PORT || 3001;
const uploadsDir = path.join(__dirname, "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

startDailyRefresh();
onboardRouter.ensureCanonicalCategories?.();
onboardRouter.ensureSeedRules?.();

app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true
}));
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/system/schema", (req, res) => {
  const status = getSchemaStatus();
  res.status(status.ok ? 200 : 503).json(status);
});

app.use("/api/onboard", onboardRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/account-links", accountLinksRouter);
app.use("/api/rules", rulesRouter);
app.use("/api/installments", installmentsRouter);
app.use("/api/savings", savingsRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/export", exportRouter);
app.use("/api/insights", insightsRouter);
app.use("/api/bank-formats", bankFormatsRouter);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error(error);
  const status = Number(
    error.statusCode ||
    error.status ||
    (error.type === "entity.parse.failed" ? 400 : 500)
  );
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  res.status(safeStatus).json({ error: error.message || "Unexpected server error" });
});

app.listen(PORT, () => {
  console.log(`Finance Tracker API listening on http://localhost:${PORT}`);
});
