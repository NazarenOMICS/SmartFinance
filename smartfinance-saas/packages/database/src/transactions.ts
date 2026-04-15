import type { CreateTransactionInput, UpdateTransactionInput } from "@smartfinance/contracts";
import { deriveRulePattern } from "@smartfinance/domain";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { filterTransactionsForMetricFlows, getPreferredCurrencyByLinkId, markTransactionsForMetricFlows } from "./metrics";
import { classifyTransactionByRules, findAmountProfileCategoryMatch, findMatchingRule, getRuleById, incrementRuleMatchCount, rejectAmountProfileForTransaction, rejectRuleForDescription, syncAmountProfileFromCategorizedDescription, syncRuleFromCategorizedDescription } from "./rules";
import { getSettingsObject } from "./settings";

function toPeriod(fecha: string) {
  return fecha.slice(0, 7);
}

function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildDedupHash(input: { fecha: string; monto: number; desc_banco: string }) {
  const normalized = `${input.fecha}|${input.monto}|${input.desc_banco.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return `tx_${Math.abs(hash)}`;
}

const TRANSACTION_SELECT = `
  SELECT
    transactions.id,
    transactions.period,
    transactions.fecha,
    transactions.desc_banco,
    transactions.desc_usuario,
    transactions.monto,
    transactions.moneda,
    transactions.category_id,
    transactions.account_id,
    transactions.entry_type,
    transactions.movement_kind,
    transactions.categorization_status,
    transactions.category_source,
    transactions.category_confidence,
    transactions.category_rule_id,
    transactions.created_at,
    transactions.paired_transaction_id,
    transactions.account_link_id,
    transactions.internal_group_id,
    categories.name AS category_name,
    categories.type AS category_type,
    categories.color AS category_color,
    accounts.name AS account_name,
    CASE WHEN installments.id IS NULL THEN 0 ELSE 1 END AS es_cuota,
    installments.id AS installment_id
  FROM transactions
  LEFT JOIN categories
    ON categories.user_id = transactions.user_id
   AND categories.id = transactions.category_id
  LEFT JOIN accounts
    ON accounts.user_id = transactions.user_id
   AND accounts.id = transactions.account_id
  LEFT JOIN installments
    ON installments.user_id = transactions.user_id
   AND installments.id = transactions.installment_id
`;

type TransactionRecord = {
  id: number;
  period: string;
  fecha: string;
  desc_banco: string;
  desc_usuario: string | null;
  monto: number;
  moneda: string;
  category_id: number | null;
  account_id: string | null;
  entry_type: string;
  movement_kind: string;
  categorization_status: string;
  category_source: string | null;
  category_confidence: number | null;
  category_rule_id: number | null;
  created_at: string;
  paired_transaction_id: number | null;
  account_link_id: number | null;
  internal_group_id: string | null;
  category_name: string | null;
  category_type: string | null;
  category_color: string | null;
  account_name: string | null;
  es_cuota: number;
  installment_id: number | null;
  counts_in_metrics?: boolean;
};

export class AccountCurrencyMismatchError extends Error {
  code = "ACCOUNT_CURRENCY_MISMATCH" as const;

  constructor(accountCurrency: string, transactionCurrency: string, accountId?: string | null) {
    super(
      `La cuenta seleccionada${accountId ? ` (${accountId})` : ""} es ${accountCurrency}, pero el movimiento es ${transactionCurrency}. Elegi la cuenta correcta o usa la moneda de esa cuenta.`,
    );
    this.name = "AccountCurrencyMismatchError";
  }
}

export class TransactionAccountNotFoundError extends Error {
  code = "ACCOUNT_NOT_FOUND" as const;

  constructor(accountId: string) {
    super(`La cuenta seleccionada (${accountId}) no existe.`);
    this.name = "TransactionAccountNotFoundError";
  }
}

async function assertAccountCurrencyMatchesTransaction(
  db: D1DatabaseLike,
  userId: string,
  accountId: string | null | undefined,
  transactionCurrency: string | null | undefined,
) {
  if (!accountId || !transactionCurrency) return;
  const account = await firstRow<{ currency: string }>(
    db,
    "SELECT currency FROM accounts WHERE user_id = ? AND id = ? LIMIT 1",
    [userId, accountId],
  );
  if (!account) {
    throw new TransactionAccountNotFoundError(accountId);
  }
  if (String(account.currency).toUpperCase() !== String(transactionCurrency).toUpperCase()) {
    throw new AccountCurrencyMismatchError(account.currency, String(transactionCurrency).toUpperCase(), accountId);
  }
}

async function learnAmountProfileFromTransactionRecord(
  db: D1DatabaseLike,
  userId: string,
  transaction: Record<string, unknown> | null | undefined,
) {
  if (!transaction?.category_id || String(transaction.movement_kind || "normal") !== "normal") return;
  await syncAmountProfileFromCategorizedDescription(db, userId, {
    descBanco: String(transaction.desc_banco || ""),
    amount: Number(transaction.monto || 0),
    categoryId: Number(transaction.category_id),
    accountId: transaction.account_id == null ? null : String(transaction.account_id),
    currency: String(transaction.moneda || "UYU") as "UYU" | "USD" | "EUR" | "ARS",
    direction: Number(transaction.monto || 0) >= 0 ? "income" : "expense",
  });
}

function normalizeReviewPattern(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSuggestionReason(transaction: Record<string, unknown>) {
  if (transaction.category_source === "amount_profile") {
    return `Sugerido por historial de monto para "${transaction.category_name || "esta categoria"}".`;
  }
  if (transaction.category_name) {
    return `Sugerido por el motor para "${transaction.category_name}".`;
  }
  return "Todavia no hay suficiente contexto para aprender esta transaccion.";
}

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
  "debito operacion en supernet",
  "credito por operacion en supernet",
];

const CARD_PURCHASE_HINTS = [
  "compra con tarjeta",
  "compra tarjeta",
  "compra con debito",
  "compra con credito",
  "dlo.",
];

function normalizeFreeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyKeyword(value: string, keywords: string[]) {
  const normalized = normalizeFreeText(value);
  return keywords.some((keyword) => normalized.includes(normalizeFreeText(keyword)));
}

function looksLikeFxDescription(value: string) {
  const normalized = normalizeFreeText(value);
  if (hasAnyKeyword(normalized, CARD_PURCHASE_HINTS)) return false;
  return hasAnyKeyword(normalized, FX_KEYWORDS);
}

function looksLikeInternalTransferDescription(value: string) {
  const normalized = normalizeFreeText(value);
  if (hasAnyKeyword(normalized, CARD_PURCHASE_HINTS)) return false;
  return hasAnyKeyword(normalized, INTERNAL_TRANSFER_KEYWORDS);
}

function dayDistance(left: string, right: string) {
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Math.abs((leftDate.getTime() - rightDate.getTime()) / (24 * 60 * 60 * 1000));
}

function normalizedAmount(value: number) {
  return Number(Math.abs(value).toFixed(2));
}

async function findSuggestedCounterpart(
  db: D1DatabaseLike,
  userId: string,
  transaction: Record<string, unknown>,
  linked: {
    id: number;
    account_a_id: string;
    account_b_id: string;
    preferred_currency: string | null;
    account_a_name: string | null;
    account_b_name: string | null;
    account_a_currency: string | null;
    account_b_currency: string | null;
  } | null,
) {
  if (!linked || !transaction.account_id || !transaction.fecha || !Number.isFinite(Number(transaction.monto || 0))) {
    return null;
  }

  const isAccountA = linked.account_a_id === transaction.account_id;
  const counterpartAccountId = isAccountA ? linked.account_b_id : linked.account_a_id;
  const currentCurrency = isAccountA ? linked.account_a_currency : linked.account_b_currency;
  const counterpartCurrency = isAccountA ? linked.account_b_currency : linked.account_a_currency;
  const kind = currentCurrency && counterpartCurrency && currentCurrency !== counterpartCurrency
    ? "fx_exchange"
    : "internal_transfer";

  const candidates = await allRows<{
    id: number;
    fecha: string;
    monto: number;
    moneda: string;
    account_id: string | null;
    account_name: string | null;
  }>(
    db,
    `
      SELECT
        transactions.id,
        transactions.fecha,
        transactions.monto,
        transactions.moneda,
        transactions.account_id,
        accounts.name AS account_name
      FROM transactions
      LEFT JOIN accounts
        ON accounts.user_id = transactions.user_id
       AND accounts.id = transactions.account_id
      WHERE transactions.user_id = ?
        AND transactions.account_id = ?
        AND transactions.id != ?
        AND ABS(julianday(transactions.fecha) - julianday(?)) <= 2
        AND ((? < 0 AND transactions.monto > 0) OR (? > 0 AND transactions.monto < 0))
        AND transactions.movement_kind = 'normal'
      ORDER BY ABS(julianday(transactions.fecha) - julianday(?)) ASC, transactions.id DESC
      LIMIT 24
    `,
    [
      userId,
      counterpartAccountId,
      Number(transaction.id || 0),
      String(transaction.fecha),
      Number(transaction.monto),
      Number(transaction.monto),
      String(transaction.fecha),
    ],
  );

  let best: (typeof candidates)[number] | null = null;
  let bestScore = 0;
  let bestRate: number | null = null;

  for (const candidate of candidates) {
    let score = 0.4;
    const sourceAmount = normalizedAmount(Number(transaction.monto));
    const candidateAmount = normalizedAmount(Number(candidate.monto));
    const sameCurrency = String(candidate.moneda) === String(currentCurrency || transaction.moneda || "");
    const effectiveRate = sourceAmount > 0 ? candidateAmount / sourceAmount : null;

    if (kind === "fx_exchange") {
      if (sameCurrency) continue;
      score += 0.22;
      if (linked.preferred_currency && linked.preferred_currency === candidate.moneda) {
        score += 0.12;
      }
      if (effectiveRate && effectiveRate > 0.01 && effectiveRate < 200) {
        score += 0.14;
      }
    } else {
      if (!sameCurrency) continue;
      const delta = Math.abs(candidateAmount - sourceAmount) / Math.max(sourceAmount, 1);
      if (delta <= 0.02) score += 0.32;
      else if (delta <= 0.06) score += 0.16;
      else continue;
    }

    const distancePenalty = Math.min(dayDistance(String(transaction.fecha), String(candidate.fecha)) * 0.08, 0.16);
    score -= distancePenalty;

    if (score > bestScore) {
      best = candidate;
      bestScore = score;
      bestRate = effectiveRate;
    }
  }

  if (!best || bestScore < 0.45) {
    return {
      kind,
      counterpart: null,
      effectiveRate: null,
    };
  }

  return {
    kind,
    counterpart: best,
    effectiveRate: bestRate,
  };
}

export async function listTransactionsByMonth(db: D1DatabaseLike, userId: string, month: string) {
  const [rows, preferredCurrencyByLinkId] = await Promise.all([
    allRows<TransactionRecord>(
      db,
      `
        ${TRANSACTION_SELECT}
        WHERE transactions.user_id = ? AND transactions.period = ?
        ORDER BY transactions.fecha DESC, transactions.id DESC
      `,
      [userId, month],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);
  return markTransactionsForMetricFlows(rows, preferredCurrencyByLinkId);
}

export async function listPendingTransactionsByMonth(db: D1DatabaseLike, userId: string, month: string) {
  const [rows, preferredCurrencyByLinkId] = await Promise.all([
    allRows<TransactionRecord>(
      db,
      `
        ${TRANSACTION_SELECT}
        WHERE transactions.user_id = ? AND transactions.period = ? AND transactions.categorization_status != 'categorized'
        ORDER BY transactions.fecha DESC, transactions.id DESC
      `,
      [userId, month],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);
  return markTransactionsForMetricFlows(rows, preferredCurrencyByLinkId);
}

export async function getTransactionById(db: D1DatabaseLike, userId: string, transactionId: number) {
  const [row, preferredCurrencyByLinkId] = await Promise.all([
    firstRow<TransactionRecord>(
      db,
      `
        ${TRANSACTION_SELECT}
        WHERE transactions.user_id = ? AND transactions.id = ?
        LIMIT 1
      `,
      [userId, transactionId],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);
  return row ? markTransactionsForMetricFlows([row], preferredCurrencyByLinkId)[0] : null;
}

export async function getTransactionsByIds(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  if (transactionIds.length === 0) return [];
  const placeholders = transactionIds.map(() => "?").join(", ");
  const [rows, preferredCurrencyByLinkId] = await Promise.all([
    allRows<TransactionRecord>(
      db,
      `
        ${TRANSACTION_SELECT}
        WHERE transactions.user_id = ? AND transactions.id IN (${placeholders})
        ORDER BY transactions.fecha DESC, transactions.id DESC
      `,
      [userId, ...transactionIds],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);
  return markTransactionsForMetricFlows(rows, preferredCurrencyByLinkId);
}

async function enrichTransactionForReview(db: D1DatabaseLike, userId: string, transaction: Record<string, unknown>) {
  const linked = await firstRow<{
    id: number;
    account_a_id: string;
    account_b_id: string;
    preferred_currency: string | null;
    account_a_name: string | null;
    account_b_name: string | null;
    account_a_currency: string | null;
    account_b_currency: string | null;
  }>(
    db,
    `
      SELECT
        links.id,
        links.account_a_id,
        links.account_b_id,
        links.preferred_currency,
        account_a.name AS account_a_name,
        account_b.name AS account_b_name,
        account_a.currency AS account_a_currency,
        account_b.currency AS account_b_currency
      FROM account_links links
      LEFT JOIN accounts account_a
        ON account_a.user_id = links.user_id
       AND account_a.id = links.account_a_id
      LEFT JOIN accounts account_b
        ON account_b.user_id = links.user_id
       AND account_b.id = links.account_b_id
      WHERE links.user_id = ?
        AND (links.account_a_id = ? OR links.account_b_id = ?)
      ORDER BY links.created_at DESC, links.id DESC
      LIMIT 1
    `,
    [userId, String(transaction.account_id || ""), String(transaction.account_id || "")],
  );

  const isAccountA = linked?.account_a_id === transaction.account_id;
  const counterpartAccountId = linked ? (isAccountA ? linked.account_b_id : linked.account_a_id) : null;
  const counterpartName = linked ? (isAccountA ? linked.account_b_name : linked.account_a_name) : null;
  const counterpartCurrency = linked ? (isAccountA ? linked.account_b_currency : linked.account_a_currency) : null;
  const currentCurrency = linked ? (isAccountA ? linked.account_a_currency : linked.account_b_currency) : transaction.moneda;
  const inferredKind = looksLikeFxDescription(String(transaction.desc_banco || ""))
    ? "fx_exchange"
    : looksLikeInternalTransferDescription(String(transaction.desc_banco || ""))
      ? "internal_transfer"
      : null;
  const counterpartSuggestion = await findSuggestedCounterpart(db, userId, transaction, linked);
  const amountProfileSuggestion = await findAmountProfileCategoryMatch(db, userId, {
    descBanco: String(transaction.desc_banco || ""),
    amount: Number(transaction.monto || 0),
    currency: String(transaction.moneda || "UYU"),
    accountId: transaction.account_id == null ? null : String(transaction.account_id),
    direction: Number(transaction.monto || 0) >= 0 ? "income" : "expense",
  });
  const internalOperationKind = counterpartSuggestion?.kind || inferredKind || null;
  const suggestionSource = transaction.category_source || (transaction.category_id ? "rule_suggest" : "manual_review");
  const amountProfileMatchesCategory = amountProfileSuggestion?.profile
    && transaction.category_id != null
    && Number(amountProfileSuggestion.profile.category_id) === Number(transaction.category_id);
  const suggestionReason = amountProfileMatchesCategory
    ? `Parece ${transaction.category_name || "esta categoria"}: ${amountProfileSuggestion.profile.counterparty_key} con monto similar a ${amountProfileSuggestion.profile.sample_count} pago(s) anteriores, mediana ${Math.round(Number(amountProfileSuggestion.profile.amount_median || 0))} ${amountProfileSuggestion.profile.currency}.`
    : internalOperationKind
    ? internalOperationKind === "fx_exchange"
      ? "Detectamos una posible compra o venta de moneda entre tus cuentas."
      : "Detectamos una posible transferencia entre tus cuentas."
    : buildSuggestionReason(transaction);

  return {
    ...transaction,
    suggested_category_id: transaction.category_id ?? null,
    suggested_category_name: transaction.category_name ?? null,
    suggestion_source: suggestionSource,
    suggestion_reason: suggestionReason,
    amount_profile_id: amountProfileMatchesCategory ? amountProfileSuggestion.profile.id : null,
    counterparty_key: amountProfileSuggestion?.profile?.counterparty_key ?? null,
    amount_similarity: amountProfileMatchesCategory ? amountProfileSuggestion.similarity : null,
    historical_median: amountProfileMatchesCategory ? amountProfileSuggestion.profile.amount_median : null,
    historical_sample_count: amountProfileMatchesCategory ? amountProfileSuggestion.profile.sample_count : null,
    conflict_candidates: amountProfileSuggestion?.conflictCandidates ?? [],
    ai_audited: false,
    ai_reason: null,
    internal_operation_kind: internalOperationKind,
    internal_operation_target_transaction_id: counterpartSuggestion?.counterpart ? Number(counterpartSuggestion.counterpart.id) : null,
    internal_operation_from_account_id: transaction.account_id ?? null,
    internal_operation_from_account_name: transaction.account_name ?? null,
    internal_operation_from_currency: currentCurrency ?? transaction.moneda ?? null,
    internal_operation_to_account_id: counterpartSuggestion?.counterpart?.account_id ?? counterpartAccountId,
    internal_operation_to_account_name: counterpartSuggestion?.counterpart?.account_name ?? counterpartName,
    internal_operation_to_currency: counterpartSuggestion?.counterpart?.moneda ?? counterpartCurrency,
    internal_operation_effective_rate: counterpartSuggestion?.effectiveRate ?? null,
  };
}

export async function acceptSuggestedTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;
  if (current.category_id == null) return current;

  await runStatement(
    db,
    `
      UPDATE transactions
      SET categorization_status = 'categorized',
          category_source = CASE
            WHEN category_source = 'rule_suggest' THEN 'rule_confirmed'
            ELSE category_source
          END
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  if (current.category_rule_id != null) {
    await incrementRuleMatchCount(db, userId, Number(current.category_rule_id));
  }

  const updated = await getTransactionById(db, userId, transactionId);
  await learnAmountProfileFromTransactionRecord(db, userId, updated);
  return updated;
}

