import { Hono } from "hono";
import { getDb, getSettingsObject } from "../db.js";

const router = new Hono();
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);

function slugify(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

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
  const body = await c.req.json();
  const name = String(body.name || "").trim();
  const currency = String(body.currency || "").trim().toUpperCase();
  const balance = Number(body.balance ?? 0);
  if (!name || !currency) return c.json({ error: "name and currency are required" }, 400);
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    return c.json({ error: "currency must be UYU, USD or ARS" }, 400);
  }
  if (!Number.isFinite(balance)) {
    return c.json({ error: "balance must be a finite number" }, 400);
  }
  const db = getDb(c.env);
  let id = String(body.id || "").trim();
  if (!id) {
    const base = slugify(name) || "cuenta";
    id = base;
    let suffix = 2;
    while (await db.prepare("SELECT id FROM accounts WHERE id = ? AND user_id = ?").get(id, userId)) {
      id = `${base}_${suffix++}`;
    }
  } else {
    const existing = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(id, userId);
    if (existing) return c.json({ error: "Ya existe una cuenta con ese ID" }, 409);
  }
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
  const next = {
    name: body.name !== undefined ? String(body.name).trim() : current.name,
    balance: body.balance !== undefined ? Number(body.balance) : current.balance
  };
  if (!next.name) return c.json({ error: "name is required" }, 400);
  if (!Number.isFinite(next.balance)) return c.json({ error: "balance must be a finite number" }, 400);
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
  const uploadCountRow = await db.prepare(
    "SELECT COUNT(*) AS count FROM uploads WHERE account_id=? AND user_id=?"
  ).get(id, userId);
  const uploadCount = uploadCountRow.count || 0;
  const installmentRows = await db.prepare(
    "SELECT id FROM installments WHERE account_id=? AND user_id=?"
  ).all(id, userId);
  const installmentIds = installmentRows.map((row) => row.id);
  if (force) {
    const statements = [];
    if (installmentIds.length > 0) {
      const placeholders = installmentIds.map(() => "?").join(", ");
      statements.push(c.env.DB.prepare(
        `UPDATE transactions
         SET installment_id = NULL
         WHERE user_id = ? AND installment_id IN (${placeholders})`
      ).bind(userId, ...installmentIds));
    }
    if (txCount > 0) {
      statements.push(c.env.DB.prepare(
        "DELETE FROM transactions WHERE account_id=? AND user_id=?"
      ).bind(id, userId));
    }
    if (uploadCount > 0) {
      statements.push(c.env.DB.prepare(
        "DELETE FROM uploads WHERE account_id=? AND user_id=?"
      ).bind(id, userId));
    }
    if (installmentIds.length > 0) {
      const placeholders = installmentIds.map(() => "?").join(", ");
      statements.push(c.env.DB.prepare(
        `DELETE FROM installments
         WHERE user_id = ? AND id IN (${placeholders})`
      ).bind(userId, ...installmentIds));
    }
    statements.push(c.env.DB.prepare("DELETE FROM accounts WHERE id=? AND user_id=?").bind(id, userId));
    await c.env.DB.batch(statements);
  } else {
    if (txCount > 0 || installmentIds.length > 0 || uploadCount > 0) {
      return c.json({
        error: "account has linked transactions, uploads or installments",
        tx_count: txCount,
        upload_count: uploadCount,
        installment_count: installmentIds.length
      }, 409);
    }
    await db.prepare("DELETE FROM accounts WHERE id=? AND user_id=?").run(id, userId);
  }
  return new Response(null, { status: 204 });
});

export default router;
