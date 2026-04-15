import { DEFAULT_PATTERNS } from "./services/tx-extractor.js";

// Wraps Cloudflare D1 to match the better-sqlite3 interface used in routes.
// All methods are async (D1 is always async).
export const DEFAULT_SETTINGS = {
  exchange_rate_usd_uyu: "42.5",
  exchange_rate_eur_uyu: "46.5",
  exchange_rate_ars_uyu: "0.045",
  exchange_rate_mode: "auto",
  display_currency: "UYU",
  savings_initial: "0",
  savings_goal: "200000",
  savings_monthly: "0",
  savings_currency: "UYU",
  parsing_patterns: JSON.stringify(DEFAULT_PATTERNS),
  categorizer_auto_threshold: "0.88",
  categorizer_suggest_threshold: "0.68",
  categorizer_v2_enabled: "1",
  categorizer_ollama_enabled: "0",
  categorizer_ollama_url: "",
  categorizer_ollama_model: "qwen2.5:3b",
  guided_categorization_onboarding_completed: "0",
  guided_categorization_onboarding_skipped: "0",
  guided_categorization_onboarding_seen_at: "",
  hidden_seed_category_slugs: "[]",
};
export const SUPPORTED_CURRENCY_LIST = ["UYU", "USD", "EUR", "ARS"];
export const EXCHANGE_RATE_CURRENCIES = ["USD", "EUR", "ARS"];
export const DEFAULT_EXCHANGE_RATE_VALUES = {
  USD: DEFAULT_SETTINGS.exchange_rate_usd_uyu,
  EUR: DEFAULT_SETTINGS.exchange_rate_eur_uyu,
  ARS: DEFAULT_SETTINGS.exchange_rate_ars_uyu,
};
export const DEFAULT_GLOBAL_EXCHANGE_RATES = {
  exchange_rate_usd_uyu: DEFAULT_SETTINGS.exchange_rate_usd_uyu,
  exchange_rate_eur_uyu: DEFAULT_SETTINGS.exchange_rate_eur_uyu,
  exchange_rate_ars_uyu: DEFAULT_SETTINGS.exchange_rate_ars_uyu,
  exchange_rate_source: "open.er-api.com",
  exchange_rate_updated_at: "",
  exchange_rate_fetch_error: "",
};
const SUPPORTED_CURRENCIES = new Set(SUPPORTED_CURRENCY_LIST);
export const SCHEMA_VERSION = "2026-04-categorization-canonical-v9";
export const EXPECTED_SCHEMA_VERSION = SCHEMA_VERSION;

export function getExchangeRateSettingKey(currency) {
  return `exchange_rate_${String(currency || "").toLowerCase()}_uyu`;
}

function isExchangeRateSettingKey(key) {
  return EXCHANGE_RATE_CURRENCIES.some((currency) => getExchangeRateSettingKey(currency) === key);
}

function getDefaultExchangeRateValueByKey(key) {
  const currency = EXCHANGE_RATE_CURRENCIES.find((item) => getExchangeRateSettingKey(item) === key);
  return currency ? DEFAULT_EXCHANGE_RATE_VALUES[currency] : null;
}

function createSchemaMismatchError(currentVersion) {
  const error = new Error("Schema mismatch. Apply D1 migrations before using the app.");
  error.status = 503;
  error.code = "SCHEMA_MISMATCH";
  error.schema = {
    ok: false,
    expected_version: EXPECTED_SCHEMA_VERSION,
    current_version: currentVersion,
    blocking_reason: currentVersion
      ? "database_schema_outdated"
      : "schema_version_missing",
  };
  return error;
}

export function getDb(env) {
  return {
    prepare(sql) {
      return {
        async all(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          const result = await stmt.all();
          return result.results;
        },
        async get(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          return stmt.first();
        },
        async run(...params) {
          const stmt = params.length ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
          const result = await stmt.run();
          return {
            lastInsertRowid: result.meta.last_row_id,
            changes: result.meta.changes
          };
        }
      };
    },
    async exec(sql) {
      return env.DB.exec(sql);
    }
  };
}

export async function getSchemaStatus(env) {
  try {
    const meta = await env.DB.prepare(
      "SELECT value FROM system_meta WHERE key = 'schema_version' LIMIT 1"
    ).first();
    const currentVersion = meta?.value || null;
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
  } catch {
    return {
      ok: false,
      expected_version: EXPECTED_SCHEMA_VERSION,
      current_version: null,
      blocking_reason: "schema_meta_unavailable",
    };
  }
}

