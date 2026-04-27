const path = require("path");
const fs = require("fs");

const DEFAULT_PORT = 3001;
const DEFAULT_JSON_LIMIT = "1mb";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const rawValue = trimmed.slice(index + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(path.join(__dirname, ".env"));

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
