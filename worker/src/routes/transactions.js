import { Hono } from "hono";
import { getDb, isValidMonthString } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { ensureRuleForManualCategorization, findMatchingRule, bumpRule, isLikelyReintegro, isLikelyTransfer } from "../services/categorizer.js";
import { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } from "../services/metrics.js";
import { suggestSync } from "../services/suggester.js";

const router = new Hono();
const SUPPORTED_CURRENCIES = new Set(["UYU", "USD", "ARS"]);

function getMonth(c) {
  const month = c.req.query("month");
  return isValidMonthString(month) ? month : null;
}

function parsePositiveInt(rawValue, fallback, max = null) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max == null ? parsed : Math.min(parsed, max);
}

function isValidISODate(value) {
  const raw = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Global full-text search across all months
router.get("/search", async (c) => {
  const userId = c.get("userId");
  const q     = (c.req.query("q") || "").trim();
  const limit = parsePositiveInt(c.req.query("limit") || 20, 20, 50);
  if (q.length < 2) return c.json([]);
  const db   = getDb(c.env);
  const term = `%${q}%`;
  const rows = await db.prepare(
    `SELECT t.id, t.fecha, t.desc_banco, t.desc_usuario, t.monto, t.moneda,
            c.name AS category_name, c.color AS category_color, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.user_id = ?
       AND (LOWER(t.desc_banco) LIKE LOWER(?) OR LOWER(COALESCE(t.desc_usuario,'')) LIKE LOWER(?) OR CAST(t.monto AS TEXT) LIKE ?)
     ORDER BY t.fecha DESC LIMIT ?`
  ).all(userId, term, term, term, limit);
  return c.json(rows);
});

router.get("/pending", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db   = getDb(c.env);
  const rows = await getTransactionsForMonth(db, month, userId, "AND t.category_id IS NULL");
  return c.json(rows);
});

router.get("/summary", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db = getDb(c.env);
  return c.json(await computeSummary(db, c.env, month, userId));
});

router.get("/monthly-evolution", async (c) => {
  const userId = c.get("userId");
  const end    = c.req.query("end");
  if (!isValidMonthString(end)) {
    return c.json({ error: "end is required in YYYY-MM format" }, 400);
  }
  const months = parsePositiveInt(c.req.query("months") || 6, 6, 24);
  const db = getDb(c.env);
  return c.json(await computeMonthlyEvolution(db, c.env, end, months, userId));
});

router.get("/", async (c) => {
  const userId = c.get("userId");
  const month  = getMonth(c);
  if (!month) return c.json({ error: "month is required in YYYY-MM format" }, 400);
  const db   = getDb(c.env);
  const filters = [];
  const params = [];

  const accountId = c.req.query("account_id");
  if (accountId) {
    filters.push("AND t.account_id = ?");
    params.push(accountId);
  }

  const categoryId = c.req.query("category_id");
  if (categoryId) {
    filters.push("AND t.category_id = ?");
    params.push(Number(categoryId));
  }

  const rows = await getTransactionsForMonth(db, month, userId, filters.join(" "), params);
  // Attach category suggestions to uncategorized transactions
  const [rules, categories] = await Promise.all([
    db.prepare("SELECT id, pattern, category_id FROM rules WHERE user_id = ? ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC").all(userId),
    db.prepare("SELECT id, name FROM categories WHERE user_id = ?").all(userId),
  ]);
  return c.json(rows.map((tx) => suggestSync(tx, rules, categories)));
});

