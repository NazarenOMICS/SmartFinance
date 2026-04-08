const path = require("path");

const DEFAULT_PORT = 3001;
const DEFAULT_JSON_LIMIT = "1mb";

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeOrigins(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || "development",
  host: process.env.HOST || "0.0.0.0",
  port: parseInteger(process.env.PORT, DEFAULT_PORT),
  jsonLimit: process.env.JSON_LIMIT || DEFAULT_JSON_LIMIT,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  corsOrigins: normalizeOrigins(process.env.CORS_ORIGIN),
  uploadsDir: process.env.UPLOADS_DIR
    ? path.resolve(process.cwd(), process.env.UPLOADS_DIR)
    : path.resolve(__dirname, "..", "uploads"),
});

function buildCorsOptions() {
  if (config.corsOrigins.length === 0) {
    return { origin: true };
  }

  return {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("CORS origin not allowed"));
    },
  };
}

module.exports = {
  config,
  buildCorsOptions,
};