export async function assertSchemaVersion(env) {
  const status = await getSchemaStatus(env);
  if (!status.ok) {
    throw createSchemaMismatchError(status.current_version);
  }
  return status;
}

export function monthWindow(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

export function isValidMonthString(value) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}$/.test(raw)) return false;
  const [, month] = raw.split("-").map(Number);
  return month >= 1 && month <= 12;
}

export function normalizeSettingValue(key, value) {
  const raw = value == null ? "" : String(value).trim();

  if (key === "exchange_rate_mode") {
    return raw === "manual" ? "manual" : "auto";
  }

  if (key === "display_currency" || key === "savings_currency") {
    return SUPPORTED_CURRENCIES.has(raw) ? raw : DEFAULT_SETTINGS[key];
  }

  if (isExchangeRateSettingKey(key)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : getDefaultExchangeRateValueByKey(key);
  }

  if (key === "savings_initial" || key === "savings_goal" || key === "savings_monthly") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? String(parsed) : DEFAULT_SETTINGS[key];
  }

  if (key === "categorizer_auto_threshold" || key === "categorizer_suggest_threshold") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? String(parsed) : DEFAULT_SETTINGS[key];
  }

  if (key === "categorizer_ollama_enabled" || key === "categorizer_v2_enabled") {
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

function normalizeGlobalExchangeRateValue(key, value) {
  const raw = value == null ? "" : String(value).trim();
  if (key === "exchange_rate_source" || key === "exchange_rate_updated_at" || key === "exchange_rate_fetch_error") {
    return raw;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : (DEFAULT_GLOBAL_EXCHANGE_RATES[key] ?? "");
}

export async function getGlobalExchangeRates(env) {
  const rateKeys = EXCHANGE_RATE_CURRENCIES.map((currency) => `'${getExchangeRateSettingKey(currency)}'`).join(", ");
  const rows = await env.DB.prepare(
    `SELECT key, value
     FROM system_meta
     WHERE key IN (${rateKeys}, 'exchange_rate_source', 'exchange_rate_updated_at', 'exchange_rate_fetch_error')`
  ).all();

  const meta = rows.results.reduce((acc, row) => {
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

export function getExchangeRateMap(settings = {}) {
  return EXCHANGE_RATE_CURRENCIES.reduce((acc, currency) => {
    const key = getExchangeRateSettingKey(currency);
    const fallback = Number(DEFAULT_EXCHANGE_RATE_VALUES[currency]);
    const parsed = Number(settings[key] || fallback);
    acc[currency] = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
    return acc;
  }, { UYU: 1 });
}

export function convertAmount(amount, currency, targetCurrency, exchangeRates = {}) {
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
    exchange_rate_source: exchangeRateMode === "manual"
      ? "manual_override"
      : String(globalExchangeRates.exchange_rate_source || DEFAULT_GLOBAL_EXCHANGE_RATES.exchange_rate_source),
    exchange_rate_updated_at: exchangeRateMode === "manual"
      ? ""
      : String(globalExchangeRates.exchange_rate_updated_at || ""),
    exchange_rate_fetch_error: String(globalExchangeRates.exchange_rate_fetch_error || ""),
  };
}

export async function getSettingsObject(env, userId = "") {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE user_id = ?"
  ).bind(userId).all();
  const baseSettings = rows.results.reduce((acc, row) => {
    acc[row.key] = normalizeSettingValue(row.key, row.value);
    return acc;
  }, { ...DEFAULT_SETTINGS });
  const globalExchangeRates = await getGlobalExchangeRates(env);
  return resolveEffectiveSettings(baseSettings, globalExchangeRates);
}

export async function upsertSetting(env, key, value, userId = "") {
  const normalizedValue = normalizeSettingValue(key, value);
  return env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  ).bind(userId, key, normalizedValue).run();
}

export async function upsertSystemMeta(env, key, value) {
  const normalizedValue = key.startsWith("exchange_rate_")
    ? normalizeGlobalExchangeRateValue(key, value)
    : String(value ?? "");
  return env.DB.prepare(
    `INSERT INTO system_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, normalizedValue).run();
}