router.post("/", async (c) => {
  const userId = c.get("userId");
  const body   = await c.req.json();
  const { fecha, desc_banco, desc_usuario = null, monto, moneda = "UYU",
          category_id = null, account_id = null, es_cuota = 0, installment_id = null } = body;
  const normalizedDescBanco = String(desc_banco || "").trim();
  const normalizedDescUsuario = desc_usuario == null ? null : String(desc_usuario).trim() || null;
  if (!fecha || !normalizedDescBanco || monto == null) {
    return c.json({ error: "fecha, desc_banco and monto are required" }, 400);
  }
  if (!isValidISODate(fecha)) {
    return c.json({ error: "fecha must be in YYYY-MM-DD format" }, 400);
  }
  if (!Number.isFinite(Number(monto))) {
    return c.json({ error: "monto must be a finite number" }, 400);
  }
  if (!SUPPORTED_CURRENCIES.has(moneda)) {
    return c.json({ error: "moneda must be UYU, USD or ARS" }, 400);
  }
  const db   = getDb(c.env);
  if (account_id) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }
  if (category_id != null) {
    const category = await db.prepare(
      "SELECT id FROM categories WHERE id = ? AND user_id = ?"
    ).get(Number(category_id), userId);
    if (!category) return c.json({ error: "category not found" }, 404);
  }
  if (installment_id != null) {
    const installment = await db.prepare(
      "SELECT id FROM installments WHERE id = ? AND user_id = ?"
    ).get(Number(installment_id), userId);
    if (!installment) return c.json({ error: "installment not found" }, 404);
  }
  const hash = await buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
  const dup  = await db.prepare(
    "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)"
  ).get(hash, userId, fecha);
  if (dup) return c.json({ error: "Duplicate transaction", id: dup.id }, 409);

  // Auto-categorize
  let resolvedCategoryId = category_id;
  if (!resolvedCategoryId) {
    const rule = await findMatchingRule(db, normalizedDescBanco, userId);
    if (rule) {
      resolvedCategoryId = rule.category_id;
      await bumpRule(db, rule.id);
    } else if (isLikelyTransfer(normalizedDescBanco)) {
      const transferCategory = await db.prepare(
        "SELECT id FROM categories WHERE user_id = ? AND name = 'Transferencia'"
      ).get(userId);
      if (transferCategory) resolvedCategoryId = transferCategory.id;
    } else if (await isLikelyReintegro(db, normalizedDescBanco, Number(monto), moneda, userId)) {
      const reintegroCategory = await db.prepare(
        "SELECT id FROM categories WHERE user_id = ? AND name = 'Reintegro'"
      ).get(userId);
      if (reintegroCategory) resolvedCategoryId = reintegroCategory.id;
    }
  }

  const result = await db.prepare(
    `INSERT INTO transactions (fecha,desc_banco,desc_usuario,monto,moneda,category_id,account_id,es_cuota,installment_id,dedup_hash,user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(fecha, normalizedDescBanco, normalizedDescUsuario, Number(monto), moneda,
        resolvedCategoryId, account_id, es_cuota ? 1 : 0, installment_id, hash, userId);

  const created = await db.prepare(
    `SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.id = ? AND t.user_id = ?`
  ).get(result.lastInsertRowid, userId);

  return c.json(created, 201);
});

// Batch create (CSV import)
router.post("/batch", async (c) => {
  const userId = c.get("userId");
  const { transactions: txList, account_id: batchAccount } = await c.req.json();
  if (!Array.isArray(txList)) return c.json({ error: "transactions array required" }, 400);
  const db    = getDb(c.env);
  if (batchAccount) {
    const batchAccountRow = await db.prepare(
      "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
    ).get(batchAccount, userId);
    if (!batchAccountRow) return c.json({ error: "account not found" }, 404);
  }
  const rules = await db.prepare(
    "SELECT id, pattern, category_id FROM rules WHERE user_id = ? ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC"
  ).all(userId);
  const transferCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Transferencia'"
  ).get(userId);
  const reintegroCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Reintegro'"
  ).get(userId);
  const accountCurrencyCache = new Map();
  const categories = await db.prepare("SELECT id FROM categories WHERE user_id = ?").all(userId);
  const categoryIds = new Set(categories.map((row) => Number(row.id)));
  if (batchAccount) {
    const batchAccountRow = await db.prepare(
      "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
    ).get(batchAccount, userId);
    if (batchAccountRow?.currency) accountCurrencyCache.set(batchAccount, batchAccountRow.currency);
  }

  let created = 0, duplicates = 0, errors = 0;
  for (const tx of txList) {
    try {
      const { fecha, desc_banco, monto, moneda, account_id } = tx;
      const normalizedDescBanco = String(desc_banco || "").trim();
      if (!fecha || !normalizedDescBanco || monto == null) { errors++; continue; }
      if (!isValidISODate(fecha) || !Number.isFinite(Number(monto))) { errors++; continue; }
      if (moneda != null && !SUPPORTED_CURRENCIES.has(moneda)) { errors++; continue; }
      if (tx.category_id != null && !categoryIds.has(Number(tx.category_id))) { errors++; continue; }
      const hash = await buildDedupHash({ fecha, monto, desc_banco: normalizedDescBanco });
      const dup  = await db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND user_id = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)"
      ).get(hash, userId, fecha);
      if (dup) { duplicates++; continue; }

      const resolvedAccountId = account_id || batchAccount || null;
      if (resolvedAccountId && !accountCurrencyCache.has(resolvedAccountId)) {
        const accountRow = await db.prepare(
          "SELECT currency FROM accounts WHERE id = ? AND user_id = ?"
        ).get(resolvedAccountId, userId);
        if (!accountRow) { errors++; continue; }
        if (accountRow?.currency) accountCurrencyCache.set(resolvedAccountId, accountRow.currency);
      }
      const resolvedCurrency = moneda || accountCurrencyCache.get(resolvedAccountId) || "UYU";
      const rule = rules.find((r) => normalizedDescBanco.toLowerCase().includes(r.pattern.toLowerCase()));
      let resolvedCategoryId = rule?.category_id ?? null;
      if (rule) {
        await bumpRule(db, rule.id);
      } else if (isLikelyTransfer(normalizedDescBanco)) {
        resolvedCategoryId = transferCategory?.id ?? null;
      } else if (await isLikelyReintegro(db, normalizedDescBanco, Number(monto), resolvedCurrency, userId)) {
        resolvedCategoryId = reintegroCategory?.id ?? null;
      }
      await db.prepare(
        `INSERT INTO transactions (fecha,desc_banco,monto,moneda,category_id,account_id,dedup_hash,user_id)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(fecha, normalizedDescBanco, Number(monto), resolvedCurrency,
            resolvedCategoryId, resolvedAccountId, hash, userId);
      created++;
    } catch { errors++; }
  }
  return c.json({ created, duplicates, errors });
});

