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
  exchange_rate_eur_uyu: "46.5",
  exchange_rate_ars_uyu: "0.045",
  exchange_rate_mode: "auto",
  display_currency: "UYU",
  savings_initial: "0",
  savings_goal: "200000",
  savings_currency: "UYU",
  parsing_patterns: JSON.stringify(DEFAULT_PATTERNS),
  categorizer_auto_threshold: "0.88",
  categorizer_suggest_threshold: "0.68",
  categorizer_ollama_enabled: "0",
  categorizer_ollama_url: "",
  categorizer_ollama_model: "qwen2.5:3b",
  guided_categorization_onboarding_completed: "0",
  guided_categorization_onboarding_skipped: "0",
  guided_categorization_onboarding_seen_at: "",
  hidden_seed_category_slugs: "[]"
};
const SUPPORTED_CURRENCY_LIST = ["UYU", "USD", "EUR", "ARS"];
const EXCHANGE_RATE_CURRENCIES = ["USD", "EUR", "ARS"];
const DEFAULT_EXCHANGE_RATE_VALUES = {
  USD: DEFAULT_SETTINGS.exchange_rate_usd_uyu,
  EUR: DEFAULT_SETTINGS.exchange_rate_eur_uyu,
  ARS: DEFAULT_SETTINGS.exchange_rate_ars_uyu,
};
const DEFAULT_GLOBAL_EXCHANGE_RATES = {
  exchange_rate_usd_uyu: DEFAULT_SETTINGS.exchange_rate_usd_uyu,
  exchange_rate_eur_uyu: DEFAULT_SETTINGS.exchange_rate_eur_uyu,
  exchange_rate_ars_uyu: DEFAULT_SETTINGS.exchange_rate_ars_uyu,
  exchange_rate_source: "open.er-api.com",
  exchange_rate_updated_at: "",
  exchange_rate_fetch_error: "",
};
const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_LIST);
const SCHEMA_VERSION = "2026-03-contract-v3";
const EXPECTED_SCHEMA_VERSION = SCHEMA_VERSION;

function getExchangeRateSettingKey(currency) {
  return `exchange_rate_${String(currency || "").toLowerCase()}_uyu`;
}

function isExchangeRateSettingKey(key) {
  return EXCHANGE_RATE_CURRENCIES.some((currency) => getExchangeRateSettingKey(currency) === key);
}

