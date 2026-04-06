const express = require("express");
const crypto = require("crypto");
const { db } = require("../db");
const { buildDedupHash } = require("../services/dedup");
const { ensureRuleForManualCategorization, findMatchingRule, bumpRule, rejectRuleForDescription } = require("../services/categorizer");
const { computeMonthlyEvolution, computeSummary, getTransactionsForMonth } = require("../services/metrics");
const { areAccountsLinked } = require("../services/accounts");

const router = express.Router();

function requireMonth(req, res) {
  const { month } = req.query;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month is required in YYYY-MM format" });
    return null;
  }
  return month;
}

function getIncomeCategoryId() {
  return db.prepare("SELECT id FROM categories WHERE LOWER(name) = 'ingreso' LIMIT 1").get()?.id || null;
}

function normalizeEntryType(entryType, amount) {
  if (["expense", "income", "internal_transfer"].includes(entryType)) {
    return entryType;
  }

  return Number(amount) >= 0 ? "income" : "expense";
}

function fetchTransaction(id) {
  return db
    .prepare(
      `
      SELECT
        t.*,
        c.name AS category_name,
        c.type AS category_type,
        a.name AS account_name,
        lt.account_id AS linked_account_id,
        la.name AS linked_account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN transactions lt ON lt.id = t.linked_transaction_id
      LEFT JOIN accounts la ON la.id = lt.account_id
      WHERE t.id = ?
    `
    )
    .get(id);
}

function createStandardTransaction(payload) {
  const {
    fecha,
    desc_banco,
    desc_usuario = null,
    monto,
    moneda = "UYU",
    category_id = null,
    account_id = null,
    es_cuota = 0,
    installment_id = null,
    upload_id = null,
    dedup_desc_banco = desc_banco,
    movement_type = "standard",
    transfer_group_id = null,
    linked_transaction_id = null,
    entry_type: requestedEntryType = null
  } = payload;

  const entryType = normalizeEntryType(requestedEntryType, monto);
  if (entryType === "internal_transfer") {
    const error = new Error("internal transfer must be created through transfer legs");
    error.statusCode = 400;
    throw error;
  }

  let signedAmount = Number(monto);
  if (entryType === "expense") {
    signedAmount = -Math.abs(signedAmount);
  } else if (entryType === "income") {
    signedAmount = Math.abs(signedAmount);
  }

  let resolvedCategoryId = category_id;
  if (entryType === "income" && !resolvedCategoryId) {
    resolvedCategoryId = getIncomeCategoryId();
  }

  if (!resolvedCategoryId && entryType === "expense" && movement_type !== "internal_transfer") {
    const rule = findMatchingRule(db, desc_banco);
    if (rule) {
      resolvedCategoryId = rule.category_id;
      bumpRule(db, rule.id);
    }
  }

  const dedupHash = buildDedupHash({ fecha, monto: signedAmount, desc_banco: dedup_desc_banco });
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM transactions
      WHERE dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
      LIMIT 1
    `
    )
    .get(dedupHash, fecha);

  if (duplicate) {
    const error = new Error("transaction already exists for this month");
    error.statusCode = 409;
    throw error;
  }

  const result = db
    .prepare(
      `
      INSERT INTO transactions (
        fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota,
        installment_id, upload_id, dedup_hash, entry_type, movement_type, transfer_group_id, linked_transaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      fecha,
      desc_banco,
      desc_usuario,
      signedAmount,
      moneda,
      resolvedCategoryId,
      account_id,
      es_cuota ? 1 : 0,
      installment_id,
      upload_id,
      dedupHash,
      entryType,
      movement_type,
      transfer_group_id,
      linked_transaction_id
    );

  return fetchTransaction(result.lastInsertRowid);
}

