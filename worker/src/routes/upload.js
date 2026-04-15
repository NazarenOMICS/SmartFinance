import { Hono } from "hono";
import { getDb, getSettingsObject, isValidMonthString } from "../db.js";
import { buildDedupHash } from "../services/dedup.js";
import { buildMerchantKey, buildTransactionReviewSuggestion, bumpRule, classifyTransaction } from "../services/categorizer.js";
import { extractTransactions } from "../services/tx-extractor.js";
import { extractTransactionsFromOcrWithOllama } from "../services/ocr-import.js";
import { parseCSV } from "../services/csv-parser.js";
import { detectFormat, computeFormatKey, applyColumnMap } from "../services/format-detector.js";
import {
  createReviewGroupTracker,
  ensureSmartCategoriesForTransactions,
  listGuidedReviewGroups,
  listReviewGroups,
  matchSmartCategoryTemplate,
  trackReviewGroup,
} from "../services/smart-categories.js";
import { normalizePatternValue } from "../services/taxonomy.js";

const router = new Hono();
const SUPPORTED_IMPORT_EXTENSIONS = new Set(["csv", "pdf", "txt", "png", "jpg", "jpeg", "webp"]);
const OCR_IMPORT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function buildImportCategorizationMeta(descBanco) {
  const merchantKey = buildMerchantKey(descBanco);
  return {
    merchantKey,
    parseQuality: merchantKey ? "clean" : "partial",
  };
}