export async function rejectSuggestedTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  if (current.category_rule_id != null) {
    await rejectRuleForDescription(db, userId, Number(current.category_rule_id), String(current.desc_banco));
  }
  if (current.category_source === "amount_profile") {
    await rejectAmountProfileForTransaction(db, userId, {
      descBanco: String(current.desc_banco),
      amount: Number(current.monto),
      currency: String(current.moneda),
      accountId: current.account_id == null ? null : String(current.account_id),
      direction: Number(current.monto) >= 0 ? "income" : "expense",
    });
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET category_id = NULL,
          categorization_status = 'uncategorized',
          category_source = NULL,
          category_confidence = NULL,
          category_rule_id = NULL
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function acceptSuggestedTransactions(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await acceptSuggestedTransaction(db, userId, transactionId);
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function rejectSuggestedTransactions(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await rejectSuggestedTransaction(db, userId, transactionId);
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function assignCategoryToTransactions(
  db: D1DatabaseLike,
  userId: string,
  transactionIds: number[],
  categoryId: number,
) {
  const processed = [];

  for (const transactionId of transactionIds) {
    const transaction = await updateTransaction(db, userId, transactionId, { category_id: categoryId });
    if (transaction) processed.push(transaction);
  }

  return processed;
}

export async function createTransaction(
  db: D1DatabaseLike,
  userId: string,
  input: CreateTransactionInput,
  options: { uploadId?: number } = {},
) {
  const signedAmount = input.entry_type === "expense" ? -Math.abs(input.monto) : Math.abs(input.monto);
  const period = toPeriod(input.fecha);
  await assertAccountCurrencyMatchesTransaction(db, userId, input.account_id, input.moneda);
  const classificationEntryType = input.entry_type === "internal_transfer" ? "expense" : input.entry_type;
  const classification = await classifyTransactionByRules(db, userId, {
    descBanco: input.desc_banco,
    amount: signedAmount,
    currency: input.moneda,
    accountId: input.account_id ?? null,
    entryType: classificationEntryType,
    categoryId: input.category_id ?? null,
  });
  const dedupHash = buildDedupHash({
    fecha: input.fecha,
    monto: signedAmount,
    desc_banco: input.desc_banco,
  });
  const duplicate = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM transactions
      WHERE user_id = ? AND period = ? AND dedup_hash = ?
      LIMIT 1
    `,
    [userId, period, dedupHash],
  );
  if (duplicate) {
    throw new Error("transaction already exists for this month");
  }

  await runStatement(
    db,
    `
      INSERT INTO transactions
      (
        user_id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
        categorization_status, category_source, category_confidence, category_rule_id, dedup_hash, upload_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      period,
      input.fecha,
      input.desc_banco,
      input.desc_usuario ?? null,
      signedAmount,
      input.moneda,
      classification.categoryId,
      input.account_id ?? null,
      input.entry_type,
      classification.categorizationStatus,
      classification.categorySource,
      classification.categoryConfidence,
      classification.categoryRuleId,
      dedupHash,
      options.uploadId ?? null,
    ],
  );

  const created = await firstRow<{ id: number }>(
    db,
    "SELECT id FROM transactions WHERE user_id = ? AND period = ? AND dedup_hash = ? LIMIT 1",
    [userId, period, dedupHash],
  );

  if (classification.matchedRule?.id) {
    await incrementRuleMatchCount(db, userId, classification.matchedRule.id);
  }

  const createdTransaction = await getTransactionById(db, userId, Number(created?.id || 0));
  if (input.category_id != null && createdTransaction) {
    await learnAmountProfileFromTransactionRecord(db, userId, createdTransaction);
  }

  return createdTransaction;
}

export async function updateTransaction(db: D1DatabaseLike, userId: string, transactionId: number, input: UpdateTransactionInput) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  const nextFecha = input.fecha ?? String(current.fecha);
  const nextMonto = input.monto ?? Number(current.monto);
  const nextAccountId = input.account_id === undefined ? current.account_id : input.account_id;
  await assertAccountCurrencyMatchesTransaction(db, userId, nextAccountId, String(current.moneda));
  const dedupHash = buildDedupHash({
    fecha: nextFecha,
    monto: nextMonto,
    desc_banco: String(current.desc_banco),
  });
  const duplicate = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM transactions
      WHERE user_id = ? AND id != ? AND period = ? AND dedup_hash = ?
      LIMIT 1
    `,
    [userId, transactionId, toPeriod(nextFecha), dedupHash],
  );
  if (duplicate) {
    throw new Error("transaction already exists for this month");
  }

  let nextCategoryId = input.category_id === undefined ? current.category_id : input.category_id;
  let nextStatus = current.categorization_status;
  let nextSource = current.category_source;
  let nextConfidence = current.category_confidence;
  let nextRuleId = current.category_rule_id;

  if (input.category_id !== undefined) {
    if (input.category_id === null) {
      nextCategoryId = null;
      nextStatus = String(current.movement_kind) === "normal" ? "uncategorized" : "categorized";
      nextSource = String(current.movement_kind) === "normal" ? null : "movement_kind";
      nextConfidence = null;
      nextRuleId = null;
    } else {
      nextCategoryId = input.category_id;
      nextStatus = "categorized";
      nextSource = "manual";
      nextConfidence = null;
      nextRuleId = null;
    }
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET desc_usuario = ?,
          category_id = ?,
          account_id = ?,
          fecha = ?,
          period = ?,
          monto = ?,
          dedup_hash = ?,
          categorization_status = ?,
          category_source = ?,
          category_confidence = ?,
          category_rule_id = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.desc_usuario === undefined ? current.desc_usuario : input.desc_usuario,
      nextCategoryId,
      nextAccountId,
      nextFecha,
      toPeriod(nextFecha),
      nextMonto,
      dedupHash,
      nextStatus,
      nextSource,
      nextConfidence,
      nextRuleId,
      userId,
      transactionId,
    ],
  );

  const updated = await getTransactionById(db, userId, transactionId);
  if (input.category_id !== undefined && input.category_id !== null && updated) {
    await learnAmountProfileFromTransactionRecord(db, userId, updated);
  }

  return updated;
}

export async function deleteTransaction(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) {
    return { deleted: false };
  }

  if (current.paired_transaction_id != null) {
    await runStatement(
      db,
      `
        UPDATE transactions
        SET paired_transaction_id = NULL,
            internal_group_id = NULL,
            account_link_id = NULL,
            movement_kind = 'normal',
            categorization_status = CASE WHEN category_id IS NULL THEN 'uncategorized' ELSE 'categorized' END,
            category_source = CASE WHEN category_id IS NULL THEN NULL ELSE category_source END
        WHERE user_id = ? AND id = ?
      `,
      [userId, Number(current.paired_transaction_id)],
    );
  }

  await runStatement(
    db,
    "DELETE FROM transactions WHERE user_id = ? AND id = ?",
    [userId, transactionId],
  );

  return { deleted: true, transaction: current };
}

export async function getTransactionSummary(db: D1DatabaseLike, userId: string, month: string) {
  const [settings, transactions, previousTransactions, categories, preferredCurrencyByLinkId] = await Promise.all([
    getSettingsObject(db, userId),
    listTransactionsByMonth(db, userId, month),
    listTransactionsByMonth(db, userId, shiftMonth(month, -1)),
    allRows<{ id: number; slug: string | null; name: string; type: string | null; budget: number; color: string | null }>(
      db,
      "SELECT id, slug, name, type, budget, color FROM categories WHERE user_id = ?",
      [userId],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);

  const metricTransactions = filterTransactionsForMetricFlows(transactions, preferredCurrencyByLinkId);
  const metricPreviousTransactions = filterTransactionsForMetricFlows(previousTransactions, preferredCurrencyByLinkId);
  const expenseTransactions = metricTransactions.filter((row) => Number(row.monto) < 0);
  const incomeTransactions = metricTransactions.filter((row) => Number(row.monto) > 0);
  const previousExpenses = metricPreviousTransactions.filter((row) => Number(row.monto) < 0);
  const previousIncome = metricPreviousTransactions.filter((row) => Number(row.monto) > 0);

  const income = incomeTransactions.reduce((sum, row) => sum + Number(row.monto), 0);
  const expenses = expenseTransactions.reduce((sum, row) => sum + Math.abs(Number(row.monto)), 0);
  const previousIncomeTotal = previousIncome.reduce((sum, row) => sum + Number(row.monto), 0);
  const previousExpensesTotal = previousExpenses.reduce((sum, row) => sum + Math.abs(Number(row.monto)), 0);

  const byCategory = categories.map((category) => {
    const spent = expenseTransactions
      .filter((transaction) => Number(transaction.category_id) === Number(category.id))
      .reduce((sum, transaction) => sum + Math.abs(Number(transaction.monto)), 0);
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      spent,
      budget: Number(category.budget || 0),
      color: category.color,
      type: category.type,
    };
  }).filter((item) => item.spent > 0 || item.budget > 0 || item.name === "Ingreso")
    .sort((left, right) => right.spent - left.spent);

  const fixedSpent = byCategory.filter((item) => item.type === "fijo").reduce((sum, item) => sum + item.spent, 0);
  const variableSpent = byCategory.filter((item) => item.type !== "fijo" && item.name !== "Ingreso").reduce((sum, item) => sum + item.spent, 0);

  const calculateDeltaPercent = (current: number, previous: number) => {
    if (!previous) return current ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  return {
    month,
    currency: settings.display_currency || "UYU",
    pending_count: transactions.filter((transaction) => String(transaction.categorization_status || "") !== "categorized").length,
    totals: {
      income,
      expenses,
      net: income - expenses,
      margin: income - expenses,
      installments: transactions.filter((transaction) => Number(transaction.es_cuota || 0) > 0).reduce((sum, transaction) => sum + Math.abs(Number(transaction.monto)), 0),
      savings_monthly_target: Number(settings.savings_monthly || 0),
    },
    deltas: {
      income: calculateDeltaPercent(income, previousIncomeTotal),
      expenses: calculateDeltaPercent(expenses, previousExpensesTotal),
    },
    byCategory,
    byType: {
      fijo: fixedSpent,
      variable: variableSpent,
    },
    budgets: byCategory.map((item) => ({
      id: item.id,
      category_id: item.id,
      name: item.name,
      spent: item.spent,
      budget: item.budget,
      color: item.color,
      type: item.type,
    })),
    income,
    expenses,
    net: income - expenses,
    transaction_count: transactions.length,
  };
}

export async function getTransactionMonthlyEvolution(
  db: D1DatabaseLike,
  userId: string,
  months: number,
  endMonth: string,
) {
  const windowMonths = Array.from({ length: months }, (_, index) => shiftMonth(endMonth, index - months + 1));
  const [rows, preferredCurrencyByLinkId] = await Promise.all([
    allRows<{ period: string; monto: number; movement_kind: string | null; moneda: string | null; account_link_id: number | null }>(
      db,
      `
        SELECT period, monto, movement_kind, moneda, account_link_id
        FROM transactions
        WHERE user_id = ?
          AND period >= ?
          AND period <= ?
        ORDER BY period ASC
      `,
      [userId, windowMonths[0], endMonth],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);

  return windowMonths.map((month) => {
    const periodRows = filterTransactionsForMetricFlows(
      rows.filter((row) => String(row.period) === month),
      preferredCurrencyByLinkId,
    );
    const income = periodRows
      .filter((row) => Number(row.monto) > 0)
      .reduce((sum, row) => sum + Number(row.monto), 0);
    const expenses = periodRows
      .filter((row) => Number(row.monto) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.monto)), 0);

    return {
      month,
      income,
      expenses,
      ingresos: income,
      gastos: expenses,
      net: income - expenses,
      transaction_count: periodRows.length,
    };
  });
}

export async function searchTransactions(db: D1DatabaseLike, userId: string, query: string, limit: number) {
  const matcher = `%${String(query || "").trim().toLowerCase()}%`;
  const [rows, preferredCurrencyByLinkId] = await Promise.all([
    allRows<TransactionRecord>(
      db,
      `
        ${TRANSACTION_SELECT}
        WHERE transactions.user_id = ?
          AND (
            lower(transactions.desc_banco) LIKE ?
            OR lower(COALESCE(transactions.desc_usuario, '')) LIKE ?
            OR lower(COALESCE(categories.name, '')) LIKE ?
            OR lower(COALESCE(accounts.name, '')) LIKE ?
            OR lower(transactions.fecha) LIKE ?
          )
        ORDER BY transactions.fecha DESC, transactions.id DESC
        LIMIT ?
      `,
      [userId, matcher, matcher, matcher, matcher, matcher, Math.max(1, Math.min(limit, 100))],
    ),
    getPreferredCurrencyByLinkId(db, userId),
  ]);
  return markTransactionsForMetricFlows(rows, preferredCurrencyByLinkId);
}

export async function listCandidateTransactions(db: D1DatabaseLike, userId: string, pattern: string, limit = 50) {
  const matcher = `%${String(pattern || "").trim().toLowerCase()}%`;
  const rows = await allRows<TransactionRecord>(
    db,
    `
      ${TRANSACTION_SELECT}
      WHERE transactions.user_id = ?
        AND lower(transactions.desc_banco) LIKE ?
        AND transactions.categorization_status != 'categorized'
      ORDER BY transactions.fecha DESC, transactions.id DESC
      LIMIT ?
    `,
    [userId, matcher, Math.max(1, Math.min(limit, 100))],
  );

  const enriched = [];
  for (const row of rows) {
    enriched.push(await enrichTransactionForReview(db, userId, row));
  }
  return enriched;
}

export async function markTransactionMovement(db: D1DatabaseLike, userId: string, transactionId: number, kind: string) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  const normalizedKind = kind || "normal";
  const isInternal = normalizedKind === "internal_transfer" || normalizedKind === "fx_exchange";

  await runStatement(
    db,
    `
      UPDATE transactions
      SET movement_kind = ?,
          category_id = CASE WHEN ? THEN NULL ELSE category_id END,
          categorization_status = CASE
            WHEN ? THEN 'categorized'
            WHEN category_id IS NULL THEN 'uncategorized'
            ELSE 'categorized'
          END,
          category_source = CASE
            WHEN ? THEN 'movement_kind'
            WHEN category_id IS NULL THEN NULL
            ELSE category_source
          END,
          category_confidence = CASE WHEN ? THEN NULL ELSE category_confidence END,
          category_rule_id = CASE WHEN ? THEN NULL ELSE category_rule_id END
      WHERE user_id = ? AND id = ?
    `,
    [normalizedKind, isInternal ? 1 : 0, isInternal ? 1 : 0, isInternal ? 1 : 0, isInternal ? 1 : 0, isInternal ? 1 : 0, userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function buildImportReviewState(db: D1DatabaseLike, userId: string, transactionIds: number[]) {
  const settings = await getSettingsObject(db, userId);
  const transactions = await getTransactionsByIds(db, userId, transactionIds);
  const pending = transactions.filter((transaction) => String(transaction.categorization_status || "") !== "categorized");
  const enriched: Array<Record<string, unknown> & {
    id?: unknown;
    desc_banco?: unknown;
    category_id?: unknown;
    category_name?: unknown;
    categorization_status?: unknown;
  }> = [];
  for (const transaction of pending) {
    enriched.push(await enrichTransactionForReview(db, userId, transaction));
  }

  const grouped = new Map<string, {
    key: string;
    pattern: string;
    category_id: number;
    category_name: string;
    suggestion_source: string | null;
    count: number;
    transaction_ids: number[];
    samples: string[];
  }>();

  enriched
    .filter((transaction) => String(transaction.categorization_status || "") === "suggested" && transaction.category_id != null)
    .forEach((transaction) => {
      const normalizedPattern = normalizeReviewPattern(String(transaction.desc_banco || ""));
      if (!normalizedPattern) return;
      const key = `${normalizedPattern}::${transaction.category_id}`;
      const current = grouped.get(key) || {
        key,
        pattern: deriveRulePattern(String(transaction.desc_banco || "")) || String(transaction.desc_banco || ""),
        category_id: Number(transaction.category_id),
        category_name: String(transaction.category_name || "Sin categoria"),
        suggestion_source: String(transaction.suggestion_source || transaction.category_source || "rule_suggest"),
        count: 0,
        transaction_ids: [],
        samples: [],
      };
      current.count += 1;
      current.transaction_ids.push(Number(transaction.id));
      if (!current.samples.includes(String(transaction.desc_banco)) && current.samples.length < 5) {
        current.samples.push(String(transaction.desc_banco));
      }
      grouped.set(key, current);
    });

  const reviewGroups = [...grouped.values()]
    .filter((group) => group.count >= 2)
    .sort((left, right) => right.count - left.count)
    .map((group) => ({
      ...group,
      reason: group.suggestion_source === "ollama"
        ? "Ollama encontro un patron repetido que conviene validar antes de automatizar."
        : "Encontramos varios movimientos parecidos con la misma categoria sugerida.",
    }));

  const guidedReviewGroups = reviewGroups
    .filter((group) => group.count >= 2)
    .map((group) => ({
      ...group,
      priority: group.count >= 3 ? "high" : "medium",
      risk_label: group.count >= 4 ? "Patron fuerte" : "Conviene confirmar",
      guided_reason: "Vimos varias descripciones parecidas en la misma categoria",
      suggested_rule_mode: group.count >= 3 ? "auto" : "suggest",
      suggested_rule_confidence: group.count >= 4 ? 0.94 : 0.84,
    }))
    .filter((group) => group.count >= 3);

  const groupedIds = new Set(reviewGroups.flatMap((group) => group.transaction_ids));
  return {
    review_groups: reviewGroups,
    guided_review_groups: guidedReviewGroups,
    transaction_review_queue: enriched.filter((transaction) => !groupedIds.has(Number(transaction.id))),
    guided_onboarding_required: settings.guided_categorization_onboarding_completed !== "1"
      && settings.guided_categorization_onboarding_skipped !== "1"
      && guidedReviewGroups.length > 0,
    remaining_transaction_ids: pending.map((transaction) => Number(transaction.id)),
  };
}

export async function batchCreateTransactions(
  db: D1DatabaseLike,
  userId: string,
  input: { account_id?: string; period?: string; transactions: CreateTransactionInput[] },
) {
  const createdIds: number[] = [];
  let created = 0;
  let duplicates = 0;
  let errors = 0;

  for (const transaction of input.transactions) {
    try {
      const createdTransaction = await createTransaction(db, userId, {
        ...transaction,
        account_id: transaction.account_id || input.account_id,
        entry_type: transaction.entry_type || (Number(transaction.monto) >= 0 ? "income" : "expense"),
        moneda: transaction.moneda || "UYU",
      });
      if (createdTransaction?.id) {
        createdIds.push(Number(createdTransaction.id));
        created += 1;
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) duplicates += 1;
      else if (error instanceof AccountCurrencyMismatchError || error instanceof TransactionAccountNotFoundError) throw error;
      else errors += 1;
    }
  }

  return {
    created,
    duplicates,
    errors,
    ...(await buildImportReviewState(db, userId, createdIds)),
    guided_onboarding_session: null,
  };
}

export async function confirmCategorySelection(db: D1DatabaseLike, userId: string, transactionIds: number[], categoryId: number) {
  const transactions = await assignCategoryToTransactions(db, userId, transactionIds, categoryId);
  return {
    confirmed: transactions.length,
    transactions,
  };
}

export async function rejectCategorySelection(db: D1DatabaseLike, userId: string, transactionId: number, ruleId?: number | null) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  if (ruleId) {
    await rejectRuleForDescription(db, userId, ruleId, String(current.desc_banco));
  }
  if (current.category_source === "amount_profile") {
    await rejectAmountProfileForTransaction(db, userId, {
      descBanco: String(current.desc_banco),
      amount: Number(current.monto),
      currency: String(current.moneda),
      accountId: current.account_id == null ? null : String(current.account_id),
      direction: Number(current.monto) >= 0 ? "income" : "expense",
    });
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET category_id = NULL,
          categorization_status = CASE WHEN movement_kind = 'normal' THEN 'uncategorized' ELSE 'categorized' END,
          category_source = CASE WHEN movement_kind = 'normal' THEN NULL ELSE 'movement_kind' END,
          category_confidence = NULL,
          category_rule_id = NULL
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function undoRejectCategorySelection(db: D1DatabaseLike, userId: string, transactionId: number, ruleId?: number | null) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current || !ruleId) return current;

  const rule = await getRuleById(db, userId, ruleId);
  if (!rule || rule.category_id == null) return current;

  await runStatement(
    db,
    `
      UPDATE transactions
      SET category_id = ?,
          categorization_status = CASE WHEN ? = 'auto' THEN 'categorized' ELSE 'suggested' END,
          category_source = CASE WHEN ? = 'auto' THEN 'rule_confirmed' ELSE 'rule_suggest' END,
          category_confidence = ?,
          category_rule_id = ?
      WHERE user_id = ? AND id = ?
    `,
    [rule.category_id, rule.mode || "suggest", rule.mode || "suggest", rule.confidence ?? null, rule.id, userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function undoConfirmCategorySelection(db: D1DatabaseLike, userId: string, transactionId: number) {
  const current = await getTransactionById(db, userId, transactionId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE transactions
      SET category_id = NULL,
          categorization_status = CASE WHEN movement_kind = 'normal' THEN 'uncategorized' ELSE 'categorized' END,
          category_source = CASE WHEN movement_kind = 'normal' THEN NULL ELSE 'movement_kind' END,
          category_confidence = NULL,
          category_rule_id = NULL
      WHERE user_id = ? AND id = ?
    `,
    [userId, transactionId],
  );

  return getTransactionById(db, userId, transactionId);
}

