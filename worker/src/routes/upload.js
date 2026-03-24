import { Hono } from "hono";
import { getDb } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { findMatchingRule, bumpRule } from "../services/categorizer.js";
import { extractTransactions } from "../services/tx-extractor.js";

const router = new Hono();

router.get("/", async (c) => {
  const db = getDb(c.env);
  const period = c.req.query("period");
  const sql = period
    ? `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id WHERE u.period=? ORDER BY u.created_at DESC`
    : `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id ORDER BY u.created_at DESC`;
  return c.json(period ? await db.prepare(sql).all(period) : await db.prepare(sql).all());
});

router.post("/", async (c) => {
  const formData = await c.req.formData();
  const account_id = formData.get("account_id") || null;
  const period = formData.get("period");
  const extracted_text = formData.get("extracted_text") || null;
  const file = formData.get("file");

  if (!period || !/^\d{4}-\d{2}$/.test(period)) return c.json({ error: "period is required in YYYY-MM format" }, 400);
  if (!account_id) return c.json({ error: "account_id is required" }, 400);
  if (!file && !extracted_text) return c.json({ error: "file or extracted_text is required" }, 400);

  const filename = file ? file.name : `manual-${period}.txt`;
  const db = getDb(c.env);

  // Resolve account currency so transactions inherit it (not hardcoded UYU)
  const account = await db.prepare("SELECT currency FROM accounts WHERE id=?").get(account_id);
  const accountCurrency = account?.currency || "UYU";

  const uploadResult = await db.prepare(
    "INSERT INTO uploads (filename,account_id,period,status) VALUES (?,?,?,'pending')"
  ).run(filename, account_id, period);
  const uploadId = uploadResult.lastInsertRowid;

  let newTransactions = 0;
  let duplicatesSkipped = 0;
  let autoCategorized = 0;
  let pendingReview = 0;

  // Upload file to R2 if present
  if (file && c.env.UPLOADS) {
    const buffer = await file.arrayBuffer();
    await c.env.UPLOADS.put(`${uploadId}-${filename}`, buffer, {
      httpMetadata: { contentType: file.type }
    });
  }

  // Parse transactions from extracted text (sent by client after PDF.js parsing)
  // or from plain text file content
  let textToParse = extracted_text;
  if (!textToParse && file) {
    const ext = filename.split(".").pop().toLowerCase();
    if (ext === "txt" || ext === "csv") {
      textToParse = await file.text();
    }
  }

  if (textToParse) {
    const settings_row = await c.env.DB.prepare("SELECT value FROM settings WHERE key='parsing_patterns'").first();
    let patterns = [];
    try { patterns = JSON.parse(settings_row?.value || "[]"); } catch (_) { patterns = []; }

    const { transactions } = extractTransactions(textToParse, patterns, period);

    for (const tx of transactions) {
      const dedupHash = await buildDedupHash(tx);
      const exists = await db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash=? AND substr(fecha,1,7)=? LIMIT 1"
      ).get(dedupHash, period);

      if (exists) { duplicatesSkipped++; continue; }

      let categoryId = null;
      const rule = await findMatchingRule(db, tx.desc_banco);
      if (rule) { categoryId = rule.category_id; await bumpRule(db, rule.id); autoCategorized++; }
      else { pendingReview++; }

      await db.prepare(
        "INSERT INTO transactions (fecha,desc_banco,monto,moneda,category_id,account_id,upload_id,dedup_hash) VALUES (?,?,?,?,?,?,?,?)"
      ).run(tx.fecha, tx.desc_banco, tx.monto, accountCurrency, categoryId, account_id, uploadId, dedupHash);
      newTransactions++;
    }
  }

  await db.prepare("UPDATE uploads SET tx_count=?,status='processed' WHERE id=?").run(newTransactions, uploadId);

  return c.json({ upload_id: uploadId, new_transactions: newTransactions,
    duplicates_skipped: duplicatesSkipped, auto_categorized: autoCategorized, pending_review: pendingReview }, 201);
});

export default router;