router.put("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const tx     = await db.prepare(
    "SELECT * FROM transactions WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);

  const body = await c.req.json();
  if (body.account_id !== undefined && body.account_id !== null) {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE id = ? AND user_id = ?"
    ).get(body.account_id, userId);
    if (!account) return c.json({ error: "account not found" }, 404);
  }
  if (body.fecha !== undefined && !isValidISODate(body.fecha)) {
    return c.json({ error: "fecha must be in YYYY-MM-DD format" }, 400);
  }
  if (body.monto !== undefined && !Number.isFinite(Number(body.monto))) {
    return c.json({ error: "monto must be a finite number" }, 400);
  }
  if (body.desc_usuario !== undefined && body.desc_usuario !== null && !String(body.desc_usuario).trim()) {
    return c.json({ error: "desc_usuario cannot be blank" }, 400);
  }
  if (body.category_id !== undefined && body.category_id !== null) {
    const category = await db.prepare(
      "SELECT id FROM categories WHERE id = ? AND user_id = ?"
    ).get(Number(body.category_id), userId);
    if (!category) return c.json({ error: "category not found" }, 404);
  }
  const next = {
    category_id:  body.category_id  !== undefined ? body.category_id  : tx.category_id,
    desc_usuario: body.desc_usuario !== undefined ? (String(body.desc_usuario).trim() || null) : tx.desc_usuario,
    account_id:   body.account_id   !== undefined ? body.account_id   : tx.account_id,
    fecha:        body.fecha        !== undefined ? body.fecha        : tx.fecha,
    monto:        body.monto        !== undefined ? Number(body.monto): tx.monto,
  };
  const nextDedupHash = await buildDedupHash({
    fecha: next.fecha,
    monto: next.monto,
    desc_banco: tx.desc_banco
  });
  const duplicate = await db.prepare(
    `SELECT id
     FROM transactions
     WHERE id <> ? AND user_id = ? AND dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
     LIMIT 1`
  ).get(id, userId, nextDedupHash, next.fecha);
  if (duplicate) {
    return c.json({ error: "Duplicate transaction", id: duplicate.id }, 409);
  }

  await db.prepare(
    `UPDATE transactions SET category_id=?,desc_usuario=?,account_id=?,fecha=?,monto=?,dedup_hash=?
     WHERE id=? AND user_id=?`
  ).run(next.category_id, next.desc_usuario, next.account_id, next.fecha, next.monto, nextDedupHash, id, userId);

  let ruleResult = null;
  if (body.category_id != null && body.category_id !== tx.category_id) {
    ruleResult = await ensureRuleForManualCategorization(db, tx.desc_banco, body.category_id, userId);
  }

  const updated = await db.prepare(
    `SELECT t.*, c.name AS category_name, c.type AS category_type, a.name AS account_name
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = t.user_id
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     WHERE t.id = ? AND t.user_id = ?`
  ).get(id, userId);

  return c.json({ transaction: updated, rule: ruleResult });
});

router.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id     = Number(c.req.param("id"));
  const db     = getDb(c.env);
  const tx     = await db.prepare(
    "SELECT id FROM transactions WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!tx) return c.json({ error: "transaction not found" }, 404);
  await db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, userId);
  return c.json({ ok: true });
});

export default router;