async function logImportCategorization(db, userId, transactionId, classification, categoryId) {
  const ruleId = classification.category_rule_id ?? classification.rule?.id ?? null;
  const layer = ruleId
    ? (classification.category_source === "rule_auto" ? "merchant_exact" : "pattern_substring")
    : (categoryId ? "heuristic" : "fallback");
  await db.prepare(
    `INSERT INTO rule_match_log (user_id, transaction_id, rule_id, category_id, layer, confidence, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    Number(transactionId),
    ruleId,
    categoryId ?? classification.categoryId ?? null,
    layer,
    classification.category_confidence ?? null,
    ruleId ? `Import categorized by ${classification.category_source || "rule"}` : "Import did not find an auto-applicable rule"
  );
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

function splitLine(line, delimiter = ",") {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\"") {
      if (inQuotes && line[i + 1] === "\"") {
        current += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function normalizeHeader(header) {
  return String(header || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\ufffd/g, "")
    .trim();
}

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === "\"") {
      inQuotes = !inQuotes;
    } else if (!inQuotes && counts[ch] !== undefined) {
      counts[ch] += 1;
    }
  }
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0][0];
}

function findHeader(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const delimiter = detectDelimiter(lines[i]);
    const fields = splitLine(lines[i], delimiter);
    const normalized = fields.map(normalizeHeader);
    if (normalized.some((value) => value === "fecha" || value === "date") && fields.length >= 3) {
      return { headerIdx: i, lines, headers: fields, normHeaders: normalized, delimiter };
    }
  }

  const headerIdx = lines.findIndex((line) => line.trim());
  if (headerIdx === -1) return null;
  const delimiter = detectDelimiter(lines[headerIdx]);
  const headers = splitLine(lines[headerIdx], delimiter);
  return { headerIdx, lines, headers, normHeaders: headers.map(normalizeHeader), delimiter };
}

router.get("/", async (c) => {
  const db = getDb(c.env);
  const userId = c.get("userId");
  const period = c.req.query("period");
  if (period && !isValidMonthString(period)) {
    return c.json({ error: "period must be in YYYY-MM format" }, 400);
  }
  const sql = period
    ? `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id AND a.user_id=u.user_id WHERE u.period=? AND u.user_id=? ORDER BY u.created_at DESC`
    : `SELECT u.*,a.name AS account_name FROM uploads u LEFT JOIN accounts a ON a.id=u.account_id AND a.user_id=u.user_id WHERE u.user_id=? ORDER BY u.created_at DESC`;
  const rows = period
    ? await db.prepare(sql).all(period, userId)
    : await db.prepare(sql).all(userId);
  return c.json(rows);
});

router.post("/", async (c) => {
  let uploadId = null;
  const userId = c.get("userId");
  const db = getDb(c.env);

  try {
    const formData = await c.req.formData();
    const account_id = formData.get("account_id") || null;
    const period = formData.get("period");
    const extracted_text = formData.get("extracted_text") || null;
    const file = formData.get("file");

    if (!isValidMonthString(period)) {
      return c.json({ error: "period is required in YYYY-MM format" }, 400);
    }
    if (!account_id) {
      return c.json({ error: "account_id is required" }, 400);
    }
    if (!file && !extracted_text) {
      return c.json({ error: "file or extracted_text is required" }, 400);
    }

    const filename = file ? file.name : `manual-${period}.txt`;
    const ext = (filename.split(".").pop() || "").toLowerCase();
    if (!SUPPORTED_IMPORT_EXTENSIONS.has(ext)) {
      return c.json({ error: "unsupported file type" }, 400);
    }
    if ((ext === "pdf" || OCR_IMPORT_EXTENSIONS.has(ext)) && !extracted_text) {
      return c.json({ error: "image and pdf uploads require extracted_text" }, 400);
    }

    const account = await db.prepare("SELECT currency FROM accounts WHERE id=? AND user_id=?").get(account_id, userId);
    if (!account) {
      return c.json({ error: "account not found" }, 404);
    }
    const accountCurrency = account.currency;

    const existingTransactions = await db.prepare(
      "SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?"
    ).get(userId);
    const hadTransactionsBeforeUpload = Number(existingTransactions?.count || 0) > 0;

    const uploadResult = await db.prepare(
      "INSERT INTO uploads (filename,account_id,period,status,user_id) VALUES (?,?,?,'pending',?)"
    ).run(filename, account_id, period, userId);
    uploadId = uploadResult.lastInsertRowid;

    if (file && c.env.UPLOADS) {
      const buffer = await file.arrayBuffer();
      await c.env.UPLOADS.put(`${uploadId}-${filename}`, buffer, {
        httpMetadata: { contentType: file.type },
      });
    }

    let extractedTxs = [];
    let newTransactions = 0;
    let duplicatesSkipped = 0;
    let autoCategorized = 0;
    let pendingReview = 0;
    const reviewGroups = createReviewGroupTracker();
    const transactionReviewQueue = [];

    if (ext === "csv") {
      const csvText = await file.text();
      const { transactions: parsed } = parseCSV(csvText);

      if (parsed.length > 0) {
        extractedTxs = parsed;
      } else {
        const found = findHeader(csvText);
        if (!found) {
          await db.prepare("UPDATE uploads SET status='error' WHERE id=? AND user_id=?").run(uploadId, userId);
          return c.json({ error: "CSV file is empty or malformed" }, 400);
        }

        const { headers, headerIdx, lines, delimiter } = found;
        const formatKey = computeFormatKey(headers);

        let savedFormat = null;
        try {
          savedFormat = await db.prepare(
            "SELECT * FROM bank_formats WHERE user_id = ? AND format_key = ?"
          ).get(userId, formatKey);
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
        } else {
          const detected = detectFormat(headers);
          if (detected) {
            columns = detected.columns;
          }
        }

        if (!columns || columns.fecha < 0) {
          await db.prepare("UPDATE uploads SET status='needs_mapping' WHERE id=? AND user_id=?").run(uploadId, userId);
          return c.json({
            upload_id: uploadId,
            needs_mapping: true,
            format_key: formatKey,
            columns: headers,
            sample: lines.slice(headerIdx, headerIdx + 6).map((line) => splitLine(line, delimiter)),
            new_transactions: 0,
            duplicates_skipped: 0,
            auto_categorized: 0,
            pending_review: 0,
          }, 200);
        }

        const dataRows = lines
          .slice(headerIdx + 1)
          .filter((line) => line.trim())
          .map((line) => splitLine(line, delimiter));
        const { transactions } = applyColumnMap(dataRows, columns, period);
        extractedTxs = transactions;
      }
    } else {
      let textToParse = extracted_text;
      if (!textToParse && file && ext === "txt") {
        textToParse = await file.text();
      }
      if (textToParse) {
        const settings = await getSettingsObject(c.env, userId);
        let patterns = [];
        try {
          patterns = JSON.parse(settings.parsing_patterns || "[]");
        } catch (_) {
          patterns = [];
        }
        const { transactions } = extractTransactions(textToParse, patterns, period);
        extractedTxs = transactions;
        if (extractedTxs.length === 0 && OCR_IMPORT_EXTENSIONS.has(ext)) {
          const ocrResult = await extractTransactionsFromOcrWithOllama(settings, {
            text: textToParse,
            period,
            moneda: accountCurrency,
          });
          extractedTxs = ocrResult.transactions || [];
        }
      }
    }

    if (extractedTxs.length === 0) {
      await db.prepare("UPDATE uploads SET status='error' WHERE id=? AND user_id=?").run(uploadId, userId);
      return c.json({
        error: "No transactions could be extracted from this upload",
        code: "parse_failed",
        parse_quality: "failed",
      }, 422);
    }

    const settings = await getSettingsObject(c.env, userId);
    const guidedOnboardingDone = String(settings.guided_categorization_onboarding_completed || "0") === "1";
    const guidedOnboardingSkipped = String(settings.guided_categorization_onboarding_skipped || "0") === "1";
    const disabledPatterns = await db.prepare(
      `SELECT normalized_pattern, category_id
       FROM rules
       WHERE user_id = ?
         AND mode = 'disabled'
         AND normalized_pattern IS NOT NULL
         AND normalized_pattern != ''`
    ).all(userId);
    const skippedPatternKeys = new Set(
      disabledPatterns.map((row) => `${Number(row.category_id)}:${normalizePatternValue(row.normalized_pattern)}`)
    );

    await ensureSmartCategoriesForTransactions(db, userId, extractedTxs);
    const categories = await db.prepare(
      "SELECT id, name, type, color FROM categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
    ).all(userId);
    const categoryByName = new Map(categories.map((category) => [category.name.toLowerCase(), category]));

    for (const tx of extractedTxs) {
      if (!isValidISODate(tx.fecha) || !Number.isFinite(Number(tx.monto))) {
        continue;
      }

      const normalizedDescBanco = String(tx.desc_banco || "").trim();
      if (!normalizedDescBanco) {
        continue;
      }

      const normalizedTx = {
        fecha: tx.fecha,
        desc_banco: normalizedDescBanco,
        monto: Number(tx.monto),
      };
      const dedupHash = await buildDedupHash(normalizedTx);
      const exists = await db.prepare(
        "SELECT id FROM transactions WHERE dedup_hash=? AND user_id=? AND substr(fecha,1,7)=? LIMIT 1"
      ).get(dedupHash, userId, tx.fecha.slice(0, 7));
      if (exists) {
        duplicatesSkipped++;
        continue;
      }

      let categoryId = null;
      let categorizationStatus = "uncategorized";
      let categorySource = null;
      let categoryConfidence = null;
      let categoryRuleId = null;
      const classification = await classifyTransaction(db, c.env, {
        desc_banco: normalizedDescBanco,
        monto: normalizedTx.monto,
        moneda: accountCurrency,
        account_id,
      }, userId, {
        settings,
        categories,
      });
      categorizationStatus = classification.categorization_status;
      categorySource = classification.category_source;
      categoryConfidence = classification.category_confidence;
      categoryRuleId = classification.category_rule_id;
      if (classification.action === "auto" && classification.categoryId) {
        categoryId = classification.categoryId;
        autoCategorized++;
        if (classification.rule?.id) {
          await bumpRule(db, classification.rule.id, userId);
        }
      } else {
        pendingReview++;
      }
      const importMeta = buildImportCategorizationMeta(normalizedDescBanco);

      const insertResult = await db.prepare(
        `INSERT INTO transactions (
          fecha,desc_banco,monto,moneda,category_id,account_id,upload_id,dedup_hash,user_id,
          categorization_status,category_source,category_confidence,category_rule_id,merchant_key,parse_quality,rule_skipped_reason
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        normalizedTx.fecha,
        normalizedTx.desc_banco,
        normalizedTx.monto,
        accountCurrency,
        categoryId,
        account_id,
        uploadId,
        dedupHash,
        userId,
        categorizationStatus,
        categorySource,
        categoryConfidence,
        categoryRuleId,
        importMeta.merchantKey,
        importMeta.parseQuality,
        importMeta.merchantKey ? null : "generic_or_empty_merchant"
      );
      await logImportCategorization(db, userId, insertResult.lastInsertRowid, classification, categoryId);
      if (!categoryId) {
        const smartMatch = matchSmartCategoryTemplate(normalizedDescBanco);
        if (smartMatch) {
          const smartCategory = categoryByName.get(smartMatch.template.name.toLowerCase());
          if (smartCategory) {
            trackReviewGroup(reviewGroups, normalizedTx, smartMatch, smartCategory.id, insertResult.lastInsertRowid, {
              skipPatterns: skippedPatternKeys,
            });
          }
        }
      }
      const reviewItem = await buildTransactionReviewSuggestion(db, c.env, {
        id: insertResult.lastInsertRowid,
        fecha: normalizedTx.fecha,
        desc_banco: normalizedTx.desc_banco,
        monto: normalizedTx.monto,
        moneda: accountCurrency,
        account_id,
      }, userId, { settings, categories, classification });
      if (reviewItem) {
        transactionReviewQueue.push(reviewItem);
      }
      newTransactions++;
    }

    await db.prepare("UPDATE uploads SET tx_count=?,status='processed' WHERE id=? AND user_id=?")
      .run(newTransactions, uploadId, userId);

    const guidedReviewGroups = listGuidedReviewGroups(reviewGroups, 6);
    const guidedOnboardingRequired = (
      !hadTransactionsBeforeUpload &&
      newTransactions > 0 &&
      !guidedOnboardingDone &&
      !guidedOnboardingSkipped &&
      guidedReviewGroups.length > 0
    );

    return c.json({
      upload_id: uploadId,
      new_transactions: newTransactions,
      duplicates_skipped: duplicatesSkipped,
      auto_categorized: autoCategorized,
      pending_review: pendingReview,
      review_groups: listReviewGroups(reviewGroups),
      transaction_review_queue: transactionReviewQueue,
      guided_review_groups: guidedReviewGroups,
      guided_onboarding_required: guidedOnboardingRequired,
      guided_onboarding_session: guidedOnboardingRequired
        ? { max_cards: guidedReviewGroups.length }
        : null,
    }, 201);
  } catch (error) {
    if (uploadId != null) {
      await db.prepare("UPDATE uploads SET status='error' WHERE id=? AND user_id=?").run(uploadId, userId);
    }
    const status = typeof error?.status === "number" ? error.status : 500;
    if (status >= 500) {
      console.error(error);
    }
    return c.json({ error: error?.message || "Unexpected server error" }, status);
  }
});

