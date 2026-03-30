import { getExchangeRateMap, getSettingsObject } from "../db.js";
import { normalizeText } from "./taxonomy.js";

const FX_KEYWORDS = [
  "supernet tc",
  "operacion tc",
  "operacion de cambio",
  "compra de dolares",
  "venta de dolares",
  "compra dolares",
  "venta dolares",
  "compra moneda extranjera",
  "venta moneda extranjera",
  "compra divisa",
  "venta divisa",
  "cambio de moneda",
  "cambio divisas",
  "compra de moneda",
  "venta de moneda",
];

const INTERNAL_TRANSFER_KEYWORDS = [
  "transferencia propia",
  "transferencia entre cuentas",
  "transferencia interna",
  "movimiento entre cuentas",
];

const STRONG_BANKING_HINTS = [
  "debito operacion en supernet",
  "credito por operacion en supernet",
  "supernet p--",
];

const CARD_PURCHASE_HINTS = [
  "compra con tarjeta",
  "compra tarjeta",
  "compra con debito",
  "compra con credito",
  "dlo.",
];

function hasAnyKeyword(descBanco, keywords) {
  const normalized = normalizeText(descBanco);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function hasCardPurchaseContext(descBanco) {
  return hasAnyKeyword(descBanco, CARD_PURCHASE_HINTS);
}

function isLikelyFxDescriptor(descBanco) {
  if (!descBanco) return false;
  if (hasCardPurchaseContext(descBanco)) return false;
  return hasAnyKeyword(descBanco, FX_KEYWORDS) || hasAnyKeyword(descBanco, STRONG_BANKING_HINTS);
}

function isLikelyInternalTransferDescriptor(descBanco) {
  if (!descBanco) return false;
  if (hasCardPurchaseContext(descBanco)) return false;
  return hasAnyKeyword(descBanco, INTERNAL_TRANSFER_KEYWORDS);
}

function buildExpectedRate(fromCurrency, toCurrency, exchangeRates) {
  if (!fromCurrency || !toCurrency || fromCurrency === toCurrency) return null;
  const fromRate = Number(exchangeRates?.[fromCurrency]);
  const toRate = Number(exchangeRates?.[toCurrency]);
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) {
    return null;
  }
  return toRate / fromRate;
}

function scoreCounterpartMatch(sourceTx, candidate, kind, exchangeRates) {
  const sourceAmount = Math.abs(Number(sourceTx.monto || 0));
  const candidateAmount = Math.abs(Number(candidate.monto || 0));
  if (!sourceAmount || !candidateAmount) return { score: 0, effectiveRate: null };

  const effectiveRate = candidateAmount / sourceAmount;
  let score = 0.4;

  const sameCurrency = String(sourceTx.moneda || "") === String(candidate.moneda || "");
  if (kind === "fx_exchange") {
    if (sameCurrency) return { score: 0, effectiveRate };
    score += 0.22;
    const expectedRate = buildExpectedRate(sourceTx.moneda, candidate.moneda, exchangeRates);
    if (expectedRate) {
      const diffRatio = Math.abs(effectiveRate - expectedRate) / expectedRate;
      if (diffRatio <= 0.04) score += 0.28;
      else if (diffRatio <= 0.1) score += 0.16;
      else if (diffRatio > 0.2) return { score: 0, effectiveRate };
    } else if (effectiveRate > 0.01) {
      score += 0.12;
    }
  } else {
    if (!sameCurrency) return { score: 0, effectiveRate };
    const amountDelta = Math.abs(candidateAmount - sourceAmount) / Math.max(sourceAmount, 1);
    if (amountDelta <= 0.02) score += 0.32;
    else if (amountDelta <= 0.06) score += 0.18;
    else return { score: 0, effectiveRate: 1 };
  }

  return { score, effectiveRate };
}

async function getAccountRow(db, userId, accountId) {
  if (!accountId) return null;
  return db.prepare(
    "SELECT id, name, currency FROM accounts WHERE id = ? AND user_id = ?"
  ).get(accountId, userId);
}

async function findBestCounterpart(db, userId, tx, kind, exchangeRates) {
  if (!tx.account_id) return null;
  const candidates = await db.prepare(
    `SELECT t.id, t.fecha, t.monto, t.moneda, t.account_id,
            io.status AS internal_status,
            a.name AS account_name, a.currency AS account_currency
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id AND a.user_id = t.user_id
     LEFT JOIN internal_operations io ON io.id = t.internal_operation_id AND io.user_id = t.user_id
     WHERE t.user_id = ?
       AND t.id != ?
       AND t.account_id IS NOT NULL
       AND t.account_id != ?
       AND (COALESCE(t.internal_operation_id, 0) = 0 OR io.status = 'incomplete')
       AND ABS(strftime('%s', t.fecha) - strftime('%s', ?)) <= 172800
       AND ((? < 0 AND t.monto > 0) OR (? > 0 AND t.monto < 0))
     ORDER BY ABS(strftime('%s', t.fecha) - strftime('%s', ?)) ASC, t.id DESC
     LIMIT 24`
  ).all(userId, Number(tx.id || 0), tx.account_id, tx.fecha, Number(tx.monto), Number(tx.monto), tx.fecha);

  let best = null;
  for (const candidate of candidates) {
    const { score, effectiveRate } = scoreCounterpartMatch(tx, candidate, kind, exchangeRates);
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { ...candidate, score, effectiveRate };
    }
  }
  return best;
}