export async function confirmInternalOperation(
  db: D1DatabaseLike,
  userId: string,
  input: {
    kind: string;
    source_transaction_id: number;
    target_transaction_id?: number | null;
    from_account_id?: string | null;
    to_account_id?: string | null;
    effective_rate?: number | null;
  },
) {
  const source = await getTransactionById(db, userId, input.source_transaction_id);
  if (!source) return null;

  const kind = input.kind || "internal_transfer";
  let target = input.target_transaction_id ? await getTransactionById(db, userId, Number(input.target_transaction_id)) : null;

  if (!target && input.to_account_id) {
    const targetAccount = await firstRow<{ currency: string }>(
      db,
      "SELECT currency FROM accounts WHERE user_id = ? AND id = ? LIMIT 1",
      [userId, input.to_account_id],
    );
    if (!targetAccount) {
      throw new Error("target account not found");
    }

    const rawAmount = Math.abs(Number(source.monto));
    let targetAmount = rawAmount;
    if (kind === "fx_exchange" && input.effective_rate && input.effective_rate > 0) {
      if (String(source.moneda) === "UYU" && targetAccount.currency !== "UYU") {
        targetAmount = rawAmount / Number(input.effective_rate);
      } else if (String(source.moneda) !== "UYU" && targetAccount.currency === "UYU") {
        targetAmount = rawAmount * Number(input.effective_rate);
      }
    }

    const counterpartDedup = buildDedupHash({
      fecha: String(source.fecha),
      monto: Math.abs(Number(targetAmount)),
      desc_banco: String(source.desc_banco),
    });
    const existingCounterpart = await firstRow<{ id: number }>(
      db,
      "SELECT id FROM transactions WHERE user_id = ? AND period = ? AND dedup_hash = ? LIMIT 1",
      [userId, String(source.period), counterpartDedup],
    );

    if (existingCounterpart) {
      target = await getTransactionById(db, userId, existingCounterpart.id);
    } else {
      const result = await runStatement(
        db,
        `
          INSERT INTO transactions (
            user_id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
            categorization_status, category_source, category_confidence, category_rule_id, dedup_hash
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'income', ?, 'categorized', 'movement_kind', NULL, NULL, ?)
        `,
        [
          userId,
          String(source.period),
          String(source.fecha),
          String(source.desc_banco),
          source.desc_usuario ?? null,
          Math.abs(Number(targetAmount)),
          targetAccount.currency,
          input.to_account_id,
          kind,
          counterpartDedup,
        ],
      );
      target = await getTransactionById(db, userId, Number(result.meta?.last_row_id || 0));
    }
  }

  const groupId = String(source.internal_group_id || `internal_${Date.now()}_${source.id}`);
  await runStatement(
    db,
    `
      UPDATE transactions
      SET movement_kind = ?,
          paired_transaction_id = ?,
          internal_group_id = ?,
          category_id = NULL,
          categorization_status = 'categorized',
          category_source = 'movement_kind',
          category_confidence = NULL,
          category_rule_id = NULL
      WHERE user_id = ? AND id = ?
    `,
    [kind, target?.id ?? null, groupId, userId, source.id],
  );

  if (target?.id) {
    await runStatement(
      db,
      `
        UPDATE transactions
        SET movement_kind = ?,
            paired_transaction_id = ?,
            internal_group_id = ?,
            category_id = NULL,
            categorization_status = 'categorized',
            category_source = 'movement_kind',
            category_confidence = NULL,
            category_rule_id = NULL
        WHERE user_id = ? AND id = ?
      `,
      [kind, source.id, groupId, userId, target.id],
    );
  }

  return {
    ok: true,
    transaction: await getTransactionById(db, userId, Number(source.id)),
    counterpart: target ? await getTransactionById(db, userId, Number(target.id)) : null,
  };
}

