import { Hono } from "hono";
import { getDb, getSettingsObject } from "../db.js";

const router = new Hono();

router.get("/consolidated", async (c) => {
  const settings = await getSettingsObject(c.env);
  const rate = Number(settings.exchange_rate_usd_uyu || 1);
  const displayCurrency = settings.display_currency || "UYU";
  const db = getDb(c.env);
  const rows = await db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all();
  const total = rows.reduce((sum, acc) => {
    if (displayCurrency === acc.currency) return sum + acc.balance;
    if (displayCurrency === "UYU" && acc.currency === "USD") return sum + acc.balance * rate;
    if (displayCurrency === "USD" && acc.currency === "UYU") return sum + acc.balance / rate;
    return sum + acc.balance;
  }, 0);
  return c.json({ total, currency: displayCurrency, exchange_rate: rate });
});

router.get("/", async (c) => {
  const db = getDb(c.env);
  return c.json(await db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all());
});

router.post("/", async (c) => {
  const { id, name, currency, balance = 0 } = await c.req.json();
  if (!id || !name || !currency) return c.json({ error: "id, name and currency are required" }, 400);
  const db = getDb(c.env);
  await db.prepare("INSERT INTO accounts (id,name,currency,balance) VALUES (?,?,?,?)").run(id, name, currency, balance);
  return c.json(await db.prepare("SELECT * FROM accounts WHERE id=?").get(id), 201);
});

router.put("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const current = await db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (!current) return c.json({ error: "account not found" }, 404);
  const body = await c.req.json();
  const next = { name: body.name ?? current.name, balance: body.balance ?? current.balance };
  await db.prepare("UPDATE accounts SET name=?,balance=? WHERE id=?").run(next.name, next.balance, id);
  return c.json(await db.prepare("SELECT * FROM accounts WHERE id=?").get(id));
});

router.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = getDb(c.env);
  const count = await db.prepare("SELECT COUNT(*) AS count FROM transactions WHERE account_id=?").get(id);
  if (count.count > 0) return c.json({ error: "account has linked transactions" }, 409);
  await db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  return new Response(null, { status: 204 });
});

export default router;
