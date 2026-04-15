const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const { db, getSettingsObject, isValidMonthString } = require("../db");
const { parsePdfText } = require("../services/pdf-parser");
const { extractTransactions } = require("../services/tx-extractor");
const { buildDedupHash } = require("../services/dedup");
const {
  buildTransactionReviewSuggestion,
  resolveTransactionClassification,
} = require("../services/transaction-categorization");
const { extractMerchantKey } = require("../services/categorizer");
const { extractTransactionsFromOcrWithOllama } = require("../services/ocr-import");
const {
  createReviewGroupTracker,
  ensureSmartCategoriesForTransactions,
  listGuidedReviewGroups,
  listReviewGroups,
  matchSmartCategoryTemplate,
  trackReviewGroup,
} = require("../services/smart-categories");
const { normalizePatternValue } = require("../services/taxonomy");
const { detectFormat, applyColumnMap } = require("../services/format-detector");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "..", "uploads");
const SUPPORTED_IMPORT_EXTENSIONS = new Set([".pdf", ".csv", ".txt", ".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".webp"]);
const OCR_IMPORT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function resolveUploadClassification(descBanco, monto, moneda) {
  const classification = resolveTransactionClassification(db, descBanco, monto, moneda);
  return {
    ...classification,
    autoCategorized: classification.categorizationStatus === "categorized",
  };
}

function buildImportCategorizationMeta(descBanco) {
  const merchantKey = extractMerchantKey(descBanco);
  return {
    merchantKey,
    parseQuality: merchantKey ? "clean" : "partial",
  };
}

function logImportCategorization(transactionId, classification) {
  const layer = classification.categoryRuleId
    ? (classification.categorySource === "rule_auto" ? "merchant_exact" : "pattern_substring")
    : (classification.categoryId ? "heuristic" : "fallback");
  db.prepare(
    `INSERT INTO rule_match_log (transaction_id, rule_id, category_id, layer, confidence, reason)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    Number(transactionId),
    classification.categoryRuleId ?? null,
    classification.categoryId ?? null,
    layer,
    classification.categoryConfidence ?? null,
    classification.categoryRuleId
      ? `Import categorized by ${classification.categorySource || "rule"}`
      : "Import did not find an auto-applicable rule"
  );
}

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

function normalizeSheetCell(value) {
  if (value == null) return "";
  return String(value).trim();
}

function trimEmptySpreadsheetColumns(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const keepIndexes = [];
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex++) {
    const hasContent = rows.some((row) => String(row[columnIndex] || "").trim());
    if (hasContent) keepIndexes.push(columnIndex);
  }
  return rows.map((row) => keepIndexes.map((columnIndex) => row[columnIndex] ?? ""));
}

function findSpreadsheetHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const normalized = (rows[i] || []).map((cell) => normH(cell));
    const hasFecha = normalized.some((value) => value === "fecha" || value === "date");
    const hasAmount = normalized.some((value) =>
      /dbito|debito|credito|crdito|monto|importe|amount|valor|caja de ahorro|cuenta corriente|saldo/.test(value)
    );
    if (hasFecha && hasAmount) return i;
  }
  return rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
}

function readSpreadsheetRows(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false, cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    return rows.some((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()));
  });
  if (!sheetName) return null;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
    .map((row) => (Array.isArray(row) ? row.map(normalizeSheetCell) : []))
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  if (rows.length === 0) return null;

  const headerIdx = findSpreadsheetHeaderRow(rows);
  if (headerIdx < 0 || headerIdx >= rows.length) return null;

  return trimEmptySpreadsheetColumns(rows.slice(headerIdx));
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
  const raw = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isValidISODate(raw) ? raw : null;
  }
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

function isValidPeriod(value) {
  return isValidMonthString(value);
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

function parseBankFormatConfig(rawConfig) {
  try {
    return JSON.parse(rawConfig);
  } catch (_) {
    return null;
  }
}

function cleanupUploadedFile(filePath) {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {
    // Best effort cleanup only.
  }
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_MIMETYPES = new Set([
  "text/csv",
  "text/plain",
  "application/pdf",
  "application/octet-stream", // some browsers send this for .csv
]);

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, callback) => {
    // Use only the sanitized extension from the original name — never the full
    // original name — to prevent path traversal via crafted filenames.
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, "") || ".bin";
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB hard cap
  fileFilter: (_req, file, callback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
      return callback(new Error("unsupported file type"));
    }
    callback(null, true);
  }
});

router.get("/", (req, res) => {
  const params = [];
  let where = "";

  if (req.query.period) {
    if (!isValidPeriod(req.query.period)) {
      return res.status(400).json({ error: "period must be in YYYY-MM format" });
    }
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
  let uploadId = null;
  try {
    const account_id = String(req.body.account_id || "").trim();
    const period = req.body.period;
    if (!req.file || !period || !account_id) {
      cleanupUploadedFile(req.file?.path);
      return res.status(400).json({ error: "file, period and account_id are required" });
    }
    if (!isValidPeriod(period)) {
      cleanupUploadedFile(req.file.path);
      return res.status(400).json({ error: "period must be in YYYY-MM format" });
    }
    const accountRow = account_id
      ? db.prepare("SELECT currency FROM accounts WHERE id = ?").get(account_id)
      : null;
    if (account_id && !accountRow) {
      cleanupUploadedFile(req.file.path);
      return res.status(404).json({ error: "account not found" });
    }
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(extension)) {
      cleanupUploadedFile(req.file.path);
      return res.status(400).json({ error: "unsupported file type" });
    }
    if ((extension === ".pdf" || OCR_IMPORT_EXTENSIONS.has(extension)) && !req.body.extracted_text) {
      cleanupUploadedFile(req.file.path);
      return res.status(400).json({ error: "image and pdf uploads require extracted_text" });
    }

    const existingTransactions = db.prepare("SELECT COUNT(*) AS count FROM transactions").get();
    const hadTransactionsBeforeUpload = Number(existingTransactions?.count || 0) > 0;
    const settings = getSettingsObject();
    const guidedOnboardingDone = String(settings.guided_categorization_onboarding_completed || "0") === "1";
    const guidedOnboardingSkipped = String(settings.guided_categorization_onboarding_skipped || "0") === "1";
    const disabledPatterns = db.prepare(
      `SELECT normalized_pattern, category_id
       FROM rules
       WHERE mode = 'disabled'
         AND normalized_pattern IS NOT NULL
         AND normalized_pattern != ''`
    ).all();
    const skippedPatternKeys = new Set(
      disabledPatterns.map((row) => `${Number(row.category_id)}:${normalizePatternValue(row.normalized_pattern)}`)
    );

    let account = null;
    if (account_id) {
      account = db.prepare("SELECT id, currency FROM accounts WHERE id = ?").get(account_id);
      if (!account) {
        return res.status(404).json({ error: "account not found" });
      }
    }

    const normalizedCurrency = String(req.body.statement_currency || account?.currency || "UYU").toUpperCase();
    if (!["UYU", "USD", "ARS"].includes(normalizedCurrency)) {
      return res.status(400).json({ error: "statement_currency must be UYU, USD or ARS" });
    }

    if (account && account.currency !== normalizedCurrency) {
      return res.status(409).json({ error: `selected account currency (${account.currency}) does not match statement currency (${normalizedCurrency})` });
    }

    const uploadResult = db
      .prepare("INSERT INTO uploads (filename, account_id, period, status) VALUES (?, ?, ?, 'pending')")
      .run(req.file.filename, account_id, period);
    uploadId = uploadResult.lastInsertRowid;

    let newTransactions = 0;
    let duplicatesSkipped = 0;
    let autoCategorized = 0;
    let pendingReview = 0;
    const reviewGroups = createReviewGroupTracker();
    const transactionReviewQueue = [];

    // Resolve the account's currency so PDF transactions are stored correctly.
    // Falls back to UYU if account not found (shouldn't happen in normal flow).
    const accountCurrency = accountRow?.currency || "UYU";

    if (extension === ".xlsx" || extension === ".xls") {
      const rows = readSpreadsheetRows(req.file.path);
      if (!rows || rows.length < 2) {
        cleanupUploadedFile(req.file.path);
        db.prepare("UPDATE uploads SET status='error' WHERE id = ?").run(uploadId);
        return res.status(400).json({ error: "Excel file is empty or malformed" });
      }

      const headers = rows[0];
      const formatKey = formatKeyFromHeaders(headers);

      let savedFormat = null;
      try {
        savedFormat = db.prepare("SELECT * FROM bank_formats WHERE format_key = ?").get(formatKey);
      } catch (_) {
        savedFormat = null;
      }

      let columns = null;
      if (savedFormat) {
        columns = {
          fecha: savedFormat.col_fecha,
          desc: savedFormat.col_desc,
          debit: savedFormat.col_debit,
          credit: savedFormat.col_credit,
          monto: savedFormat.col_monto,
        };
      }

      if (!columns) {
        const detected = detectFormat(headers);
        if (detected) columns = detected.columns;
      }

      if (!columns || columns.fecha < 0) {
        cleanupUploadedFile(req.file.path);
        db.prepare("UPDATE uploads SET status='needs_mapping' WHERE id = ?").run(uploadId);
        return res.status(200).json({
          upload_id: uploadId,
          needs_mapping: true,
          format_key: formatKey,
          columns: headers,
          sample: rows.slice(0, 6),
          new_transactions: 0,
          duplicates_skipped: 0,
          auto_categorized: 0,
          pending_review: 0,
        });
      }

      const { transactions } = applyColumnMap(rows.slice(1), columns, period);
      ensureSmartCategoriesForTransactions(db, transactions);
      const categories = db.prepare(
        "SELECT id, name, slug, type, color FROM categories ORDER BY sort_order ASC, id ASC"
      ).all();
      const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

      const insertTx = db.prepare(
        `
        INSERT INTO transactions (
          fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash,
          categorization_status, category_source, category_confidence, category_rule_id,
          merchant_key, parse_quality
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );
      const checkDup = db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ? LIMIT 1"
      );

      const runInserts = db.transaction((txList) => {
        for (const transaction of txList) {
          if (!isValidISODate(transaction.fecha) || !Number.isFinite(Number(transaction.monto))) continue;
          const dedupHash = buildDedupHash(transaction);
          if (checkDup.get(dedupHash, transaction.fecha.slice(0, 7))) {
            duplicatesSkipped += 1;
            continue;
          }

          const classification = resolveUploadClassification(
            transaction.desc_banco,
            Number(transaction.monto),
            accountCurrency
          );
          const importMeta = buildImportCategorizationMeta(transaction.desc_banco);
          if (classification.autoCategorized) autoCategorized += 1;
          else pendingReview += 1;

          const insertResult = insertTx.run(
            transaction.fecha,
            transaction.desc_banco,
            Number(transaction.monto),
            accountCurrency,
            classification.categoryId,
            account_id,
            uploadId,
            dedupHash,
            classification.categorizationStatus,
            classification.categorySource,
            classification.categoryConfidence,
            classification.categoryRuleId,
            importMeta.merchantKey,
            importMeta.parseQuality
          );
          newTransactions += 1;
          logImportCategorization(insertResult.lastInsertRowid, classification);

          if (!classification.categoryId) {
            const smartMatch = matchSmartCategoryTemplate(transaction.desc_banco);
            if (smartMatch) {
              const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
              if (smartCategory) {
                trackReviewGroup(reviewGroups, transaction, smartMatch, smartCategory.id, insertResult.lastInsertRowid, {
                  skipPatterns: skippedPatternKeys,
                });
              }
            }
          }

          const reviewItem = buildTransactionReviewSuggestion(db, transaction, categories, {
            accountId: account_id,
            transactionId: insertResult.lastInsertRowid,
            settings,
          });
          if (reviewItem) {
            transactionReviewQueue.push(reviewItem);
          }
        }
      });

      runInserts(transactions);
    } else if (extension === ".pdf" || extension === ".txt" || OCR_IMPORT_EXTENSIONS.has(extension)) {
      // The browser client (PDF.js) extracts text client-side and sends it as
      // the `extracted_text` form field to avoid a round-trip server PDF parse.
      // Fall back to server-side pdf-parse only when the field is absent
      // (e.g. direct API calls that upload the actual PDF bytes).
      const text = extension === ".txt"
        ? fs.readFileSync(req.file.path, "utf-8")
        : req.body.extracted_text
          ? String(req.body.extracted_text)
          : await parsePdfText(req.file.path);
      const patterns = JSON.parse(settings.parsing_patterns || "[]");
      const extracted = extractTransactions(text, patterns, period);
      let extractedTransactions = extracted.transactions;
      if (extractedTransactions.length === 0 && OCR_IMPORT_EXTENSIONS.has(extension)) {
        const ocrResult = await extractTransactionsFromOcrWithOllama(settings, {
          text,
          period,
          moneda: accountCurrency,
        });
        extractedTransactions = ocrResult.transactions || [];
      }
      if (extractedTransactions.length === 0) {
        cleanupUploadedFile(req.file.path);
        db.prepare("UPDATE uploads SET status='error' WHERE id = ?").run(uploadId);
        return res.status(422).json({
          error: "No transactions could be extracted from this upload",
          code: "parse_failed",
          parse_quality: "failed",
        });
      }
      ensureSmartCategoriesForTransactions(db, extractedTransactions);
      const categories = db.prepare(
        "SELECT id, name, slug, type, color FROM categories ORDER BY sort_order ASC, id ASC"
      ).all();
      const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

      const insertTx = db.prepare(
        `
        INSERT INTO transactions (
          fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash,
          categorization_status, category_source, category_confidence, category_rule_id,
          merchant_key, parse_quality
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      );
      const checkDup = db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ? LIMIT 1"
      );

      const runInserts = db.transaction((txList) => {
        for (const transaction of txList) {
          if (!isValidISODate(transaction.fecha) || !Number.isFinite(Number(transaction.monto))) continue;
          const dedupHash = buildDedupHash(transaction);
          if (checkDup.get(dedupHash, transaction.fecha.slice(0, 7))) {
            duplicatesSkipped += 1;
            continue;
          }

          const classification = resolveUploadClassification(transaction.desc_banco, transaction.monto, accountCurrency);
          const importMeta = buildImportCategorizationMeta(transaction.desc_banco);
          if (classification.autoCategorized) autoCategorized += 1;
          else pendingReview += 1;

          const insertResult = insertTx.run(
            transaction.fecha,
            transaction.desc_banco,
            transaction.monto,
            accountCurrency,
            classification.categoryId,
            account_id,
            uploadResult.lastInsertRowid,
            dedupHash,
            classification.categorizationStatus,
            classification.categorySource,
            classification.categoryConfidence,
            classification.categoryRuleId,
            importMeta.merchantKey,
            importMeta.parseQuality
          );
          const insertedId = insertResult.lastInsertRowid;
          logImportCategorization(insertedId, classification);
          if (!classification.categoryId) {
            const smartMatch = matchSmartCategoryTemplate(transaction.desc_banco);
            if (smartMatch) {
              const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
              if (smartCategory) {
                trackReviewGroup(reviewGroups, transaction, smartMatch, smartCategory.id, insertedId, {
                  skipPatterns: skippedPatternKeys,
                });
              }
            }
          }
          const reviewItem = buildTransactionReviewSuggestion(db, {
            id: insertedId,
            fecha: transaction.fecha,
            desc_banco: transaction.desc_banco,
            monto: transaction.monto,
            moneda: accountCurrency,
          }, { categories, classification });
          if (reviewItem) {
            transactionReviewQueue.push(reviewItem);
          }
          newTransactions += 1;
        }
      });

      runInserts(extractedTransactions);
    } else if (extension === ".csv") {
      const text = fs.readFileSync(req.file.path, "utf-8");
      const rows = parseCsvRows(text);
      if (rows.length < 2 || rows[0].length < 2) {
        db.prepare("UPDATE uploads SET status = 'error' WHERE id = ?").run(uploadId);
        return res.status(400).json({ error: "CSV file is empty or malformed" });
      }

      if (rows.length >= 2) {
        const headers = rows[0];
        const formatKey = formatKeyFromHeaders(headers);
        const dataRows = rows.slice(1);

        // Look up a previously saved column mapping for this header fingerprint
        const savedFormat = db.prepare("SELECT config FROM bank_formats WHERE key = ?").get(formatKey);
        let columns = null;

        if (savedFormat) {
          const savedColumns = parseBankFormatConfig(savedFormat.config);
          if (savedColumns) {
            columns = {
              fecha: savedColumns.col_fecha,
              desc: savedColumns.col_desc,
              debit: savedColumns.col_debit,
              credit: savedColumns.col_credit,
              monto: savedColumns.col_monto,
            };
          }
        } else {
          const detected = detectFormat(headers);
          if (detected) columns = detected.columns;
        }

        if (!columns || columns.fecha < 0) {
          db.prepare("UPDATE uploads SET status = 'needs_mapping' WHERE id = ?").run(uploadResult.lastInsertRowid);
          return res.status(201).json({
            needs_mapping: true,
            upload_id: uploadResult.lastInsertRowid,
            format_key: formatKey,
            columns: headers,
            sample: rows.slice(0, 6),
          });
        }
        const { transactions: csvTransactions, unmatched } = applyColumnMap(dataRows, columns, period);
        if (csvTransactions.length === 0) {
          db.prepare("UPDATE uploads SET status = 'error' WHERE id = ?").run(uploadResult.lastInsertRowid);
          return res.status(422).json({
            error: "No transactions could be extracted from this upload",
            code: "parse_failed",
            parse_quality: "failed",
            unmatched_rows: unmatched.length,
          });
        }
        const insertTx = db.prepare(
          `INSERT INTO transactions (
             fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash,
             categorization_status, category_source, category_confidence, category_rule_id,
             merchant_key, parse_quality
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const checkDup = db.prepare(
          "SELECT id FROM transactions WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ? LIMIT 1"
        );
        ensureSmartCategoriesForTransactions(db, []);
        const categories = db.prepare(
          "SELECT id, name, slug, type, color FROM categories ORDER BY sort_order ASC, id ASC"
        ).all();
        const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

        const runCsvInserts = db.transaction((rowList) => {
          for (const tx of rowList) {
            const { fecha, desc_banco: desc, monto } = tx;
            const dedupHash = buildDedupHash(tx);
            if (checkDup.get(dedupHash, fecha.slice(0, 7))) { duplicatesSkipped += 1; continue; }

            const classification = resolveUploadClassification(desc, monto, accountCurrency);
            const importMeta = buildImportCategorizationMeta(desc);
            if (classification.autoCategorized) autoCategorized += 1;
            else pendingReview += 1;

            const insertResult = insertTx.run(
              fecha,
              desc,
              monto,
              accountCurrency,
              classification.categoryId,
              account_id,
              uploadResult.lastInsertRowid,
              dedupHash,
              classification.categorizationStatus,
              classification.categorySource,
              classification.categoryConfidence,
              classification.categoryRuleId,
              importMeta.merchantKey,
              importMeta.parseQuality
            );
            const insertedId = insertResult.lastInsertRowid;
            logImportCategorization(insertedId, classification);
            if (!classification.categoryId) {
              const smartMatch = matchSmartCategoryTemplate(desc);
              if (smartMatch) {
                const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
                if (smartCategory) {
                  trackReviewGroup(reviewGroups, tx, smartMatch, smartCategory.id, insertedId, {
                    skipPatterns: skippedPatternKeys,
                  });
                }
              }
            }
            const reviewItem = buildTransactionReviewSuggestion(db, {
              id: insertedId,
              fecha,
              desc_banco: desc,
              monto,
              moneda: accountCurrency,
            }, { categories, classification });
            if (reviewItem) {
              transactionReviewQueue.push(reviewItem);
            }
            newTransactions += 1;
          }
        });

        runCsvInserts(csvTransactions);
      }
    }

    db.prepare("UPDATE uploads SET tx_count = ?, status = 'processed' WHERE id = ?").run(newTransactions, uploadResult.lastInsertRowid);
    const guidedReviewGroups = listGuidedReviewGroups(reviewGroups, 6);
    const guidedOnboardingRequired = (
      !hadTransactionsBeforeUpload &&
      newTransactions > 0 &&
      !guidedOnboardingDone &&
      !guidedOnboardingSkipped &&
      guidedReviewGroups.length > 0
    );

    cleanupUploadedFile(req.file?.path);
    res.status(201).json({
      upload_id: uploadResult.lastInsertRowid,
      new_transactions: newTransactions,
      duplicates_skipped: duplicatesSkipped,
      auto_categorized: autoCategorized,
      pending_review: pendingReview,
      review_groups: listReviewGroups(reviewGroups),
      transaction_review_queue: transactionReviewQueue,
      guided_review_groups: guidedReviewGroups,
      guided_onboarding_required: guidedOnboardingRequired,
      guided_onboarding_session: guidedOnboardingRequired ? { max_cards: guidedReviewGroups.length } : null,
    });
  } catch (error) {
    if (uploadId != null) {
      db.prepare("UPDATE uploads SET status = 'error' WHERE id = ?").run(uploadId);
    }
    cleanupUploadedFile(req.file?.path);
    next(error);
  }
});

