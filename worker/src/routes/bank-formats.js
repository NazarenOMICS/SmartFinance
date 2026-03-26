/**
 * Bank format memory.
 * Saves and retrieves custom column mappings so the user only has to map
 * columns once for each unknown bank format.
 *
 * Routes:
 *   GET  /api/bank-formats              → list all saved formats for the user
 *   GET  /api/bank-formats/:key         → get one format by its key
 *   POST /api/bank-formats              → save / update a format mapping
 *   DELETE /api/bank-formats/:key       → forget a saved format
 */

import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

// Ensure the table exists (idempotent — safe to call on every request).
async function ensureTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS bank_formats (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      format_key TEXT    NOT NULL,
      bank_name  TEXT,
      col_fecha  INTEGER NOT NULL DEFAULT 0,
      col_desc   INTEGER NOT NULL DEFAULT 1,
      col_debit  INTEGER NOT NULL DEFAULT -1,
      col_credit INTEGER NOT NULL DEFAULT -1,
      col_monto  INTEGER NOT NULL DEFAULT -1,
      created_at TEXT    DEFAULT (datetime('now')),
      UNIQUE(user_id, format_key)
    )
  `);
}

// GET /api/bank-formats
router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  await ensureTable(db);
  const rows = await db.prepare(
    "SELECT * FROM bank_formats WHERE user_id = ? ORDER BY bank_name"
  ).all(userId);
  return c.json(rows);
});

// GET /api/bank-formats/:key
router.get("/:key", async (c) => {
  const userId = c.get("userId");
  const key    = c.req.param("key");
  const db     = getDb(c.env);
  await ensureTable(db);
  const row = await db.prepare(
    "SELECT * FROM bank_formats WHERE user_id = ? AND format_key = ?"
  ).get(userId, key);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// POST /api/bank-formats  — upsert
router.post("/", async (c) => {
  const userId = c.get("userId");
  const { format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto } =
    await c.req.json();

  if (!format_key) return c.json({ error: "format_key required" }, 400);
  if (col_fecha == null) return c.json({ error: "col_fecha required" }, 400);

  const db = getDb(c.env);
  await ensureTable(db);

  await db.prepare(`
    INSERT INTO bank_formats (user_id, format_key, bank_name, col_fecha, col_desc, col_debit, col_credit, col_monto)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, format_key)
    DO UPDATE SET bank_name  = excluded.bank_name,
                  col_fecha  = excluded.col_fecha,
                  col_desc   = excluded.col_desc,
                  col_debit  = excluded.col_debit,
                  col_credit = excluded.col_credit,
                  col_monto  = excluded.col_monto
  `).run(
    userId,
    format_key,
    bank_name || null,
    col_fecha  ?? 0,
    col_desc   ?? 1,
    col_debit  ?? -1,
    col_credit ?? -1,
    col_monto  ?? -1,
  );

  return c.json({ ok: true, format_key });
});

// DELETE /api/bank-formats/:key
router.delete("/:key", async (c) => {
  const userId = c.get("userId");
  const key    = c.req.param("key");
  const db     = getDb(c.env);
  await db.prepare(
    "DELETE FROM bank_formats WHERE user_id = ? AND format_key = ?"
  ).run(userId, key);
  return c.json({ ok: true });
});

export default router;
