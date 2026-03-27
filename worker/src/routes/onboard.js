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
import { getDb, upsertSetting } from "../db.js";
import { DEFAULT_PATTERNS } from "../services/tx-extractor.js";

const router = new Hono();

const DEFAULT_CATEGORIES = [
  { name: "Ingreso", budget: 0, type: "variable", color: "#639922", sort_order: 0 },
  { name: "Alquiler", budget: 18000, type: "fijo", color: "#639922" },
  { name: "Supermercado", budget: 12000, type: "variable", color: "#534AB7" },
  { name: "Transporte", budget: 6000, type: "variable", color: "#1D9E75" },
  { name: "Suscripciones", budget: 5000, type: "fijo", color: "#D85A30" },
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
];

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

  for (let i = 0; i < DEFAULT_CATEGORIES.length; i += 1) {
    const cat = DEFAULT_CATEGORIES[i];
    if (existingNames.has(cat.name.toLowerCase())) continue;
    await db.prepare(
      "INSERT INTO categories (name,budget,type,color,sort_order,user_id) VALUES (?,?,?,?,?,?)"
    ).run(cat.name, cat.budget, cat.type, cat.color, cat.sort_order ?? i, userId);
  }

  for (const setting of DEFAULT_SETTINGS) {
    await upsertSetting(c.env, setting.key, setting.value, userId);
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

  const legacyCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ''"
  ).get();
  if (legacyCount.count === 0) {
    return c.json({ error: "No legacy data found" }, 404);
  }

  await db.prepare("DELETE FROM categories WHERE user_id = ?").run(userId);
  await db.prepare("DELETE FROM settings WHERE user_id = ?").run(userId);

  const tables = ["transactions", "categories", "accounts", "rules", "installments", "uploads"];
  const counts = {};
  for (const table of tables) {
    const result = await db.prepare(
      `UPDATE ${table} SET user_id = ? WHERE user_id = ''`
    ).run(userId);
    counts[table] = result.changes || 0;
  }

  const settingsResult = await db.prepare(
    "UPDATE settings SET user_id = ? WHERE user_id = ''"
  ).run(userId);
  counts.settings = settingsResult.changes || 0;

  for (const setting of DEFAULT_SETTINGS) {
    await c.env.DB.prepare(
      `INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO NOTHING`
    ).bind(userId, setting.key, setting.value).run();
  }

  return c.json({ status: "claimed", counts });
});

export default router;