router.post("/:id/retry-categorize", (req, res) => {
  const id = Number(req.params.id);
  const upload = db.prepare("SELECT id FROM uploads WHERE id = ?").get(id);
  if (!upload) return res.status(404).json({ error: "upload not found" });

  const rows = db.prepare("SELECT * FROM transactions WHERE upload_id = ? ORDER BY id ASC").all(id);
  let autoCategorized = 0;
  let pendingReview = 0;

  const updateTx = db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = ?,
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?,
         merchant_key = ?,
         parse_quality = ?,
         rule_skipped_reason = ?
     WHERE id = ?`
  );

  db.transaction(() => {
    for (const tx of rows) {
      const classification = resolveUploadClassification(tx.desc_banco, Number(tx.monto), tx.moneda);
      const importMeta = buildImportCategorizationMeta(tx.desc_banco);
      if (classification.autoCategorized) autoCategorized += 1;
      else pendingReview += 1;
      updateTx.run(
        classification.categoryId,
        classification.categorizationStatus,
        classification.categorySource,
        classification.categoryConfidence,
        classification.categoryRuleId,
        importMeta.merchantKey,
        importMeta.parseQuality,
        importMeta.merchantKey ? null : "generic_or_empty_merchant",
        tx.id
      );
      logImportCategorization(tx.id, classification);
    }
    db.prepare(
      `UPDATE uploads
       SET tx_count = ?,
           status = CASE WHEN ? = 0 THEN 'error' ELSE 'processed' END
       WHERE id = ?`
    ).run(rows.length, rows.length, id);
  })();

  res.json({
    upload_id: id,
    processed: rows.length,
    auto_categorized: autoCategorized,
    pending_review: pendingReview,
    parse_quality: rows.length > 0 ? "clean" : "failed",
  });
});

module.exports = router;
