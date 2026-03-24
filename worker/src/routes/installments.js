import { Hono } from "hono";
import { getDb } from "../db.js";
import { computeFutureCommitments } from "../services/metrics.js";

const router = new Hono();

router.get("/commitments", async (c) => {
  const start = c.req.query("start");
  if (!start || !/^\d{4}-\d{2}$/.test(start)) return c.json({ error: "start is required in YYYY-MM format" }, 400);
  const months = Math.max(1, Number(c.req.query("months") || 6));
  return c.json(await computeFutureCommitments(getDb(c.env), start, months));
});

router.get("/", async (c) => {
  const db = getDb(c.env);
  return c.json(await db.prepare(
    `SELECT i.*,a.name AS account_name FROM installments i
     LEFT JOIN accounts a ON a.id=i.account_id
     WHERE i.cuota_actual<=i.cantidad_cuotas ORDER BY i.created_at DESC`
  ).all());
});

router.post("/", async (c) => {
  const { descripcion, monto_total, cantidad_cuotas, account_id = null, start_month } = await c.req.json();
  if (!descripcion || !monto_total || !cantidad_cuotas || !start_month) {
    return c.json({ error: "descripcion, monto_total, cantidad_cuotas and start_month are required" }, 400);
  }
  const monto_cuota = Math.round(Number(monto_total) / Number(cantidad_cuotas));
  const db = getDb(c.env);
  const result = await db.prepare(
    `INSERT INTO installments (descripcion,monto_total,cantidad_cuotas,cuota_actual,monto_cuota,account_id,start_month)
     VALUES (?,?,?,1,?,?,?)`
  ).run(descripcion, monto_total, cantidad_cuotas, monto_cuota, account_id, start_month);
  return c.json(await db.prepare("SELECT * FROM installments WHERE id=?").get(result.lastInsertRowid), 201);
});

router.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const current = await db.prepare("SELECT * FROM installments WHERE id=?").get(id);
  if (!current) return c.json({ error: "installment not found" }, 404);
  const body = await c.req.json();
  const cuotaActual = body.cuota_actual ?? current.cuota_actual;
  await db.prepare("UPDATE installments SET cuota_actual=? WHERE id=?").run(cuotaActual, id);
  return c.json(await db.prepare("SELECT * FROM installments WHERE id=?").get(id));
});

router.delete("/:id", async (c) => {
  await getDb(c.env).prepare("DELETE FROM installments WHERE id=?").run(Number(c.req.param("id")));
  return new Response(null, { status: 204 });
});

export default router;
