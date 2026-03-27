import { Hono } from "hono";
import { getDb, getSettingsObject } from "../db.js";

const router = new Hono();

router.get("/consolidated", async (c) => {
  const userId  = c.get("userId");
  const settings = await getSettingsObject(c.env, userId);
  const rateUsd  = Number(settings.exchange_rate_usd_uyu  || 42.5);
  const rateArs  = Number(settings.exchange_rate_ars_uyu  || 0.045);
  const displayCurrency = settings.display_currency || "UYU";
  const db   = getDb(c.env);
  const rows = await db.prepare(
    "SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC"
  ).all(userId);
  const toDisplay = (balance, currency) => {
    if (currency === displayCurrency) return balance;
    let inUyu = balance;
    if (currency === "USD") inUyu = balance * rateUsd;
    else if (currency === "ARS") inUyu = balance * rateArs;
    if (displayCurrency === "UYU") return inUyu;
    if (displayCurrency === "USD") return inUyu / rateUsd;
    if (displayCurrency === "ARS") return inUyu / rateArs;
    return inUyu;
  };
  const total = rows.reduce((sum, acc) => sum + toDisplay(acc.balance, acc.currency), 0);
  return c.json({ total, currency: displayCurrency, exchange_rate: rateUsd });
});

router.get("/", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  return c.json(await db.prepare(
    "SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at ASC"
  ).all(userId));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const { id, name, currency, balance = 0 } = await c.req.json();
  if (!id || !name || !currency) return c.json({ error: "id, name and currency are required" }, 400);
  const db = getDb(c.env);
  // Check for duplicate id within this user's accounts
  const existing = await db.prepare(
    "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (existing) return c.json({ error: "Ya existe una cuenta con ese ID" }, 409);
  await db.prepare(
    "INSERT INTO accounts (id,name,currency,balance,user_id) VALUES (?,?,?,?,?)"
  ).run(id, name, currency, balance, userId);
  return c.json(await db.prepare("SELECT * FROM accounts WHERE id=? AND user_id=?").get(id, userId), 201);
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = c.req.param("id");
  const db     = getDb(c.env);
  const current = await db.prepare(
    "SELECT * FROM accounts WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!current) return c.json({ error: "account not found" }, 404);
  const body = await c.req.json();
  const next = { name: body.name ?? current.name, balance: body.balance ?? current.balance };
  await db.prepare(
    "UPDATE accounts SET name=?,balance=? WHERE id=? AND user_id=?"
  ).run(next.name, next.balance, id, userId);
  return c.json(await db.prepare("SELECT * FROM accounts WHERE id=? AND user_id=?").get(id, userId));
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = c.req.param("id");
  const force  = c.req.query("force") === "true";
  const db     = getDb(c.env);
  const existing = await db.prepare(
    "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!existing) return c.json({ error: "account not found" }, 404);
  const txCountRow = await db.prepare(
    "SELECT COUNT(*) AS count FROM transactions WHERE account_id=? AND user_id=?"
  ).get(id, userId);
  const txCount = txCountRow.count || 0;
  const installmentRows = await db.prepare(
    "SELECT id FROM installments WHERE account_id=? AND user_id=?"
  ).all(id, userId);
  const installmentIds = installmentRows.map((row) => row.id);
  if (force) {
    if (installmentIds.length > 0) {
      const placeholders = installmentIds.map(() => "?").join(", ");
      await db.prepare(
        `UPDATE transactions
         SET installment_id = NULL
         WHERE user_id = ? AND installment_id IN (${placeholders})`
      ).run(userId, ...installmentIds);
    }
    if (txCount > 0) {
      await db.prepare("DELETE FROM transactions WHERE account_id=? AND user_id=?").run(id, userId);
    }
    if (installmentIds.length > 0) {
      const placeholders = installmentIds.map(() => "?").join(", ");
      await db.prepare(
        `DELETE FROM installments
         WHERE user_id = ? AND id IN (${placeholders})`
      ).run(userId, ...installmentIds);
    }
  } else {
    if (txCount > 0 || installmentIds.length > 0) {
      return c.json({
        error: "account has linked transactions or installments",
        tx_count: txCount,
        installment_count: installmentIds.length
      }, 409);
    }
  }
  await db.prepare("DELETE FROM accounts WHERE id=? AND user_id=?").run(id, userId);
  return c.json({ ok: true });
});

export default router;
