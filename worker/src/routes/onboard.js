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

const router = new Hono();

const DEFAULT_CATEGORIES = [
  { name: "Alquiler",      budget: 18000, type: "fijo",     color: "#639922" },
  { name: "Supermercado",  budget: 12000, type: "variable", color: "#534AB7" },
  { name: "Transporte",    budget:  6000, type: "variable", color: "#1D9E75" },
  { name: "Suscripciones", budget:  5000, type: "fijo",     color: "#D85A30" },
  { name: "Restaurantes",  budget:  8000, type: "variable", color: "#378ADD" },
  { name: "Servicios",     budget:  7000, type: "fijo",     color: "#BA7517" },
  { name: "Salud",         budget:  4000, type: "variable", color: "#E24B4A" },
  { name: "Otros",         budget:  5000, type: "variable", color: "#888780" },
  { name: "Ingreso",       budget:      0, type: "variable", color: "#639922" },
];

const DEFAULT_SETTINGS = [
  { key: "exchange_rate_usd_uyu", value: "42.5"    },
  { key: "display_currency",      value: "UYU"     },
  { key: "savings_initial",       value: "0"       },
  { key: "savings_goal",          value: "200000"  },
  { key: "savings_currency",      value: "UYU"     },
];

router.post("/", async (c) => {
  const userId = c.get("userId");
  const db     = getDb(c.env);

  // Check if user already has categories (idempotent)
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ?"
  ).get(userId);

  if (existing.count > 0) {
    return c.json({ status: "existing", message: "User already has data" });
  }

  // Create default categories
  for (let i = 0; i < DEFAULT_CATEGORIES.length; i++) {
    const cat = DEFAULT_CATEGORIES[i];
    await db.prepare(
      "INSERT INTO categories (name,budget,type,color,sort_order,user_id) VALUES (?,?,?,?,?,?)"
    ).run(cat.name, cat.budget, cat.type, cat.color, i, userId);
  }

  // Create default settings
  for (const s of DEFAULT_SETTINGS) {
    await upsertSetting(c.env, s.key, s.value, userId);
  }

  return c.json({ status: "created", categories: DEFAULT_CATEGORIES.length });
});

/**
 * Moves all legacy (user_id='') data to the authenticated user.
 * Returns counts of migrated records per table.
 */
router.post("/claim-legacy", async (c) => {
  const userId = c.get("userId");
  const db     = getDb(c.env);

  // Safety: only allow if user has no existing data yet
  const existing = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ?"
  ).get(userId);
  if (existing.count > 0) {
    return c.json({ error: "User already has data. Cannot claim legacy records." }, 409);
  }

  // Check legacy data exists
  const legacyCount = await db.prepare(
    "SELECT COUNT(*) AS count FROM categories WHERE user_id = ''"
  ).get();
  if (legacyCount.count === 0) {
    return c.json({ error: "No legacy data found" }, 404);
  }

  // Migrate all tables
  const tables = ["transactions", "categories", "accounts", "rules", "installments", "uploads"];
  const counts = {};
  for (const table of tables) {
    const result = await db.prepare(
      `UPDATE ${table} SET user_id = ? WHERE user_id = ''`
    ).run(userId);
    counts[table] = result.changes || 0;
  }

  // Migrate settings (composite PK)
  const settingsResult = await db.prepare(
    "UPDATE settings SET user_id = ? WHERE user_id = ''"
  ).run(userId);
  counts.settings = settingsResult.changes || 0;

  return c.json({ status: "claimed", counts });
});

export default router;