function createTransferLeg(payload) {
  const {
    fecha,
    desc_banco,
    desc_usuario = null,
    monto,
    moneda,
    account_id,
    transfer_group_id,
    dedup_desc_banco,
    linked_transaction_id = null
  } = payload;

  const signedAmount = Number(monto);
  const dedupHash = buildDedupHash({ fecha, monto: signedAmount, desc_banco: dedup_desc_banco || desc_banco });
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM transactions
      WHERE dedup_hash = ? AND substr(fecha, 1, 7) = substr(?, 1, 7)
      LIMIT 1
    `
    )
    .get(dedupHash, fecha);

  if (duplicate) {
    const error = new Error("transaction already exists for this month");
    error.statusCode = 409;
    throw error;
  }

  const result = db
    .prepare(
      `
      INSERT INTO transactions (
        fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, es_cuota,
        installment_id, upload_id, dedup_hash, entry_type, movement_type, transfer_group_id, linked_transaction_id
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, NULL, NULL, ?, 'internal_transfer', 'internal_transfer', ?, ?)
    `
    )
    .run(fecha, desc_banco, desc_usuario, signedAmount, moneda, account_id, dedupHash, transfer_group_id, linked_transaction_id);

  return fetchTransaction(result.lastInsertRowid);
}

function createInternalTransfer(body) {
  const {
    fecha,
    desc_banco,
    desc_usuario = null,
    account_id,
    target_account_id,
    monto,
    target_amount,
    fee_amount = 0,
    fee_description = null
  } = body;

  if (!fecha || !account_id || !target_account_id || typeof monto !== "number") {
    const error = new Error("fecha, account_id, target_account_id and monto are required");
    error.statusCode = 400;
    throw error;
  }

  if (account_id === target_account_id) {
    const error = new Error("source and target account must be different");
    error.statusCode = 400;
    throw error;
  }

  const sourceAccount = db.prepare("SELECT * FROM accounts WHERE id = ?").get(account_id);
  const targetAccount = db.prepare("SELECT * FROM accounts WHERE id = ?").get(target_account_id);
  if (!sourceAccount || !targetAccount) {
    const error = new Error("linked account not found");
    error.statusCode = 404;
    throw error;
  }

  if (!areAccountsLinked(db, account_id, target_account_id, "fx_pair")) {
    const error = new Error("accounts must be linked before creating an internal transfer");
    error.statusCode = 409;
    throw error;
  }

  const transferGroupId = crypto.randomUUID();
  const sourceAmount = Math.abs(Number(monto));
  const destinationAmount = Math.abs(Number(target_amount ?? monto));
  const baseDescription = desc_banco || "Transferencia interna";

  return db.transaction(() => {
    const sourceTransaction = createTransferLeg({
      fecha,
      desc_banco: baseDescription,
      desc_usuario,
      monto: -sourceAmount,
      moneda: sourceAccount.currency,
      account_id,
      transfer_group_id: transferGroupId,
      dedup_desc_banco: `${baseDescription}|${transferGroupId}|out`
    });

    const targetTransaction = createTransferLeg({
      fecha,
      desc_banco: baseDescription,
      desc_usuario,
      monto: destinationAmount,
      moneda: targetAccount.currency,
      account_id: target_account_id,
      transfer_group_id: transferGroupId,
      dedup_desc_banco: `${baseDescription}|${transferGroupId}|in`
    });

    db.prepare("UPDATE transactions SET linked_transaction_id = ? WHERE id = ?").run(targetTransaction.id, sourceTransaction.id);
    db.prepare("UPDATE transactions SET linked_transaction_id = ? WHERE id = ?").run(sourceTransaction.id, targetTransaction.id);

    let feeTransaction = null;
    if (Number(fee_amount || 0) > 0) {
      feeTransaction = createStandardTransaction({
        fecha,
        desc_banco: fee_description || `${baseDescription} - comisión`,
        monto: Number(fee_amount),
        moneda: sourceAccount.currency,
        account_id,
        entry_type: "expense",
        movement_type: "standard",
        transfer_group_id: transferGroupId,
        dedup_desc_banco: `${baseDescription}|${transferGroupId}|fee`
      });
    }

    return {
      transactions: [fetchTransaction(sourceTransaction.id), fetchTransaction(targetTransaction.id)],
      fee_transaction: feeTransaction ? fetchTransaction(feeTransaction.id) : null
    };
  })();
}

router.get("/pending", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const rows = getTransactionsForMonth(
    db,
    month,
    "AND t.category_id IS NULL AND COALESCE(t.movement_type, 'standard') != 'internal_transfer' AND COALESCE(t.entry_type, CASE WHEN t.monto >= 0 THEN 'income' ELSE 'expense' END) != 'income'"
  );
  res.json(rows);
});

router.get("/summary", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  res.json(computeSummary(db, month));
});

router.get("/monthly-evolution", (req, res) => {
  const months = Math.max(1, Number(req.query.months || 6));
  const end = req.query.end;

  if (!end || !/^\d{4}-\d{2}$/.test(end)) {
    return res.status(400).json({ error: "end is required in YYYY-MM format" });
  }

  res.json(computeMonthlyEvolution(db, end, months));
});

router.get("/", (req, res) => {
  const month = requireMonth(req, res);
  if (!month) return;

  const filters = [];
  const params = [];

  if (req.query.account_id) {
    filters.push("AND t.account_id = ?");
    params.push(req.query.account_id);
  }

  if (req.query.category_id) {
    filters.push("AND t.category_id = ?");
    params.push(Number(req.query.category_id));
  }

  const rows = getTransactionsForMonth(db, month, filters.join(" "), params);
  res.json(rows);
});

router.post("/", (req, res) => {
  try {
    const entryType = normalizeEntryType(req.body.entry_type, req.body.monto);
    if (entryType === "internal_transfer") {
      return res.status(201).json(createInternalTransfer(req.body));
    }

    const { fecha, desc_banco, monto } = req.body;
    if (!fecha || !desc_banco || typeof monto !== "number") {
      return res.status(400).json({ error: "fecha, desc_banco and monto are required" });
    }

    const transaction = createStandardTransaction({
      ...req.body,
      entry_type: entryType
    });

    res.status(201).json({ transactions: [transaction] });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM transactions WHERE id = ?").get(id);

  if (!current) {
    return res.status(404).json({ error: "transaction not found" });
  }

  const next = {
    category_id: req.body.category_id ?? current.category_id,
    desc_usuario: req.body.desc_usuario ?? current.desc_usuario,
    account_id: req.body.account_id ?? current.account_id
  };

  db.prepare("UPDATE transactions SET category_id = ?, desc_usuario = ?, account_id = ? WHERE id = ?").run(
    next.category_id,
    next.desc_usuario,
    next.account_id,
    id
  );

  let ruleStatus = null;
  let rejectedRule = null;
  if (
    req.body.category_id &&
    req.body.category_id !== current.category_id &&
    (current.movement_type || "standard") !== "internal_transfer"
  ) {
    const matchingRule = findMatchingRule(db, current.desc_banco);
    if (matchingRule && matchingRule.category_id !== Number(req.body.category_id)) {
      rejectedRule = rejectRuleForDescription(db, matchingRule.id, current.desc_banco);
    }
    ruleStatus = ensureRuleForManualCategorization(db, current.desc_banco, req.body.category_id);
  }

  res.json({ transaction: fetchTransaction(id), rule: ruleStatus, rejected_rule: rejectedRule });
});

module.exports = router;