function getDefaultExchangeRateValueByKey(key) {
  const currency = EXCHANGE_RATE_CURRENCIES.find((item) => getExchangeRateSettingKey(item) === key);
  return currency ? DEFAULT_EXCHANGE_RATE_VALUES[currency] : null;
}

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
      sort_order INTEGER DEFAULT 0,
      slug TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'manual'
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
      categorization_status TEXT NOT NULL DEFAULT 'uncategorized',
      category_source TEXT,
      category_confidence REAL,
      category_rule_id INTEGER,
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
      normalized_pattern TEXT NOT NULL DEFAULT '',
      category_id INTEGER NOT NULL,
      match_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      mode TEXT NOT NULL DEFAULT 'suggest',
      confidence REAL NOT NULL DEFAULT 0.72,
      source TEXT NOT NULL DEFAULT 'manual',
      account_id TEXT,
      currency TEXT,
      direction TEXT NOT NULL DEFAULT 'any',
      merchant_key TEXT,
      last_matched_at TEXT,
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

    CREATE TABLE IF NOT EXISTS rule_exclusions (
      rule_id INTEGER NOT NULL,
      transaction_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (rule_id, transaction_id)
    );

    CREATE TABLE IF NOT EXISTS categorization_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL,
      rule_id INTEGER,
      category_id INTEGER,
      decision TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'unknown',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS global_pattern_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_pattern TEXT NOT NULL,
      category_slug TEXT NOT NULL,
      sample_count INTEGER NOT NULL DEFAULT 0,
      user_count INTEGER NOT NULL DEFAULT 0,
      confirm_count INTEGER NOT NULL DEFAULT 0,
      reject_count INTEGER NOT NULL DEFAULT 0,
      confidence_score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS global_pattern_candidate_users (
      candidate_id INTEGER NOT NULL,
      user_fingerprint TEXT NOT NULL,
      last_decision TEXT NOT NULL DEFAULT 'confirm',
      created_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (candidate_id, user_fingerprint)
    );

    CREATE TABLE IF NOT EXISTS global_pattern_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_pattern TEXT NOT NULL UNIQUE,
      category_slug TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto_approved',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const categoryColumns = new Set(db.prepare("PRAGMA table_info(categories)").all().map((column) => column.name));
  if (!categoryColumns.has("slug")) db.exec("ALTER TABLE categories ADD COLUMN slug TEXT NOT NULL DEFAULT ''");
  if (!categoryColumns.has("origin")) db.exec("ALTER TABLE categories ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual'");

  const ruleColumns = new Set(db.prepare("PRAGMA table_info(rules)").all().map((column) => column.name));
  if (!ruleColumns.has("normalized_pattern")) db.exec("ALTER TABLE rules ADD COLUMN normalized_pattern TEXT NOT NULL DEFAULT ''");
  if (!ruleColumns.has("mode")) db.exec("ALTER TABLE rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'suggest'");
  if (!ruleColumns.has("confidence")) db.exec("ALTER TABLE rules ADD COLUMN confidence REAL NOT NULL DEFAULT 0.72");
  if (!ruleColumns.has("source")) db.exec("ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  if (!ruleColumns.has("account_id")) db.exec("ALTER TABLE rules ADD COLUMN account_id TEXT");
  if (!ruleColumns.has("currency")) db.exec("ALTER TABLE rules ADD COLUMN currency TEXT");
  if (!ruleColumns.has("direction")) db.exec("ALTER TABLE rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any'");
  if (!ruleColumns.has("merchant_key")) db.exec("ALTER TABLE rules ADD COLUMN merchant_key TEXT");
  if (!ruleColumns.has("last_matched_at")) db.exec("ALTER TABLE rules ADD COLUMN last_matched_at TEXT");

  const txColumns = new Set(db.prepare("PRAGMA table_info(transactions)").all().map((column) => column.name));
  if (!txColumns.has("categorization_status")) db.exec("ALTER TABLE transactions ADD COLUMN categorization_status TEXT NOT NULL DEFAULT 'uncategorized'");
  if (!txColumns.has("category_source")) db.exec("ALTER TABLE transactions ADD COLUMN category_source TEXT");
  if (!txColumns.has("category_confidence")) db.exec("ALTER TABLE transactions ADD COLUMN category_confidence REAL");
  if (!txColumns.has("category_rule_id")) db.exec("ALTER TABLE transactions ADD COLUMN category_rule_id INTEGER");

  db.exec(`
    UPDATE transactions
    SET category_id = NULL
    WHERE category_id IS NOT NULL
      AND category_id NOT IN (SELECT id FROM categories)
  `);
  db.exec(`
    UPDATE transactions
    SET categorization_status = CASE
      WHEN category_id IS NULL THEN 'uncategorized'
      ELSE 'categorized'
    END
  `);
  db.exec(`
    UPDATE transactions
    SET category_source = CASE
      WHEN category_id IS NULL THEN NULL
      ELSE COALESCE(NULLIF(category_source, ''), 'legacy')
    END
  `);
  db.exec("UPDATE transactions SET category_confidence = NULL WHERE category_id IS NULL");
  db.exec("UPDATE transactions SET category_rule_id = NULL WHERE category_id IS NULL");

  db.exec("UPDATE rules SET normalized_pattern = LOWER(TRIM(pattern)) WHERE COALESCE(normalized_pattern, '') = ''");
  db.exec(`
    DELETE FROM rules
    WHERE id NOT IN (
      SELECT MIN(id)
      FROM rules
      GROUP BY normalized_pattern, IFNULL(account_id, ''), IFNULL(currency, ''), direction
    )
  `);

  db.exec("DROP INDEX IF EXISTS idx_rules_user_pattern");
  db.exec("CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_scope ON rules(normalized_pattern, IFNULL(account_id, ''), IFNULL(currency, ''), direction)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rule_exclusions_tx ON rule_exclusions(transaction_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_categorization_events_tx ON categorization_events(transaction_id, created_at DESC)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(categorization_status, fecha DESC)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_global_pattern_candidate_scope ON global_pattern_candidates(normalized_pattern, category_slug)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_global_pattern_candidates_status ON global_pattern_candidates(status, confidence_score DESC, user_count DESC)");

  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => insertSetting.run(key, value));

  db.prepare(`
    INSERT INTO system_meta (key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(EXPECTED_SCHEMA_VERSION);
}

function normalizeSettingValue(key, value) {
  const raw = value == null ? "" : String(value).trim();

  if (key === "display_currency" || key === "savings_currency") {
    return SUPPORTED_CURRENCIES.has(raw) ? raw : DEFAULT_SETTINGS[key];
  }

  if (key === "exchange_rate_mode") {
    return raw === "manual" ? "manual" : "auto";
  }

  if (isExchangeRateSettingKey(key)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : getDefaultExchangeRateValueByKey(key);
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
      return DEFAULT_SETTINGS.parsing_patterns;
    }
    return DEFAULT_SETTINGS.parsing_patterns;
  }

  return String(value);
}

function normalizeGlobalExchangeRateValue(key, value) {
  const raw = value == null ? "" : String(value).trim();
  if (key === "exchange_rate_source" || key === "exchange_rate_updated_at" || key === "exchange_rate_fetch_error") {
    return raw;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : (DEFAULT_GLOBAL_EXCHANGE_RATES[key] ?? "");
}

function getGlobalExchangeRates() {
  const rateKeys = EXCHANGE_RATE_CURRENCIES.map((currency) => `'${getExchangeRateSettingKey(currency)}'`).join(", ");
  const rows = db.prepare(
    `SELECT key, value
     FROM system_meta
     WHERE key IN (${rateKeys}, 'exchange_rate_source', 'exchange_rate_updated_at', 'exchange_rate_fetch_error')`
  ).all();

  const meta = rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, { ...DEFAULT_GLOBAL_EXCHANGE_RATES });

  return {
    ...EXCHANGE_RATE_CURRENCIES.reduce((acc, currency) => {
      const key = getExchangeRateSettingKey(currency);
      acc[key] = normalizeGlobalExchangeRateValue(key, meta[key]);
      return acc;
    }, {}),
    exchange_rate_source: String(meta.exchange_rate_source || DEFAULT_GLOBAL_EXCHANGE_RATES.exchange_rate_source),
    exchange_rate_updated_at: String(meta.exchange_rate_updated_at || ""),
    exchange_rate_fetch_error: String(meta.exchange_rate_fetch_error || ""),
  };
}

function getExchangeRateMap(settings = {}) {
  return EXCHANGE_RATE_CURRENCIES.reduce((acc, currency) => {
    const key = getExchangeRateSettingKey(currency);
    const fallback = Number(DEFAULT_EXCHANGE_RATE_VALUES[currency]);
    const parsed = Number(settings[key] || fallback);
    acc[currency] = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    return acc;
  }, { UYU: 1 });
}

function convertAmount(amount, currency, targetCurrency, exchangeRates = {}) {
  const value = Number(amount || 0);
  const sourceCurrency = String(currency || targetCurrency || "UYU").toUpperCase();
  const desiredCurrency = String(targetCurrency || sourceCurrency || "UYU").toUpperCase();
  const rates = {
    UYU: 1,
    ...exchangeRates,
  };

  if (!desiredCurrency || sourceCurrency === desiredCurrency) return value;

  let inUyu = value;
  if (sourceCurrency !== "UYU") {
    const sourceRate = Number(rates[sourceCurrency]);
    if (!Number.isFinite(sourceRate) || sourceRate <= 0) return value;
    inUyu = value * sourceRate;
  }

  if (desiredCurrency === "UYU") return inUyu;

  const targetRate = Number(rates[desiredCurrency]);
  if (!Number.isFinite(targetRate) || targetRate <= 0) return inUyu;
  return inUyu / targetRate;
}

function resolveEffectiveSettings(settings, globalExchangeRates) {
  const exchangeRateMode = normalizeSettingValue("exchange_rate_mode", settings.exchange_rate_mode);
  const resolvedRates = EXCHANGE_RATE_CURRENCIES.reduce((acc, currency) => {
    const key = getExchangeRateSettingKey(currency);
    const manualRate = normalizeSettingValue(key, settings[key]);
    const autoRate = normalizeGlobalExchangeRateValue(key, globalExchangeRates[key]);
    const effectiveRate = exchangeRateMode === "manual" ? manualRate : autoRate;
    acc[`manual_${key}`] = manualRate;
    acc[`auto_${key}`] = autoRate;
    acc[`effective_${key}`] = effectiveRate;
    acc[key] = effectiveRate;
    return acc;
  }, {});

  return {
    ...settings,
    exchange_rate_mode: exchangeRateMode,
    ...resolvedRates,
    exchange_rate_source: exchangeRateMode === "manual" ? "manual_override" : globalExchangeRates.exchange_rate_source,
    exchange_rate_updated_at: exchangeRateMode === "manual" ? "" : globalExchangeRates.exchange_rate_updated_at,
    exchange_rate_fetch_error: globalExchangeRates.exchange_rate_fetch_error,
  };
}

function getSettingsObject() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const baseSettings = rows.reduce((acc, row) => {
    acc[row.key] = normalizeSettingValue(row.key, row.value);
    return acc;
  }, { ...DEFAULT_SETTINGS });
  return resolveEffectiveSettings(baseSettings, getGlobalExchangeRates());
}

function upsertSetting(key, value) {
  const normalizedValue = normalizeSettingValue(key, value);
  return db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, normalizedValue);
}

function upsertSystemMeta(key, value) {
  const normalizedValue = key.startsWith("exchange_rate_")
    ? normalizeGlobalExchangeRateValue(key, value)
    : String(value ?? "");
  return db.prepare(
    `INSERT INTO system_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, normalizedValue);
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

function getSchemaStatus() {
  const row = db.prepare("SELECT value FROM system_meta WHERE key = 'schema_version'").get();
  const currentVersion = row?.value || null;
  return {
    ok: currentVersion === EXPECTED_SCHEMA_VERSION,
    expected_version: EXPECTED_SCHEMA_VERSION,
    current_version: currentVersion,
    blocking_reason: currentVersion === EXPECTED_SCHEMA_VERSION
      ? null
      : currentVersion
        ? "database_schema_outdated"
        : "schema_version_missing",
  };
}

migrate();

module.exports = {
  db,
  DB_PATH,
  DEFAULT_PATTERNS,
  DEFAULT_SETTINGS,
  EXPECTED_SCHEMA_VERSION,
  SUPPORTED_CURRENCY_LIST,
  getExchangeRateMap,
  convertAmount,
  getSchemaStatus,
  getSettingsObject,
  isValidMonthString,
  monthWindow,
  normalizeSettingValue,
  upsertSystemMeta,
  upsertSetting,
};
