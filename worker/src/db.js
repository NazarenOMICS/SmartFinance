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
  parsing_patterns: JSON.stringify(DEFAULT_PATTERNS),
  categorizer_auto_threshold: "0.88",
  categorizer_suggest_threshold: "0.68",
  categorizer_ollama_enabled: "0",
  categorizer_ollama_url: "",
  categorizer_ollama_model: "qwen2.5:3b"
};
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);
let categorizerSchemaReady = false;
let categorizerSchemaPromise = null;

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

export async function ensureCategorizerSchema(env) {
  if (categorizerSchemaReady) return;
  if (categorizerSchemaPromise) return categorizerSchemaPromise;

  categorizerSchemaPromise = (async () => {
    const rulesInfo = await env.DB.prepare("PRAGMA table_info(rules)").all();
    const ruleColumns = new Set((rulesInfo.results || []).map((column) => column.name));
    const statements = [];

    if (!ruleColumns.has("mode")) statements.push("ALTER TABLE rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'suggest'");
    if (!ruleColumns.has("confidence")) statements.push("ALTER TABLE rules ADD COLUMN confidence REAL NOT NULL DEFAULT 0.72");
    if (!ruleColumns.has("source")) statements.push("ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
    if (!ruleColumns.has("account_id")) statements.push("ALTER TABLE rules ADD COLUMN account_id TEXT");
    if (!ruleColumns.has("currency")) statements.push("ALTER TABLE rules ADD COLUMN currency TEXT");
    if (!ruleColumns.has("direction")) statements.push("ALTER TABLE rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any'");
    if (!ruleColumns.has("merchant_key")) statements.push("ALTER TABLE rules ADD COLUMN merchant_key TEXT");
    if (!ruleColumns.has("last_matched_at")) statements.push("ALTER TABLE rules ADD COLUMN last_matched_at TEXT");

    if (statements.length > 0) {
      for (const statement of statements) {
        await env.DB.exec(statement);
      }
    }

    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS rule_exclusions (
        user_id TEXT NOT NULL DEFAULT '',
        rule_id INTEGER NOT NULL,
        transaction_id INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, rule_id, transaction_id)
      );
    `);

    await env.DB.exec(`
      CREATE INDEX IF NOT EXISTS idx_rule_exclusions_user_tx
      ON rule_exclusions(user_id, transaction_id);
    `);

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await env.DB.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO NOTHING`
      ).bind("", key, value).run();
    }

    categorizerSchemaReady = true;
  })().finally(() => {
    categorizerSchemaPromise = null;
  });

  return categorizerSchemaPromise;
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
