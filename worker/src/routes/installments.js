import { Hono } from "hono";
import { getDb, getSettingsObject } from "../db.js";
import { computeFutureCommitments } from "../services/metrics.js";

const router = new Hono();

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

router.get("/commitments", async (c) => {
  const userId = c.get("userId");
  const start  = c.req.query("start");
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return c.json({ error: "start is required in YYYY-MM format" }, 400);
  const months = parsePositiveInt(c.req.query("months") || 6, 6, 24);
  const settings = await getSettingsObject(c.env, userId);
  return c.json(await computeFutureCommitments(getDb(c.env), start, months, userId, {
    currency: settings.display_currency || "UYU",
    exchangeRateUsd: Number(settings.exchange_rate_usd_uyu || 42.5),
    exchangeRateArs: Number(settings.exchange_rate_ars_uyu || 0.045)
  }));
});

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT i.*,a.name AS account_name,a.currency AS account_currency FROM installments i
     LEFT JOIN accounts a ON a.id=i.account_id AND a.user_id=i.user_id
     WHERE i.user_id = ? AND i.cuota_actual <= i.cantidad_cuotas
     ORDER BY i.created_at DESC`
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const { descripcion, monto_total, cantidad_cuotas, account_id = null, start_month } = await c.req.json();
  if (!descripcion || !monto_total || !cantidad_cuotas || !start_month) {
    return c.json({ error: "descripcion, monto_total, cantidad_cuotas and start_month are required" }, 400);
  }
  if (!/^\d{4}-\d{2}$/.test(start_month)) {
    return c.json({ error: "start_month must be in YYYY-MM format" }, 400);
  }
  const cuotas = parsePositiveInt(cantidad_cuotas, null);
  const total = Number(monto_total);
  if (!cuotas || !Number.isFinite(total)) {
    return c.json({ error: "monto_total and cantidad_cuotas must be valid numbers" }, 400);
  }
  const db = getDb(c.env);
  if (account_id) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }
  const monto_cuota = Math.round(total / cuotas);
  const result = await db.prepare(
    `INSERT INTO installments (descripcion,monto_total,cantidad_cuotas,cuota_actual,monto_cuota,account_id,start_month,user_id)
     VALUES (?,?,?,1,?,?,?,?)`
  ).run(descripcion, total, cuotas, monto_cuota, account_id, start_month, userId);
  return c.json(await db.prepare("SELECT * FROM installments WHERE id=? AND user_id=?").get(result.lastInsertRowid, userId), 201);
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const current = await db.prepare(
    "SELECT * FROM installments WHERE id=? AND user_id=?"
  ).get(id, userId);
  if (!current) return c.json({ error: "installment not found" }, 404);
  const body = await c.req.json();
  const cuotaActual = body.cuota_actual ?? current.cuota_actual;
  if (!parsePositiveInt(cuotaActual, null)) {
    return c.json({ error: "cuota_actual must be a positive integer" }, 400);
  }
  await db.prepare("UPDATE installments SET cuota_actual=? WHERE id=? AND user_id=?").run(cuotaActual, id, userId);
  return c.json(await db.prepare("SELECT * FROM installments WHERE id=? AND user_id=?").get(id, userId));
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  await db.prepare("DELETE FROM installments WHERE id=? AND user_id=?").run(id, userId);
  return new Response(null, { status: 204 });
});

export default router;
