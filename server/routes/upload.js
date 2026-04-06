const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { db, getSettingsObject } = require("../db");
const { parsePdfText } = require("../services/pdf-parser");
const { extractTransactions } = require("../services/tx-extractor");
const { buildDedupHash } = require("../services/dedup");
const { findMatchingRule, bumpRule } = require("../services/categorizer");

const router = express.Router();
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

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
    const { account_id = null, period, statement_currency } = req.body;
    if (!req.file || !period) {
      return res.status(400).json({ error: "file and period are required" });
    }

    let account = null;
    if (account_id) {
      account = db.prepare("SELECT id, currency FROM accounts WHERE id = ?").get(account_id);
      if (!account) {
        return res.status(404).json({ error: "account not found" });
      }
    }

    const normalizedCurrency = String(statement_currency || account?.currency || "UYU").toUpperCase();
    if (!["UYU", "USD", "ARS"].includes(normalizedCurrency)) {
      return res.status(400).json({ error: "statement_currency must be UYU, USD or ARS" });
    }

    if (account && account.currency !== normalizedCurrency) {
      return res.status(409).json({ error: `selected account currency (${account.currency}) does not match statement currency (${normalizedCurrency})` });
    }

    const uploadResult = db
      .prepare("INSERT INTO uploads (filename, account_id, period, status) VALUES (?, ?, ?, 'pending')")
      .run(req.file.filename, account_id, period);

    let newTransactions = 0;
    let duplicatesSkipped = 0;
    let autoCategorized = 0;
    let pendingReview = 0;
    const extension = path.extname(req.file.originalname).toLowerCase();

    if (extension === ".pdf") {
      const text = await parsePdfText(req.file.path);
      const settings = getSettingsObject();
      const patterns = JSON.parse(settings.parsing_patterns || "[]");
      const extracted = extractTransactions(text, patterns, period);
      const incomeCategory = db.prepare("SELECT id FROM categories WHERE LOWER(name) = 'ingreso' LIMIT 1").get();

      const insertTx = db.prepare(
        `
        INSERT INTO transactions (
          fecha, desc_banco, monto, moneda, category_id, account_id, upload_id, dedup_hash, entry_type, movement_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard')
      `
      );

      extracted.transactions.forEach((transaction) => {
        const dedupHash = buildDedupHash(transaction);
        const exists = db
          .prepare(
            `
            SELECT id FROM transactions
            WHERE dedup_hash = ? AND substr(fecha, 1, 7) = ?
            LIMIT 1
          `
          )
          .get(dedupHash, period);

        if (exists) {
          duplicatesSkipped += 1;
          return;
        }

        let categoryId = null;
        const entryType = transaction.monto >= 0 ? "income" : "expense";
        const rule = findMatchingRule(db, transaction.desc_banco);
        if (entryType === "income") {
          categoryId = incomeCategory?.id || null;
        } else if (rule) {
          categoryId = rule.category_id;
          bumpRule(db, rule.id);
          autoCategorized += 1;
        } else {
          pendingReview += 1;
        }

        insertTx.run(
          transaction.fecha,
          transaction.desc_banco,
          transaction.monto,
          normalizedCurrency,
          categoryId,
          account_id,
          uploadResult.lastInsertRowid,
          dedupHash,
          entryType
        );
        newTransactions += 1;
      });
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

