import { DEFAULT_PATTERNS } from "./services/tx-extractor.js";

// Wraps Cloudflare D1 to match the better-sqlite3 interface used in routes.
// All methods are async (D1 is always async).
export const DEFAULT_SETTINGS = {
  exchange_rate_usd_uyu: "42.5",
  exchange_rate_ars_uyu: "0.045",
  display_currency: "UYU",
  savings_initial: "0",
  savings_goal: "200000",
  savings_currency: "UYU",
  parsing_patterns: JSON.stringify(DEFAULT_PATTERNS)
};
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);

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

export async function getSettingsObject(env, userId = "") {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE user_id = ?"
  ).bind(userId).all();
  return rows.results.reduce((acc, row) => {
    acc[row.key] = normalizeSettingValue(row.key, row.value);
    return acc;
  }, { ...DEFAULT_SETTINGS });
}

export async function upsertSetting(env, key, value, userId = "") {
  const normalizedValue = normalizeSettingValue(key, value);
  return env.DB.prepare(
    `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  ).bind(userId, key, normalizedValue).run();
}
