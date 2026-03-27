import { Hono } from "hono";
import { getDb } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { findMatchingRule, bumpRule, isLikelyReintegro, isLikelyTransfer } from "../services/categorizer.js";
import { extractTransactions } from "../services/tx-extractor.js";
import { parseCSV } from "../services/csv-parser.js";
import { detectFormat, computeFormatKey, applyColumnMap } from "../services/format-detector.js";

const router = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Split one CSV line respecting quoted fields. */
function splitLine(line) {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { fields.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

/**
 * Find the header row in a CSV text (skips BROU metadata lines).
 * Returns { headerIdx, lines } or null.
 */
function findHeader(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const fields = splitLine(lines[i]);
    const norms  = fields.map(f => f.toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/\ufffd/g, "").trim());
    if (norms.some(n => n === "fecha" || n === "date")) {
      return { headerIdx: i, lines, headers: fields, normHeaders: norms };
    }
  }
  return null;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/", async (c) => {
  const db = getDb(c.env);
  const userId = c.get("userId");
  const period = c.req.query("period");
  const sql = period
    ? `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id AND a.user_id=u.user_id WHERE u.period=? AND u.user_id=? ORDER BY u.created_at DESC`
    : `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id AND a.user_id=u.user_id WHERE u.user_id=? ORDER BY u.created_at DESC`;
  const rows = period
    ? await db.prepare(sql).all(period, userId)
    : await db.prepare(sql).all(userId);
  return c.json(rows);
});

