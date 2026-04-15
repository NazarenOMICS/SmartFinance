const express = require("express");
const cors = require("cors");
const fs = require("fs");

const { getSchemaStatus } = require("./db");
const { buildCorsOptions, config } = require("./config");
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
const jobsRouter = require("./routes/jobs");

let bootstrapped = false;

function ensureRuntimePrerequisites({ startSchedulers = true } = {}) {
  if (!fs.existsSync(config.uploadsDir)) {
    fs.mkdirSync(config.uploadsDir, { recursive: true });
  }

  if (bootstrapped) return;

  if (startSchedulers) {
    startDailyRefresh();
  }

  onboardRouter.ensureCanonicalCategories?.();
  onboardRouter.ensureSeedRules?.();
  bootstrapped = true;
}

function createApp(options = {}) {
  ensureRuntimePrerequisites(options);

  const app = express();
  app.disable("x-powered-by");

  if (config.trustProxy) {
    app.set("trust proxy", 1);
  }

  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: config.jsonLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.jsonLimit }));
  app.use("/uploads", express.static(config.uploadsDir));

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      env: config.nodeEnv,
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
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
  app.use("/api/uploads", uploadRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api/bank-formats", bankFormatsRouter);
  app.use("/api/jobs", jobsRouter);

  app.use((req, res) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    console.error("[server:error]", {
      method: req.method,
      path: req.originalUrl,
      message: error.message,
      stack: error.stack,
    });

    const status = Number(
      error.statusCode ||
      error.status ||
      (error.type === "entity.parse.failed" ? 400 : 500)
    );
    const safeStatus = status >= 400 && status < 600 ? status : 500;
    res.status(safeStatus).json({ error: error.message || "Unexpected server error" });
  });

  return app;
}

module.exports = {
  createApp,
};
