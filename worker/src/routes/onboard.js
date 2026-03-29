/**
 * POST /api/onboard
 * Called by the frontend after a user signs in for the first time.
 * Creates default categories + settings for the user if they have none.
 *
 * POST /api/onboard/claim-legacy
 * For the original single-tenant owner: moves all records with user_id=''
 * to the current authenticated user. Safe to call only once.
 */
import { Hono } from "hono";
import { getDb } from "../db.js";
import { DEFAULT_PATTERNS } from "../services/tx-extractor.js";

const router = new Hono();

const DEFAULT_CATEGORIES = [
  { name: "Ingreso", budget: 0, type: "variable", color: "#639922", sort_order: 0 },
  { name: "Alquiler", budget: 18000, type: "fijo", color: "#639922" },
  { name: "Supermercado", budget: 12000, type: "variable", color: "#534AB7" },
  { name: "Transporte", budget: 6000, type: "variable", color: "#1D9E75" },
  { name: "Suscripciones", budget: 5000, type: "fijo", color: "#D85A30" },
  { name: "Comer afuera", budget: 8000, type: "variable", color: "#378ADD" },
  { name: "Delivery", budget: 6000, type: "variable", color: "#D85A30" },
  { name: "Streaming", budget: 2500, type: "fijo", color: "#9B59B6" },
  { name: "Telefonia", budget: 3000, type: "fijo", color: "#2ECC71" },
  { name: "Gimnasio", budget: 3000, type: "fijo", color: "#E67E22" },
  { name: "Mascotas", budget: 2000, type: "variable", color: "#3498DB" },
  { name: "Restaurantes", budget: 8000, type: "variable", color: "#378ADD" },
  { name: "Servicios", budget: 7000, type: "fijo", color: "#BA7517" },
  { name: "Salud", budget: 4000, type: "variable", color: "#E24B4A" },
  { name: "Otros", budget: 5000, type: "variable", color: "#888780" },
  { name: "Reintegro", budget: 0, type: "variable", color: "#1D9E75", sort_order: 90 },
  { name: "Transferencia", budget: 0, type: "transferencia", color: "#888780", sort_order: 91 },
];

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
];

// Update parents before children so the composite (id, user_id) foreign keys
// remain valid while legacy rows are reassigned to the authenticated user.
const LEGACY_TABLES = ["categories", "accounts", "settings", "rules", "installments", "uploads", "transactions"];

router.post("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);

  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ?"
  ).get(userId);

  const existingCategories = await db.prepare(
    "SELECT name FROM categories WHERE user_id = ?"
  ).all(userId);
  const existingNames = new Set(existingCategories.map((row) => row.name.toLowerCase()));
  const statements = [];

  for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
    const cat = DEFAULT_CATEGORIES[i];
    if (existingNames.has(cat.name.toLowerCase())) continue;
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO categories (name,budget,type,color,sort_order,user_id) VALUES (?,?,?,?,?,?)"
      ).bind(cat.name, cat.budget, cat.type, cat.color, cat.sort_order ?? i, userId)
    );
  }

  for (const setting of DEFAULT_SETTINGS) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
      ).bind(userId, setting.key, setting.value)
    );
  }

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({
    status: existing.count > 0 ? "existing" : "created",
    categories: DEFAULT_CATEGORIES.length
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

  return c.json({ status: "claimed", counts });
});

export default router;