export async function rejectInternalOperation(db: D1DatabaseLike, userId: string, sourceTransactionId: number) {
  const source = await getTransactionById(db, userId, sourceTransactionId);
  if (!source) return null;

  if (source.paired_transaction_id != null) {
    await runStatement(
      db,
      `
        UPDATE transactions
        SET movement_kind = 'normal',
            paired_transaction_id = NULL,
            internal_group_id = NULL,
            account_link_id = NULL,
            categorization_status = CASE WHEN category_id IS NULL THEN 'uncategorized' ELSE 'categorized' END,
            category_source = CASE WHEN category_id IS NULL THEN NULL ELSE category_source END
        WHERE user_id = ? AND id = ?
      `,
      [userId, Number(source.paired_transaction_id)],
    );
  }

  await runStatement(
    db,
    `
      UPDATE transactions
      SET movement_kind = 'normal',
          paired_transaction_id = NULL,
          internal_group_id = NULL,
          account_link_id = NULL,
          categorization_status = CASE WHEN category_id IS NULL THEN 'uncategorized' ELSE 'categorized' END,
          category_source = CASE WHEN category_id IS NULL THEN NULL ELSE category_source END
      WHERE user_id = ? AND id = ?
    `,
    [userId, sourceTransactionId],
  );

  return {
    ok: true,
    transaction: await getTransactionById(db, userId, sourceTransactionId),
  };
}
