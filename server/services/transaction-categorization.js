const {
  bumpRule,
  findMatchingRule,
  isLikelyReintegro,
  isLikelyTransfer,
} = require("./categorizer");

function logCategorizationEvent(db, transactionId, { ruleId = null, categoryId = null, decision, origin = "unknown" }) {
  db.prepare(
    `INSERT INTO categorization_events (transaction_id, rule_id, category_id, decision, origin)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    Number(transactionId),
    ruleId != null ? Number(ruleId) : null,
    categoryId != null ? Number(categoryId) : null,
    decision,
    origin
  );
}

function markTransactionCategorized(db, transactionId, categoryId, options = {}) {
  db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = 'categorized',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ?`
  ).run(
    Number(categoryId),
    options.source || "manual",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId)
  );
}

function markTransactionSuggested(db, transactionId, options = {}) {
  db.prepare(
    `UPDATE transactions
     SET categorization_status = 'suggested',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ?`
  ).run(
    options.source || "rule_suggest",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId)
  );
}

function clearTransactionCategorization(db, transactionId) {
  db.prepare(
    `UPDATE transactions
     SET category_id = NULL,
         categorization_status = 'uncategorized',
         category_source = NULL,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ?`
  ).run(Number(transactionId));
}

function buildCategorizationRecord({ categoryId = null, status = "uncategorized", source = null, confidence = null, ruleId = null }) {
  return {
    categoryId: categoryId != null ? Number(categoryId) : null,
    categorizationStatus: status,
    categorySource: source,
    categoryConfidence: confidence,
    categoryRuleId: ruleId != null ? Number(ruleId) : null,
  };
}

function resolveTransactionClassification(db, descBanco, monto, moneda, explicitCategoryId = null) {
  if (explicitCategoryId != null) {
    return buildCategorizationRecord({
      categoryId: explicitCategoryId,
      status: "categorized",
      source: "manual",
    });
  }

  const rule = findMatchingRule(db, descBanco);
  if (rule) {
    bumpRule(db, rule.id);
    return buildCategorizationRecord({
      categoryId: rule.category_id,
      status: "categorized",
      source: "rule_auto",
      confidence: Number(rule.confidence || 0.82),
      ruleId: rule.id,
    });
  }

  if (isLikelyTransfer(descBanco)) {
    const transferCat = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
    if (transferCat) {
      return buildCategorizationRecord({
        categoryId: transferCat.id,
        status: "categorized",
        source: "transfer",
        confidence: 0.97,
      });
    }
  }

  if (isLikelyReintegro(db, descBanco, Number(monto), moneda)) {
    const reintegroCat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();
    if (reintegroCat) {
      return buildCategorizationRecord({
        categoryId: reintegroCat.id,
        status: "categorized",
        source: "refund",
        confidence: 0.9,
      });
    }
  }

  return buildCategorizationRecord({});
}

module.exports = {
  buildCategorizationRecord,
  clearTransactionCategorization,
  logCategorizationEvent,
  markTransactionCategorized,
  markTransactionSuggested,
  resolveTransactionClassification,
};
