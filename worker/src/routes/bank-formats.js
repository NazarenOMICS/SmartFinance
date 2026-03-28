/**
 * Bank format memory.
 * Saves and retrieves custom column mappings so the user only has to map
 * columns once for each unknown bank format.
 */

import { Hono } from "hono";
import { getDb } from "../db.js";

const router = new Hono();

function parseColumnIndex(value) {
  if (value == null || value === "") return -1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= -1 ? parsed : null;
}

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

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  await ensureTable(db);
  const rows = await db.prepare(
    "SELECT * FROM bank_formats WHERE user_id = ? ORDER BY bank_name"
  ).all(userId);
  return c.json(rows);
});

router.get("/:key", async (c) => {
  const userId = c.get("userId");
  const key = c.req.param("key");
  const db = getDb(c.env);
  await ensureTable(db);
  const row = await db.prepare(
    "SELECT * FROM bank_formats WHERE user_id = ? AND format_key = ?"
  ).get(userId, key);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const formatKey = String(body.format_key || "").trim();
  const bankName = body.bank_name == null ? null : String(body.bank_name).trim() || null;
  const colFecha = parseColumnIndex(body.col_fecha);
  const colDesc = parseColumnIndex(body.col_desc);
  const colDebit = parseColumnIndex(body.col_debit);
  const colCredit = parseColumnIndex(body.col_credit);
  const colMonto = parseColumnIndex(body.col_monto);

  if (!formatKey) return c.json({ error: "format_key required" }, 400);
  if ([colFecha, colDesc, colDebit, colCredit, colMonto].some((value) => value === null)) {
    return c.json({ error: "column indexes must be integers greater than or equal to -1" }, 400);
  }
  if (colFecha < 0 || colDesc < 0 || (colMonto < 0 && colDebit < 0 && colCredit < 0)) {
    return c.json({ error: "format must include fecha, descripcion and at least one amount column" }, 400);
  }
  const assignedColumns = [colFecha, colDesc, colDebit, colCredit, colMonto].filter((value) => value >= 0);
  if (new Set(assignedColumns).size !== assignedColumns.length) {
    return c.json({ error: "each role must use a different column" }, 400);
  }

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
    formatKey,
    bankName,
    colFecha,
    colDesc,
    colDebit,
    colCredit,
    colMonto,
  );

  return c.json({ ok: true, format_key: formatKey });
});

router.delete("/:key", async (c) => {
  const userId = c.get("userId");
  const key = c.req.param("key");
  const db = getDb(c.env);
  const result = await db.prepare(
    "DELETE FROM bank_formats WHERE user_id = ? AND format_key = ?"
  ).run(userId, key);
  if ((result.changes || 0) === 0) return c.json({ error: "Not found" }, 404);
  return new Response(null, { status: 204 });
});

export default router;