function buildReason(kind, hasCounterpart) {
  if (kind === "fx_exchange") {
    return hasCounterpart
      ? "Detectamos una compra de moneda entre tus cuentas"
      : "Detectamos una posible compra de moneda entre tus cuentas";
  }
  return hasCounterpart
    ? "Detectamos una transferencia entre tus cuentas"
    : "Detectamos una posible transferencia entre tus cuentas";
}

export async function detectInternalOperation(db, env, tx, userId, options = {}) {
  if (!tx?.account_id || !tx?.fecha || !Number.isFinite(Number(tx?.monto))) return null;
  if (tx.id) {
    const existing = await db.prepare(
      `SELECT io.*, fa.name AS from_account_name, ta.name AS to_account_name
       FROM internal_operations io
       LEFT JOIN accounts fa ON fa.id = io.from_account_id AND fa.user_id = io.user_id
       LEFT JOIN accounts ta ON ta.id = io.to_account_id AND ta.user_id = io.user_id
       WHERE io.user_id = ?
         AND (io.source_transaction_id = ? OR io.target_transaction_id = ?)
       ORDER BY io.id DESC
       LIMIT 1`
    ).get(userId, Number(tx.id), Number(tx.id));
    if (existing && ["suggested", "incomplete", "confirmed"].includes(String(existing.status || ""))) {
      return {
        kind: existing.kind,
        status: existing.status,
        source_transaction_id: existing.source_transaction_id,
        target_transaction_id: existing.target_transaction_id,
        from_account_id: existing.from_account_id,
        to_account_id: existing.to_account_id,
        from_account_name: existing.from_account_name || null,
        to_account_name: existing.to_account_name || null,
        from_currency: existing.from_currency,
        to_currency: existing.to_currency,
        effective_rate: existing.effective_rate,
        reason: buildReason(existing.kind, Boolean(existing.target_transaction_id)),
        id: existing.id,
      };
    }
  }
  if (hasCardPurchaseContext(tx.desc_banco)) return null;

  const isFx = isLikelyFxDescriptor(tx.desc_banco);
  const isInternalTransfer = !isFx && isLikelyInternalTransferDescriptor(tx.desc_banco);
  if (!isFx && !isInternalTransfer) return null;

  const account = options.account || await getAccountRow(db, userId, tx.account_id);
  if (!account) return null;
  const settings = options.settings || await getSettingsObject(env, userId);
  const exchangeRates = getExchangeRateMap(settings);
  const kind = isFx ? "fx_exchange" : "internal_transfer";
  const counterpart = await findBestCounterpart(db, userId, tx, kind, exchangeRates);
  const hasCounterpart = Boolean(counterpart);
  const currentAmount = Number(tx.monto || 0);
  const counterpartAmount = Number(counterpart?.monto || 0);
  const sourceLeg = hasCounterpart
    ? (currentAmount < 0 ? {
      transaction_id: Number(tx.id || 0) || null,
      account_id: tx.account_id,
      account_name: account.name || null,
      currency: tx.moneda || account.currency || null,
    } : {
      transaction_id: Number(counterpart.id),
      account_id: counterpart.account_id,
      account_name: counterpart.account_name || null,
      currency: counterpart.moneda || counterpart.account_currency || null,
    })
    : {
      transaction_id: Number(tx.id || 0) || null,
      account_id: tx.account_id,
      account_name: account.name || null,
      currency: tx.moneda || account.currency || null,
    };
  const targetLeg = hasCounterpart
    ? (currentAmount > 0 ? {
      transaction_id: Number(tx.id || 0) || null,
      account_id: tx.account_id,
      account_name: account.name || null,
      currency: tx.moneda || account.currency || null,
    } : {
      transaction_id: Number(counterpart.id),
      account_id: counterpart.account_id,
      account_name: counterpart.account_name || null,
      currency: counterpart.moneda || counterpart.account_currency || null,
    })
    : null;
  const sourceAmount = hasCounterpart ? (sourceLeg.transaction_id === Number(tx.id || 0) ? currentAmount : counterpartAmount) : currentAmount;
  const targetAmount = hasCounterpart ? (targetLeg?.transaction_id === Number(tx.id || 0) ? currentAmount : counterpartAmount) : null;

  return {
    kind,
    status: hasCounterpart ? "suggested" : "incomplete",
    source_transaction_id: sourceLeg.transaction_id,
    target_transaction_id: targetLeg?.transaction_id || null,
    from_account_id: sourceLeg.account_id,
    to_account_id: targetLeg?.account_id || null,
    from_account_name: sourceLeg.account_name,
    to_account_name: targetLeg?.account_name || null,
    from_currency: sourceLeg.currency,
    to_currency: targetLeg?.currency || null,
    effective_rate: hasCounterpart && targetAmount != null
      ? Math.abs(targetAmount) / Math.max(Math.abs(sourceAmount), 1)
      : null,
    reason: buildReason(kind, hasCounterpart),
  };
}

