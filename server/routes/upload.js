const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { db, getSettingsObject } = require("../db");
const { parsePdfText } = require("../services/pdf-parser");
const { extractTransactions } = require("../services/tx-extractor");
const { buildDedupHash } = require("../services/dedup");
const { findMatchingRule, bumpRule, isLikelyReintegro, isLikelyTransfer } = require("../services/categorizer");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function normH(h) {
  return (h || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\ufffd/g, "").trim();
}

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function splitCSVLine(line, delim = ",") {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function parseCsvRows(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let headerLineIdx = -1;
  let delim = ",";
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const d = detectDelimiter(lines[i]);
    const fields = splitCSVLine(lines[i], d).map(normH);
    if (fields.some(f => f === "fecha" || f === "date") && fields.length >= 3) {
      headerLineIdx = i;
      delim = d;
      break;
    }
  }
  if (headerLineIdx === -1) {
    const firstNonEmpty = lines.find(l => l.trim());
    delim = firstNonEmpty ? detectDelimiter(firstNonEmpty) : ",";
    headerLineIdx = 0;
  }
  const rows = lines.slice(headerLineIdx)
    .map(l => splitCSVLine(l, delim))
    .filter(r => r.some(c => c.length > 0));
  return rows;
}

function formatKeyFromHeaders(headers) {
  const normalized = headers.map(normH).join("|");
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function parseCsvAmount(str) {
  if (!str) return null;
  const clean = str.replace(/[^\d,.-]/g, "").trim();
  if (!clean) return null;
  const commaPos = clean.lastIndexOf(",");
  const dotPos   = clean.lastIndexOf(".");
  let normalized;
  if (commaPos > dotPos)      normalized = clean.replace(/\./g, "").replace(",", ".");
  else if (dotPos > commaPos) normalized = clean.replace(/,/g, "");
  else                        normalized = clean;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parseCsvDate(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, callback) => {
    callback(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`);
  }
});

const upload = multer({ storage });

router.get("/", (req, res) => {
  const params = [];
  let where = "";

  if (req.query.period) {
    where = "WHERE u.period = ?";
    params.push(req.query.period);
  }

  const rows = db
    .prepare(
      `
      SELECT u.*, a.name AS account_name
      FROM uploads u
      LEFT JOIN accounts a ON a.id = u.account_id
      ${where}
      ORDER BY u.created_at DESC
    `
    )
    .all(...params);

  res.json(rows);
});

router.post("/", upload.single("file"), async (req, res, next) => {
  try {
    const { account_id = null, period } = req.body;
    if (!req.file || !period) {
      return res.status(400).json({ error: "file and period are required" });
    }
    const accountRow = account_id
      ? db.prepare("SELECT currency FROM accounts WHERE id = ?").get(account_id)
      : null;
    if (account_id && !accountRow) {
      return res.status(404).json({ error: "account not found" });
    }

    const uploadResult = db
      .prepare("INSERT INTO uploads (filename, account_id, period, status) VALUES (?, ?, ?, 'pending')")
      .run(req.file.filename, account_id, period);

    let newTransactions = 0;
    let duplicatesSkipped = 0;
    let autoCategorized = 0;
    let pendingReview = 0;
    const extension = path.extname(req.file.originalname).toLowerCase();

    // Resolve the account's currency so PDF transactions are stored correctly.
    // Falls back to UYU if account not found (shouldn't happen in normal flow).
    const accountCurrency = accountRow?.currency || "UYU";

    if (extension === ".pdf") {
      // The browser client (PDF.js) extracts text client-side and sends it as
      // the `extracted_text` form field to avoid a round-trip server PDF parse.
      // Fall back to server-side pdf-parse only when the field is absent
      // (e.g. direct API calls that upload the actual PDF bytes).
      const text = req.body.extracted_text
        ? String(req.body.extracted_text)
        : await parsePdfText(req.file.path);
      const settings = getSettingsObject();
      const patterns = JSON.parse(settings.parsing_patterns || "[]");
      const extracted = extractTransactions(text, patterns, period);

      const insertTx = db.prepare(
        `
        INSERT INTO transactions (
          fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      );
      const checkDup = db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ? LIMIT 1"
      );

      // Cache category IDs so we don't query on every transaction
      const transferCat  = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
      const reintegroCat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();

      const runInserts = db.transaction((txList) => {
        for (const transaction of txList) {
          const dedupHash = buildDedupHash(transaction);
          if (checkDup.get(dedupHash, transaction.fecha.slice(0, 7))) {
            duplicatesSkipped += 1;
            continue;
          }

          let categoryId = null;
          const rule = findMatchingRule(db, transaction.desc_banco);
          if (rule) {
            categoryId = rule.category_id;
            bumpRule(db, rule.id);
            autoCategorized += 1;
          } else if (isLikelyTransfer(transaction.desc_banco)) {
            if (transferCat) { categoryId = transferCat.id; autoCategorized += 1; }
            else pendingReview += 1;
          } else if (isLikelyReintegro(db, transaction.desc_banco, transaction.monto, accountCurrency)) {
            if (reintegroCat) { categoryId = reintegroCat.id; autoCategorized += 1; }
            else pendingReview += 1;
          } else {
            pendingReview += 1;
          }

          insertTx.run(transaction.fecha, transaction.desc_banco, transaction.monto, accountCurrency, categoryId, account_id, uploadResult.lastInsertRowid, dedupHash);
          newTransactions += 1;
        }
      });

      runInserts(extracted.transactions);
    } else if (extension === ".csv" || extension === ".txt") {
      const text = fs.readFileSync(req.file.path, "utf-8");
      const rows = parseCsvRows(text);

      if (rows.length >= 2) {
        const headers = rows[0];
        const formatKey = formatKeyFromHeaders(headers);
        const dataRows = rows.slice(1);

        // Look up a previously saved column mapping for this header fingerprint
        const savedFormat = db.prepare("SELECT config FROM bank_formats WHERE key = ?").get(formatKey);

        if (!savedFormat) {
          // Unknown format — ask the user to map columns in the UI
          db.prepare("UPDATE uploads SET status = 'needs_mapping' WHERE id = ?").run(uploadResult.lastInsertRowid);
          return res.status(201).json({
            needs_mapping: true,
            upload_id: uploadResult.lastInsertRowid,
            format_key: formatKey,
            columns: headers,
            sample: rows.slice(0, 6),
          });
        }

        // Known format — auto-parse and insert
        const cfg = JSON.parse(savedFormat.config);
        const insertTx = db.prepare(
          "INSERT INTO transactions (fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        );
        const checkDup = db.prepare(
          "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ? LIMIT 1"
        );
        const transferCat  = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
        const reintegroCat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();

        const runCsvInserts = db.transaction((rowList) => {
          for (const row of rowList) {
            const fecha = cfg.col_fecha >= 0 ? parseCsvDate(row[cfg.col_fecha]) : null;
            if (!fecha) continue;
            const desc = cfg.col_desc >= 0 ? (row[cfg.col_desc] || "").trim() : "";
            if (!desc) continue;

            let monto = null;
            if (cfg.col_monto >= 0) {
              monto = parseCsvAmount(row[cfg.col_monto]);
            } else if (cfg.col_debit >= 0 || cfg.col_credit >= 0) {
              const d = cfg.col_debit  >= 0 ? parseCsvAmount(row[cfg.col_debit])  : null;
              const c = cfg.col_credit >= 0 ? parseCsvAmount(row[cfg.col_credit]) : null;
              if (d !== null && d !== 0) monto = d;
              else if (c !== null && c !== 0) monto = Math.abs(c);
            }
            if (monto === null) continue;

            const tx = { fecha, desc_banco: desc, monto };
            const dedupHash = buildDedupHash(tx);
            if (checkDup.get(dedupHash, fecha.slice(0, 7))) { duplicatesSkipped += 1; continue; }

            let categoryId = null;
            const rule = findMatchingRule(db, desc);
            if (rule) {
              categoryId = rule.category_id;
              bumpRule(db, rule.id);
              autoCategorized += 1;
            } else if (isLikelyTransfer(desc)) {
              if (transferCat) { categoryId = transferCat.id; autoCategorized += 1; }
              else pendingReview += 1;
            } else if (isLikelyReintegro(db, desc, monto, accountCurrency)) {
              if (reintegroCat) { categoryId = reintegroCat.id; autoCategorized += 1; }
              else pendingReview += 1;
            } else {
              pendingReview += 1;
            }

            insertTx.run(fecha, desc, monto, accountCurrency, categoryId, account_id, uploadResult.lastInsertRowid, dedupHash);
            newTransactions += 1;
          }
        });

        runCsvInserts(dataRows);
      }
    }

    db.prepare("UPDATE uploads SET tx_count = ?, status = 'processed' WHERE id = ?").run(newTransactions, uploadResult.lastInsertRowid);

    res.status(201).json({
      upload_id: uploadResult.lastInsertRowid,
      new_transactions: newTransactions,
      duplicates_skipped: duplicatesSkipped,
      auto_categorized: autoCategorized,
      pending_review: pendingReview
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