router.post("/", async (c) => {
  const formData   = await c.req.formData();
  const account_id     = formData.get("account_id") || null;
  const period         = formData.get("period");
  const extracted_text = formData.get("extracted_text") || null;
  const file           = formData.get("file");
  const userId         = c.get("userId");

  if (!period || !/^\d{4}-\d{2}$/.test(period))
    return c.json({ error: "period is required in YYYY-MM format" }, 400);
  if (!account_id)
    return c.json({ error: "account_id is required" }, 400);
  if (!file && !extracted_text)
    return c.json({ error: "file or extracted_text is required" }, 400);

  const filename = file ? file.name : `manual-${period}.txt`;
  const db       = getDb(c.env);

  const account        = await db.prepare("SELECT currency FROM accounts WHERE id=? AND user_id=?").get(account_id, userId);
  const accountCurrency = account?.currency || "UYU";

  const uploadResult = await db.prepare(
    "INSERT INTO uploads (filename,account_id,period,status,user_id) VALUES (?,?,?,'pending',?)"
  ).run(filename, account_id, period, userId);
  const uploadId = uploadResult.lastInsertRowid;

  // Store file in R2 if configured
  if (file && c.env.UPLOADS) {
    const buffer = await file.arrayBuffer();
    await c.env.UPLOADS.put(`${uploadId}-${filename}`, buffer, {
      httpMetadata: { contentType: file.type },
    });
  }

  let newTransactions = 0, duplicatesSkipped = 0, autoCategorized = 0, pendingReview = 0;
  let extractedTxs = [];

  const ext = (filename.split(".").pop() || "").toLowerCase();

  if (ext === "csv") {
    // ── CSV path ────────────────────────────────────────────────────────────
    const csvText = await file.text();

    // 1. Try the dedicated CSV parser (handles BROU natively)
    const { transactions: parsed } = parseCSV(csvText);

    if (parsed.length > 0) {
      extractedTxs = parsed;
    } else {
      // 2. Parser got 0 results — try format detector
      const found = findHeader(csvText);
      if (found) {
        const { headers, normHeaders, headerIdx, lines } = found;
        const formatKey = computeFormatKey(headers);

        // Check if user has a saved custom mapping for this format
        let savedFmt = null;
        try {
          savedFmt = await db.prepare(
            "SELECT * FROM bank_formats WHERE user_id = ? AND format_key = ?"
          ).get(userId, formatKey);
        } catch (_) { /* table may not exist yet */ }

        let columns = null;
        let detectedName = null;

        if (savedFmt) {
          // Use the user's saved mapping
          columns = {
            fecha:  savedFmt.col_fecha,
            desc:   savedFmt.col_desc,
            debit:  savedFmt.col_debit,
            credit: savedFmt.col_credit,
            monto:  savedFmt.col_monto,
          };
          detectedName = savedFmt.bank_name || "Formato guardado";
        } else {
          // Try auto-detection
          const detected = detectFormat(headers);
          if (detected) {
            columns = detected.columns;
            detectedName = detected.name;
          }
        }

        if (columns && columns.fecha >= 0) {
          // We have a column map — apply it
          const dataRows = lines
            .slice(headerIdx + 1)
            .filter(l => l.trim())
            .map(l => splitLine(l));
          const { transactions } = applyColumnMap(dataRows, columns, period);
          extractedTxs = transactions;
        } else {
          // Unknown format — ask client to show column mapper
          await db.prepare("UPDATE uploads SET status='needs_mapping' WHERE id=?").run(uploadId);
          return c.json({
            upload_id:      uploadId,
            needs_mapping:  true,
            format_key:     formatKey,
            columns:        headers,
            sample:         lines.slice(headerIdx, headerIdx + 6).map(l => splitLine(l)),
            new_transactions: 0,
            duplicates_skipped: 0,
            auto_categorized:   0,
            pending_review:     0,
          }, 200);
        }
      }
    }
  } else {
    // ── PDF / text path ─────────────────────────────────────────────────────
    let textToParse = extracted_text;
    if (!textToParse && file && ext === "txt") textToParse = await file.text();
    if (textToParse) {
      const settings_row = await db.prepare(
        "SELECT value FROM settings WHERE key='parsing_patterns' AND user_id=?"
      ).get(userId);
      let patterns = [];
      try { patterns = JSON.parse(settings_row?.value || "[]"); } catch (_) { patterns = []; }
      const { transactions } = extractTransactions(textToParse, patterns, period);
      extractedTxs = transactions;
    }
  }

  // ── Persist transactions ─────────────────────────────────────────────────
  const rules = await db.prepare(
    "SELECT id, pattern, category_id FROM rules WHERE user_id=? ORDER BY match_count DESC"
  ).all(userId);
  const transferCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Transferencia'"
  ).get(userId);
  const reintegroCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND name = 'Reintegro'"
  ).get(userId);

  for (const tx of extractedTxs) {
    const dedupHash = await buildDedupHash(tx);
    const exists    = await db.prepare(
      "SELECT id FROM transactions WHERE dedup_hash=? AND user_id=? AND substr(fecha,1,7)=? LIMIT 1"
    ).get(dedupHash, userId, period);
    if (exists) { duplicatesSkipped++; continue; }

    let categoryId = null;
    const rule = rules.find(r => tx.desc_banco.toLowerCase().includes(r.pattern.toLowerCase()));
    if (rule) {
      categoryId = rule.category_id;
      await bumpRule(db, rule.id);
      autoCategorized++;
    } else if (isLikelyTransfer(tx.desc_banco)) {
      if (transferCategory) { categoryId = transferCategory.id; autoCategorized++; }
      else pendingReview++;
    } else if (await isLikelyReintegro(db, tx.desc_banco, Number(tx.monto), accountCurrency, userId)) {
      if (reintegroCategory) { categoryId = reintegroCategory.id; autoCategorized++; }
      else pendingReview++;
    } else {
      pendingReview++;
    }

    await db.prepare(
      "INSERT INTO transactions (fecha,desc_banco,monto,moneda,category_id,account_id,upload_id,dedup_hash,user_id) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(tx.fecha, tx.desc_banco, tx.monto, accountCurrency, categoryId, account_id, uploadId, dedupHash, userId);
    newTransactions++;
  }

  await db.prepare("UPDATE uploads SET tx_count=?,status='processed' WHERE id=?")
    .run(newTransactions, uploadId);

  return c.json({
    upload_id:          uploadId,
    new_transactions:   newTransactions,
    duplicates_skipped: duplicatesSkipped,
    auto_categorized:   autoCategorized,
    pending_review:     pendingReview,
  }, 201);
});

export default router;