async function attachOperationToTransactions(db, operationId, details, options = {}) {
  const sourceStatus = options.sourceCategorizationStatus || "suggested";
  const sourceCategorySource = options.sourceCategorySource || null;

  await db.prepare(
    `UPDATE transactions
     SET movement_kind = ?,
         internal_operation_id = ?,
         counterparty_account_id = ?,
         categorization_status = ?,
         category_source = ?,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ? AND user_id = ?`
  ).run(
    details.kind,
    operationId,
    details.to_account_id,
    sourceStatus,
    sourceCategorySource,
    Number(details.source_transaction_id),
    details.user_id
  );

  if (details.target_transaction_id) {
    await db.prepare(
      `UPDATE transactions
       SET movement_kind = ?,
           internal_operation_id = ?,
           counterparty_account_id = ?,
           categorization_status = ?,
           category_source = ?,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE id = ? AND user_id = ?`
    ).run(
      details.kind,
      operationId,
      details.from_account_id,
      options.targetCategorizationStatus || sourceStatus,
      options.targetCategorySource || sourceCategorySource,
      Number(details.target_transaction_id),
      details.user_id
    );
  }
}

export async function upsertInternalOperationSuggestion(db, userId, suggestion) {
  if (!suggestion?.kind || !suggestion?.source_transaction_id || !suggestion?.from_account_id) return null;

  const existing = await db.prepare(
    `SELECT io.*
     FROM internal_operations io
     LEFT JOIN transactions t ON t.internal_operation_id = io.id AND t.user_id = io.user_id
     WHERE io.user_id = ?
       AND io.source_transaction_id = ?
     ORDER BY io.id DESC
     LIMIT 1`
  ).get(userId, Number(suggestion.source_transaction_id));
  const counterpartLinkedOperation = suggestion.target_transaction_id
    ? await db.prepare(
      `SELECT io.*
       FROM internal_operations io
       LEFT JOIN transactions t ON t.internal_operation_id = io.id AND t.user_id = io.user_id
       WHERE io.user_id = ?
         AND t.id = ?
       ORDER BY io.id DESC
       LIMIT 1`
    ).get(userId, Number(suggestion.target_transaction_id))
    : null;

  const payload = {
    user_id: userId,
    kind: suggestion.kind,
    source_transaction_id: Number(suggestion.source_transaction_id),
    target_transaction_id: suggestion.target_transaction_id ? Number(suggestion.target_transaction_id) : null,
    from_account_id: suggestion.from_account_id,
    to_account_id: suggestion.to_account_id || null,
    from_currency: suggestion.from_currency || null,
    to_currency: suggestion.to_currency || null,
    effective_rate: suggestion.effective_rate ?? null,
    status: suggestion.status || "suggested",
  };

  let operationId = existing?.id || counterpartLinkedOperation?.id || null;
  if (operationId) {
    await db.prepare(
      `UPDATE internal_operations
       SET kind = ?,
           target_transaction_id = ?,
           from_account_id = ?,
           to_account_id = ?,
           from_currency = ?,
           to_currency = ?,
           effective_rate = ?,
           status = ?,
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(
      payload.kind,
      payload.target_transaction_id,
      payload.from_account_id,
      payload.to_account_id,
      payload.from_currency,
      payload.to_currency,
      payload.effective_rate,
      payload.status,
      operationId,
      userId
    );
  } else {
    const result = await db.prepare(
      `INSERT INTO internal_operations (
        user_id, kind, source_transaction_id, target_transaction_id,
        from_account_id, to_account_id, from_currency, to_currency,
        effective_rate, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).run(
      payload.user_id,
      payload.kind,
      payload.source_transaction_id,
      payload.target_transaction_id,
      payload.from_account_id,
      payload.to_account_id,
      payload.from_currency,
      payload.to_currency,
      payload.effective_rate,
      payload.status
    );
    operationId = result.lastInsertRowid;
  }

  await attachOperationToTransactions(db, operationId, payload, {
    sourceCategorizationStatus: "suggested",
    sourceCategorySource: payload.kind === "fx_exchange" ? "fx_exchange_suggest" : "internal_transfer_suggest",
    targetCategorizationStatus: payload.target_transaction_id ? "suggested" : "uncategorized",
    targetCategorySource: payload.kind === "fx_exchange" ? "fx_exchange_suggest" : "internal_transfer_suggest",
  });

  return { id: Number(operationId), ...payload };
}

export async function confirmInternalOperation(db, userId, input, options = {}) {
  const sourceTx = await db.prepare(
    "SELECT * FROM transactions WHERE id = ? AND user_id = ?"
  ).get(Number(input.source_transaction_id), userId);
  if (!sourceTx) {
    throw new Error("source transaction not found");
  }

  const targetTx = input.target_transaction_id
    ? await db.prepare("SELECT * FROM transactions WHERE id = ? AND user_id = ?").get(Number(input.target_transaction_id), userId)
    : null;
  const sourceAccount = await getAccountRow(db, userId, input.from_account_id || sourceTx.account_id);
  const targetAccount = input.to_account_id
    ? await getAccountRow(db, userId, input.to_account_id)
    : (targetTx?.account_id ? await getAccountRow(db, userId, targetTx.account_id) : null);

  const status = targetTx ? "confirmed" : "incomplete";
  const transferCategory = await db.prepare(
    "SELECT id FROM categories WHERE user_id = ? AND slug = 'transferencia' LIMIT 1"
  ).get(userId);

  const operation = await upsertInternalOperationSuggestion(db, userId, {
    kind: input.kind,
    source_transaction_id: Number(sourceTx.id),
    target_transaction_id: targetTx ? Number(targetTx.id) : null,
    from_account_id: sourceAccount?.id || sourceTx.account_id,
    to_account_id: targetAccount?.id || targetTx?.account_id || null,
    from_currency: sourceTx.moneda || sourceAccount?.currency,
    to_currency: targetTx?.moneda || targetAccount?.currency || null,
    effective_rate: input.effective_rate ?? (targetTx ? Math.abs(Number(targetTx.monto)) / Math.max(Math.abs(Number(sourceTx.monto)), 1) : null),
    status,
  });

  await db.prepare(
    `UPDATE internal_operations
     SET status = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(status, operation.id, userId);

  const categorySource = input.kind === "fx_exchange"
    ? (status === "confirmed" ? "fx_exchange" : "fx_exchange_incomplete")
    : (status === "confirmed" ? "internal_transfer" : "internal_transfer_incomplete");

  await db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         movement_kind = ?,
         internal_operation_id = ?,
         counterparty_account_id = ?,
         categorization_status = ?,
         category_source = ?,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ? AND user_id = ?`
  ).run(
    transferCategory?.id || null,
    input.kind,
    operation.id,
    operation.to_account_id,
    status === "confirmed" ? "categorized" : "suggested",
    categorySource,
    Number(sourceTx.id),
    userId
  );

  if (targetTx) {
    await db.prepare(
      `UPDATE transactions
       SET category_id = ?,
           movement_kind = ?,
           internal_operation_id = ?,
           counterparty_account_id = ?,
           categorization_status = 'categorized',
           category_source = ?,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE id = ? AND user_id = ?`
    ).run(
      transferCategory?.id || null,
      input.kind,
      operation.id,
      operation.from_account_id,
      categorySource,
      Number(targetTx.id),
      userId
    );
  }

  return operation;
}

export async function rejectInternalOperation(db, userId, sourceTransactionId) {
  const tx = await db.prepare(
    "SELECT * FROM transactions WHERE id = ? AND user_id = ?"
  ).get(Number(sourceTransactionId), userId);
  if (!tx) {
    throw new Error("transaction not found");
  }
  if (tx.internal_operation_id) {
    await db.prepare(
      `UPDATE internal_operations
       SET status = 'rejected',
           updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(Number(tx.internal_operation_id), userId);

    await db.prepare(
      `UPDATE transactions
       SET movement_kind = 'normal',
           internal_operation_id = NULL,
           counterparty_account_id = NULL,
           category_id = NULL,
           categorization_status = 'uncategorized',
           category_source = NULL,
           category_confidence = NULL,
           category_rule_id = NULL
       WHERE internal_operation_id = ? AND user_id = ?`
    ).run(Number(tx.internal_operation_id), userId);
    return Number(tx.internal_operation_id);
  }

  await db.prepare(
    `UPDATE transactions
     SET movement_kind = 'normal',
         internal_operation_id = NULL,
         counterparty_account_id = NULL,
         category_id = NULL,
         categorization_status = 'uncategorized',
         category_source = NULL,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ? AND user_id = ?`
  ).run(Number(sourceTransactionId), userId);
  return null;
}
