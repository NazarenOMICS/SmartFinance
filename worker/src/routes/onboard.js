import { Hono } from "hono";
import { getDb, upsertSetting } from "../db.js";
import { DEFAULT_PATTERNS } from "../services/tx-extractor.js";
import { ensureCanonicalCategories, ensureSeedRules } from "../services/taxonomy-store.js";

const router = new Hono();

const DEFAULT_SETTINGS = [
  { key: "exchange_rate_usd_uyu", value: "42.5" },
  { key: "exchange_rate_ars_uyu", value: "0.045" },
  { key: "display_currency", value: "UYU" },
  { key: "savings_initial", value: "0" },
  { key: "savings_goal", value: "200000" },
  { key: "savings_currency", value: "UYU" },
  { key: "parsing_patterns", value: JSON.stringify(DEFAULT_PATTERNS) },
  { key: "categorizer_auto_threshold", value: "0.88" },
  { key: "categorizer_suggest_threshold", value: "0.68" },
  { key: "categorizer_ollama_enabled", value: "0" },
  { key: "categorizer_ollama_url", value: "" },
  { key: "categorizer_ollama_model", value: "qwen2.5:3b" },
  { key: "guided_categorization_onboarding_completed", value: "0" },
  { key: "guided_categorization_onboarding_skipped", value: "0" },
  { key: "guided_categorization_onboarding_seen_at", value: "" },
];

const LEGACY_TABLES = [
  "categories",
  "accounts",
  "settings",
  "rules",
  "installments",
  "uploads",
  "transactions",
  "rule_exclusions",
  "categorization_events",
];

router.post("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ?"
  ).get(userId);

  await ensureCanonicalCategories(db, userId);
  await ensureSeedRules(db, userId);

  const statements = DEFAULT_SETTINGS.map((setting) =>
    c.env.DB.prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
    ).bind(userId, setting.key, setting.value)
  );
  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({
    status: existing.count > 0 ? "existing" : "created",
    categories_seeded: true,
    rules_seeded: true,
  });
});

router.post("/claim-legacy", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const ownDataChecks = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) AS count FROM rules WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) AS count FROM installments WHERE user_id = ?").get(userId),
    db.prepare("SELECT COUNT(*) AS count FROM uploads WHERE user_id = ?").get(userId),
  ]);
  if (ownDataChecks.some((row) => row.count > 0)) {
    return c.json({ error: "User already has data. Cannot claim legacy records." }, 409);
  }

  const legacyChecks = await Promise.all(
    LEGACY_TABLES.map((table) =>
      db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ''`).get()
    )
  );
  if (legacyChecks.every((row) => row.count === 0)) {
    return c.json({ error: "No legacy data found" }, 404);
  }

  const statements = [
    c.env.DB.prepare("DELETE FROM categories WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM settings WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM rules WHERE user_id = ?").bind(userId),
  ];
  const updateIndexes = {};
  const counts = {};

  for (const table of LEGACY_TABLES) {
    updateIndexes[table] = statements.length;
    statements.push(
      c.env.DB.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = ''`).bind(userId)
    );
  }

  for (const setting of DEFAULT_SETTINGS) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO NOTHING`
      ).bind(userId, setting.key, setting.value)
    );
  }

  const results = await c.env.DB.batch(statements);
  for (const table of LEGACY_TABLES) {
    counts[table] = results[updateIndexes[table]]?.meta?.changes || 0;
  }

  await ensureCanonicalCategories(db, userId);
  await ensureSeedRules(db, userId);

  return c.json({ status: "claimed", counts });
});

router.post("/guided-categorization/complete", async (c) => {
  const userId = c.get("userId");
  const now = new Date().toISOString();
  await upsertSetting(c.env, "guided_categorization_onboarding_completed", "1", userId);
  await upsertSetting(c.env, "guided_categorization_onboarding_skipped", "0", userId);
  await upsertSetting(c.env, "guided_categorization_onboarding_seen_at", now, userId);
  return c.json({ completed: true, seen_at: now });
});

router.post("/guided-categorization/skip", async (c) => {
  const userId = c.get("userId");
  const now = new Date().toISOString();
  await upsertSetting(c.env, "guided_categorization_onboarding_skipped", "1", userId);
  await upsertSetting(c.env, "guided_categorization_onboarding_seen_at", now, userId);
  return c.json({ skipped: true, seen_at: now });
});

export default router;
