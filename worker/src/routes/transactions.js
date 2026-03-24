import { Hono } from "hono";
import { getDb } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { ensureRuleForManualCategorization, findMatchingRule, bumpRule } from "../services/categorizer.js";
import { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } from "../services/metrics.js";

const router = new Hono();

function getMonth(c) {
  const month = c.req.query("month");
  return month && /^\d{4}-\d{2}$/.test(month) ? month : null;
}

router.get("/pending", async (c) => {
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  const rows = await getTransactionsForMonth(db, month, "AND t.category_id IS NULL");
  return c.json(rows);
});

router.get("/summary", async (c) => {
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  return c.json(await computeSummary(db, c.env, month));
});

router.get("/monthly-evolution", async (c) => {
  const end = c.req.query("end");
  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const months = Math.max(1, Number(c.req.query("months") || 6));
  const db = getDb(c.env);
  return c.json(await computeMonthlyEvolution(db, end, months));
});

router.get("/", async (c) => {
  const month = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  const filters = [];
  const params = [];
  if (c.req.query("account_id")) { filters.push("AND t.account_id = ?"); params.push(c.req.query("account_id")); }
  if (c.req.query("category_id")) { filters.push("AND t.category_id = ?"); params.push(Number(c.req.query("category_id"))); }
  return c.json(await getTransactionsForMonth(db, month, filters.join(" "), params));
});

router.post("/", async (c) => {
  const body = await c.req.json();
  const { fecha, desc_banco, desc_usuario = null, monto, moneda = "UYU",
          category_id = null, account_id = null, es_cuota = 0, installment_id = null } = body;

  if (!fecha || !desc_banco || typeof monto !== "number") {
    return c.json({ error: "fecha, desc_banco and monto are required" }, 400);
  }

  const db = getDb(c.env);
  let resolvedCategoryId = category_id;
  if (!resolvedCategoryId) {
    const rule = await findMatchingRule(db, desc_banco);
    if (rule) { resolvedCategoryId = rule.category_id; await bumpRule(db, rule.id); }
  }

  const dedupHash = await buildDedupHash({ fecha, monto, desc_banco });
  const duplicate = await db.prepare(
    "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha,1,7) = substr(?,1,7) LIMIT 1"
  ).get(dedupHash, fecha);

  if (duplicate) return c.json({ error: "transaction already exists for this month" }, 409);

  const result = await db.prepare(
    `INSERT INTO transactions (fecha,desc_banco,desc_usuario,monto,moneda,category_id,account_id,es_cuota,installment_id,dedup_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(fecha, desc_banco, desc_usuario, monto, moneda, resolvedCategoryId, account_id, es_cuota ? 1 : 0, installment_id, dedupHash);

  const transaction = await db.prepare(
    `SELECT t.*,c.name AS category_name,c.type AS category_type,a.name AS account_name
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts a ON a.id=t.account_id
     WHERE t.id=?`
  ).get(result.lastInsertRowid);

  return c.json(transaction, 201);
});

router.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const current = await db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);
  if (!current) return c.json({ error: "transaction not found" }, 404);

  const body = await c.req.json();
  const next = {
    category_id:  body.category_id  ?? current.category_id,
    desc_usuario: body.desc_usuario ?? current.desc_usuario,
    account_id:   body.account_id   ?? current.account_id
  };

  await db.prepare("UPDATE transactions SET category_id=?,desc_usuario=?,account_id=? WHERE id=?")
    .run(next.category_id, next.desc_usuario, next.account_id, id);

  let ruleStatus = null;
  if (body.category_id && body.category_id !== current.category_id) {
    ruleStatus = await ensureRuleForManualCategorization(db, current.desc_banco, body.category_id);
  }

  const updated = await db.prepare(
    `SELECT t.*,c.name AS category_name,c.type AS category_type,a.name AS account_name
     FROM transactions t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN accounts a ON a.id=t.account_id
     WHERE t.id=?`
  ).get(id);

  return c.json({ transaction: updated, rule: ruleStatus });
});

router.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const db = getDb(c.env);
  const existing = await db.prepare("SELECT id FROM transactions WHERE id = ?").get(id);
  if (!existing) return c.json({ error: "transaction not found" }, 404);
  await db.prepare("DELETE FROM transactions WHERE id = ?").run(id);
  return c.json({ ok: true });
});

export default router;