router.post("/:id/retry-categorize", async (c) => {
  const userId = c.get("userId");
  const db = getDb(c.env);
  const uploadId = Number(c.req.param("id"));
  const upload = await db.prepare("SELECT id FROM uploads WHERE id=? AND user_id=?").get(uploadId, userId);
  if (!upload) return c.json({ error: "upload not found" }, 404);

  const rows = await db.prepare(
    "SELECT * FROM transactions WHERE upload_id=? AND user_id=? ORDER BY id ASC"
  ).all(uploadId, userId);
  const settings = await getSettingsObject(c.env, userId);
  const categories = await db.prepare(
    "SELECT id, name, type, color FROM categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC"
  ).all(userId);
  let autoCategorized = 0;
  let pendingReview = 0;

  for (const tx of rows) {
    const classification = await classifyTransaction(db, c.env, {
      desc_banco: tx.desc_banco,
      monto: Number(tx.monto),
      moneda: tx.moneda,
      account_id: tx.account_id,
    }, userId, { settings, categories });
    const categoryId = classification.action === "auto" && classification.categoryId ? classification.categoryId : null;
    if (categoryId) autoCategorized++;
    else pendingReview++;
    const importMeta = buildImportCategorizationMeta(tx.desc_banco);
    await db.prepare(
      `UPDATE transactions
       SET category_id=?,
           categorization_status=?,
           category_source=?,
           category_confidence=?,
           category_rule_id=?,
           merchant_key=?,
           parse_quality=?,
           rule_skipped_reason=?
       WHERE id=? AND user_id=?`
    ).run(
      categoryId,
      classification.categorization_status,
      classification.category_source,
      classification.category_confidence,
      classification.category_rule_id,
      importMeta.merchantKey,
      importMeta.parseQuality,
      importMeta.merchantKey ? null : "generic_or_empty_merchant",
      tx.id,
      userId
    );
    await logImportCategorization(db, userId, tx.id, classification, categoryId);
  }

  await db.prepare(
    "UPDATE uploads SET tx_count=?,status=? WHERE id=? AND user_id=?"
  ).run(rows.length, rows.length > 0 ? "processed" : "error", uploadId, userId);

  return c.json({
    upload_id: uploadId,
    processed: rows.length,
    auto_categorized: autoCategorized,
    pending_review: pendingReview,
    parse_quality: rows.length > 0 ? "clean" : "failed",
  });
});

export default router;
