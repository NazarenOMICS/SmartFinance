export async function logCategorizationEvent(db, userId, payload) {
  await db.prepare(
    `INSERT INTO categorization_events (user_id, transaction_id, rule_id, category_id, decision, origin)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    Number(payload.transactionId),
    payload.ruleId != null ? Number(payload.ruleId) : null,
    payload.categoryId != null ? Number(payload.categoryId) : null,
    payload.decision,
    payload.origin || "unknown"
  );
}

export async function markTransactionCategorized(db, userId, transactionId, categoryId, options = {}) {
  await db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = 'categorized',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    Number(categoryId),
    options.source || "manual",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId),
    userId
  );
}

export async function markTransactionSuggested(db, userId, transactionId, options = {}) {
  await db.prepare(
    `UPDATE transactions
     SET categorization_status = 'suggested',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    options.source || "rule",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId),
    userId
  );
}

export async function clearTransactionCategorization(db, userId, transactionId) {
  await db.prepare(
    `UPDATE transactions
     SET category_id = NULL,
         categorization_status = 'uncategorized',
         category_source = NULL,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ? AND user_id = ?`
  ).run(Number(transactionId), userId);
}
