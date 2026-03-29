const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "finance-tracker.db");
const DEFAULT_PATTERNS = [
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s+[\d.,]+\s*$`,
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
  String.raw`^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-]?[\d.,]+)\s*$`
];
const DEFAULT_SETTINGS = {
  exchange_rate_usd_uyu: "42.5",
  exchange_rate_ars_uyu: "0.045",
  display_currency: "UYU",
  savings_initial: "0",
  savings_goal: "200000",
  savings_currency: "UYU",
  parsing_patterns: JSON.stringify(DEFAULT_PATTERNS),
  categorizer_auto_threshold: "0.88",
  categorizer_suggest_threshold: "0.68",
  categorizer_ollama_enabled: "0",
  categorizer_ollama_url: "",
  categorizer_ollama_model: "qwen2.5:3b"
};
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      budget REAL DEFAULT 0,
      type TEXT DEFAULT 'variable',
      color TEXT,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      account_id TEXT,
      tx_count INTEGER DEFAULT 0,
      period TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      descripcion TEXT NOT NULL,
      monto_total REAL NOT NULL,
      cantidad_cuotas INTEGER NOT NULL,
      cuota_actual INTEGER NOT NULL,
      monto_cuota REAL NOT NULL,
      account_id TEXT,
      start_month TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      desc_banco TEXT NOT NULL,
      desc_usuario TEXT,
      monto REAL NOT NULL,
      moneda TEXT NOT NULL DEFAULT 'UYU',
      category_id INTEGER,
      account_id TEXT,
      es_cuota INTEGER DEFAULT 0,
      installment_id INTEGER,
      upload_id INTEGER,
      dedup_hash TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (installment_id) REFERENCES installments(id),
      FOREIGN KEY (upload_id) REFERENCES uploads(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tx_fecha ON transactions(fecha);
    CREATE INDEX IF NOT EXISTS idx_tx_dedup ON transactions(dedup_hash);

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      match_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS bank_formats (
      key TEXT PRIMARY KEY,
      config TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const ruleColumns = new Set(db.prepare("PRAGMA table_info(rules)").all().map((column) => column.name));
  if (!ruleColumns.has("mode")) db.exec("ALTER TABLE rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'suggest'");
  if (!ruleColumns.has("confidence")) db.exec("ALTER TABLE rules ADD COLUMN confidence REAL NOT NULL DEFAULT 0.72");
  if (!ruleColumns.has("source")) db.exec("ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  if (!ruleColumns.has("account_id")) db.exec("ALTER TABLE rules ADD COLUMN account_id TEXT");
  if (!ruleColumns.has("currency")) db.exec("ALTER TABLE rules ADD COLUMN currency TEXT");
  if (!ruleColumns.has("direction")) db.exec("ALTER TABLE rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any'");
  if (!ruleColumns.has("merchant_key")) db.exec("ALTER TABLE rules ADD COLUMN merchant_key TEXT");
  if (!ruleColumns.has("last_matched_at")) db.exec("ALTER TABLE rules ADD COLUMN last_matched_at TEXT");

  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);

  Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => insertSetting.run(key, value));
}

function normalizeSettingValue(key, value) {
  const raw = value == null ? "" : String(value).trim();

  if (key === "display_currency" || key === "savings_currency") {
    return SUPPORTED_CURRENCIES.has(raw) ? raw : DEFAULT_SETTINGS[key];
  }

  if (key === "exchange_rate_usd_uyu" || key === "exchange_rate_ars_uyu") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : DEFAULT_SETTINGS[key];
  }

  if (key === "savings_initial" || key === "savings_goal") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? String(parsed) : DEFAULT_SETTINGS[key];
  }

  if (key === "categorizer_auto_threshold" || key === "categorizer_suggest_threshold") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? String(parsed) : DEFAULT_SETTINGS[key];
  }

  if (key === "categorizer_ollama_enabled") {
    return raw === "1" || raw.toLowerCase() === "true" ? "1" : "0";
  }

  if (key === "categorizer_ollama_url" || key === "categorizer_ollama_model") {
    return raw;
  }

  if (key === "parsing_patterns") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string" && item.trim())) {
        return JSON.stringify(parsed);
      }
    } catch (_) {
      // fall through to default
    }
    return DEFAULT_SETTINGS.parsing_patterns;
  }

  return String(value);
}

function getSettingsObject() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return rows.reduce((acc, row) => {
    acc[row.key] = normalizeSettingValue(row.key, row.value);
    return acc;
  }, { ...DEFAULT_SETTINGS });
}

function upsertSetting(key, value) {
  const normalizedValue = normalizeSettingValue(key, value);
  return db
    .prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(key, normalizedValue);
}

function monthWindow(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

function isValidMonthString(value) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return false;
  const [, month] = raw.split("-").map(Number);
  return month >= 1 && month <= 12;
}

migrate();

module.exports = {
  db,
  DB_PATH,
  DEFAULT_PATTERNS,
  DEFAULT_SETTINGS,
  getSettingsObject,
  isValidMonthString,
  monthWindow,
  normalizeSettingValue,
  upsertSetting
};

