import type { CreateUploadIntentInput, UploadProcessInput } from "@smartfinance/contracts";
import {
  classifyTransaction as classifyTransactionWithCanonicalRules,
  deriveRuleIdentity,
  isGenericRulePattern,
  normalizeRulePattern,
} from "@smartfinance/domain";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { AccountCurrencyMismatchError, buildImportReviewState, TransactionAccountNotFoundError } from "./transactions";
import { classifyTransactionByRules, incrementRuleMatchCount, listMerchantDictionary, listRules, logRuleMatch } from "./rules";
import { getSettingsObject } from "./settings";

type UploadRow = {
  id: number;
  period: string;
  account_id: string | null;
  account_name?: string | null;
  original_filename: string;
  filename?: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  tx_count: number;
  source: "web" | "mobile" | "import";
  status: "pending" | "uploaded" | "processing" | "processed" | "needs_review";
  parser?: string | null;
  detected_format?: string | null;
  parse_failure_reason?: string | null;
  ai_assisted?: number | boolean;
  ai_provider?: string | null;
  ai_model?: string | null;
  extracted_candidates?: number;
  duplicates_skipped?: number;
  auto_categorized_count?: number;
  suggested_count?: number;
  pending_review_count?: number;
  unmatched_count?: number;
  created_at: string;
};

function hydrateUploadRow(upload: UploadRow): UploadRow {
  return {
    ...upload,
    ai_assisted: Boolean(upload.ai_assisted),
    extracted_candidates: Number(upload.extracted_candidates || 0),
    duplicates_skipped: Number(upload.duplicates_skipped || 0),
    auto_categorized_count: Number(upload.auto_categorized_count || 0),
    suggested_count: Number(upload.suggested_count || 0),
    pending_review_count: Number(upload.pending_review_count || 0),
    unmatched_count: Number(upload.unmatched_count || 0),
  };
}

function sanitizeFilename(filename: string) {
  return filename
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
}

function buildStorageKey(userId: string, input: CreateUploadIntentInput) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${userId}/${input.period}/${timestamp}-${sanitizeFilename(input.original_filename)}`;
}

function toPeriod(fecha: string) {
  return String(fecha || "").slice(0, 7);
}

function buildDedupHash(input: { fecha: string; monto: number; desc_banco: string }) {
  const normalized = `${input.fecha}|${input.monto}|${input.desc_banco.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return `tx_${Math.abs(hash)}`;
}

function buildInClause(values: string[]) {
  return values.map(() => "?").join(", ");
}

async function hasPriorAccountUpload(db: D1DatabaseLike, userId: string, accountId: string | null, uploadId: number) {
  if (!accountId) return false;
  const row = await firstRow<{ count: number }>(
    db,
    `
      SELECT COUNT(*) AS count
      FROM uploads
      WHERE user_id = ?
        AND account_id = ?
        AND id < ?
        AND tx_count > 0
        AND status IN ('processed', 'needs_review')
    `,
    [userId, accountId, uploadId],
  );
  return Number(row?.count || 0) > 0;
}

type FastUploadTransaction = {
  id: number;
  fecha: string;
  desc_banco: string;
  desc_usuario: string | null;
  monto: number;
  moneda: "UYU" | "USD" | "EUR" | "ARS";
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  account_id: string | null;
  account_name: string | null;
  entry_type: "expense" | "income";
  movement_kind: "normal";
  categorization_status: "uncategorized" | "suggested" | "categorized";
  category_source: string | null;
  category_confidence: number | null;
  category_rule_id: number | null;
  merchant_key: string | null;
};

function buildFastImportReviewState(
  transactions: FastUploadTransaction[],
  settings: Record<string, string>,
  options: { allowGroupedReview?: boolean } = {},
) {
  const pending = transactions.filter((transaction) => transaction.categorization_status !== "categorized");
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

  for (const transaction of pending) {
    if (transaction.categorization_status !== "suggested" || transaction.category_id == null) continue;
    const merchantPattern = normalizeRulePattern(String(transaction.merchant_key || ""));
    if (!merchantPattern || isGenericRulePattern(merchantPattern)) continue;
    const key = `${merchantPattern}::${transaction.category_id}`;
    const current = grouped.get(key) || {
      key,
      pattern: merchantPattern.toUpperCase(),
      category_id: Number(transaction.category_id),
      category_name: String(transaction.category_name || "Sin categoria"),
      suggestion_source: transaction.category_source || "rule_suggest",
      count: 0,
      transaction_ids: [],
      samples: [],
    };
    current.count += 1;
    current.transaction_ids.push(Number(transaction.id));
    if (!current.samples.includes(transaction.desc_banco) && current.samples.length < 5) {
      current.samples.push(transaction.desc_banco);
    }
    grouped.set(key, current);
  }

  const allowGroupedReview = options.allowGroupedReview !== false;
  const reviewGroups = allowGroupedReview
    ? [...grouped.values()]
      .filter((group) => group.count >= 2)
      .sort((left, right) => right.count - left.count)
      .map((group) => ({
        ...group,
        reason: "Encontramos varios movimientos parecidos con la misma categoria sugerida.",
      }))
    : [];

  const guidedReviewGroups = reviewGroups
    .filter((group) => group.count >= 3)
    .map((group) => ({
      ...group,
      priority: group.count >= 3 ? "high" : "medium",
      risk_label: group.count >= 4 ? "Patron fuerte" : "Conviene confirmar",
      guided_reason: "Vimos varias descripciones parecidas en la misma categoria",
      suggested_rule_mode: group.count >= 3 ? "auto" : "suggest",
      suggested_rule_confidence: group.count >= 4 ? 0.94 : 0.84,
    }));

  const groupedIds = new Set(reviewGroups.flatMap((group) => group.transaction_ids));
  const transactionReviewQueue = pending
    .filter((transaction) => !groupedIds.has(transaction.id))
    .map((transaction) => ({
      ...transaction,
      transaction_id: transaction.id,
      suggested_category_id: transaction.category_id,
      suggested_category_name: transaction.category_name,
      suggestion_source: transaction.category_source || (transaction.category_id ? "rule_suggest" : "manual_review"),
      suggestion_reason: transaction.category_name
        ? `Sugerido para ${transaction.category_name}. Revisalo para que el motor aprenda con seguridad.`
        : "Todavia falta contexto para categorizar esto en automatico.",
      amount_profile_id: null,
      counterparty_key: null,
      amount_similarity: null,
      historical_median: null,
      historical_sample_count: null,
      conflict_candidates: [],
      ai_audited: false,
      ai_reason: null,
      internal_operation_kind: null,
    }));

  return {
    review_groups: reviewGroups,
    guided_review_groups: guidedReviewGroups,
    transaction_review_queue: transactionReviewQueue,
    guided_onboarding_required: settings.guided_categorization_onboarding_completed !== "1"
      && settings.guided_categorization_onboarding_skipped !== "1"
      && guidedReviewGroups.length > 0,
    remaining_transaction_ids: pending.map((transaction) => transaction.id),
  };
}

export async function listUploadsByMonth(db: D1DatabaseLike, userId: string, month: string) {
  const uploads = await allRows<UploadRow>(
    db,
    `
      SELECT
        uploads.id,
        uploads.period,
        uploads.account_id,
        accounts.name AS account_name,
        uploads.original_filename,
        uploads.original_filename AS filename,
        uploads.storage_key,
        uploads.mime_type,
        uploads.size_bytes,
        uploads.tx_count,
        uploads.source,
        uploads.status,
        uploads.parser,
        uploads.detected_format,
        uploads.parse_failure_reason,
        uploads.ai_assisted,
        uploads.ai_provider,
        uploads.ai_model,
        uploads.extracted_candidates,
        uploads.duplicates_skipped,
        uploads.auto_categorized_count,
        uploads.suggested_count,
        uploads.pending_review_count,
        uploads.unmatched_count,
        uploads.created_at
      FROM uploads
      LEFT JOIN accounts
        ON accounts.user_id = uploads.user_id
       AND accounts.id = uploads.account_id
      WHERE uploads.user_id = ? AND uploads.period = ?
      ORDER BY uploads.created_at DESC, uploads.id DESC
    `,
    [userId, month],
  );
  return uploads.map(hydrateUploadRow);
}

export async function listUploads(db: D1DatabaseLike, userId: string) {
  const uploads = await allRows<UploadRow>(
    db,
    `
      SELECT
        uploads.id,
        uploads.period,
        uploads.account_id,
        accounts.name AS account_name,
        uploads.original_filename,
        uploads.original_filename AS filename,
        uploads.storage_key,
        uploads.mime_type,
        uploads.size_bytes,
        uploads.tx_count,
        uploads.source,
        uploads.status,
        uploads.parser,
        uploads.detected_format,
        uploads.parse_failure_reason,
        uploads.ai_assisted,
        uploads.ai_provider,
        uploads.ai_model,
        uploads.extracted_candidates,
        uploads.duplicates_skipped,
        uploads.auto_categorized_count,
        uploads.suggested_count,
        uploads.pending_review_count,
        uploads.unmatched_count,
        uploads.created_at
      FROM uploads
      LEFT JOIN accounts
        ON accounts.user_id = uploads.user_id
       AND accounts.id = uploads.account_id
      WHERE uploads.user_id = ?
      ORDER BY uploads.created_at DESC, uploads.id DESC
    `,
    [userId],
  );
  return uploads.map(hydrateUploadRow);
}

export async function getUploadById(db: D1DatabaseLike, userId: string, uploadId: number) {
  const upload = await firstRow<UploadRow>(
    db,
    `
      SELECT
        id,
        period,
        account_id,
        original_filename,
        storage_key,
        mime_type,
        size_bytes,
        tx_count,
        source,
        status,
        parser,
        detected_format,
        parse_failure_reason,
        ai_assisted,
        ai_provider,
        ai_model,
        extracted_candidates,
        duplicates_skipped,
        auto_categorized_count,
        suggested_count,
        pending_review_count,
        unmatched_count,
        created_at
      FROM uploads
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, uploadId],
  );
  return upload ? hydrateUploadRow(upload) : null;
}

export async function createUploadIntentRecord(db: D1DatabaseLike, userId: string, input: CreateUploadIntentInput) {
  const storageKey = buildStorageKey(userId, input);
  const result = await runStatement(
    db,
    `
      INSERT INTO uploads (user_id, account_id, period, original_filename, storage_key, mime_type, size_bytes, source, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `,
    [
      userId,
      input.account_id ?? null,
      input.period,
      input.original_filename,
      storageKey,
      input.mime_type,
      input.size_bytes,
      input.source,
    ],
  );

  return getUploadById(db, userId, Number(result.meta?.last_row_id || 0));
}

export async function markUploadStatus(
  db: D1DatabaseLike,
  userId: string,
  uploadId: number,
  input: {
    status: "pending" | "uploaded" | "processing" | "processed" | "needs_review";
    tx_count?: number;
    parser?: string | null;
    detected_format?: string | null;
    parse_failure_reason?: string | null;
    ai_assisted?: boolean;
    ai_provider?: string | null;
    ai_model?: string | null;
    extracted_candidates?: number;
    duplicates_skipped?: number;
    auto_categorized_count?: number;
    suggested_count?: number;
    pending_review_count?: number;
    unmatched_count?: number;
  },
) {
  const current = await getUploadById(db, userId, uploadId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE uploads
      SET
        status = ?,
        tx_count = ?,
        parser = ?,
        detected_format = ?,
        parse_failure_reason = ?,
        ai_assisted = ?,
        ai_provider = ?,
        ai_model = ?,
        extracted_candidates = ?,
        duplicates_skipped = ?,
        auto_categorized_count = ?,
        suggested_count = ?,
        pending_review_count = ?,
        unmatched_count = ?
      WHERE user_id = ? AND id = ?
    `,
    [
      input.status,
      input.tx_count ?? Number(current.tx_count || 0),
      input.parser ?? current.parser ?? null,
      input.detected_format ?? current.detected_format ?? null,
      input.parse_failure_reason ?? current.parse_failure_reason ?? null,
      input.ai_assisted == null ? Number(Boolean(current.ai_assisted)) : Number(Boolean(input.ai_assisted)),
      input.ai_provider ?? current.ai_provider ?? null,
      input.ai_model ?? current.ai_model ?? null,
      input.extracted_candidates ?? Number(current.extracted_candidates || 0),
      input.duplicates_skipped ?? Number(current.duplicates_skipped || 0),
      input.auto_categorized_count ?? Number(current.auto_categorized_count || 0),
      input.suggested_count ?? Number(current.suggested_count || 0),
      input.pending_review_count ?? Number(current.pending_review_count || 0),
      input.unmatched_count ?? Number(current.unmatched_count || 0),
      userId,
      uploadId,
    ],
  );

  return getUploadById(db, userId, uploadId);
}

export async function processUploadTransactions(db: D1DatabaseLike, userId: string, input: UploadProcessInput) {
  const upload = await getUploadById(db, userId, input.upload_id);
  if (!upload) return null;

  await markUploadStatus(db, userId, input.upload_id, { status: "processing", tx_count: Number(upload.tx_count || 0) });

  const account = upload.account_id
    ? await firstRow<{ id: string; name: string; currency: "UYU" | "USD" | "EUR" | "ARS" }>(
      db,
      "SELECT id, name, currency FROM accounts WHERE user_id = ? AND id = ? LIMIT 1",
      [userId, upload.account_id],
    )
    : null;
  if (upload.account_id && !account) {
    throw new TransactionAccountNotFoundError(upload.account_id);
  }
  if (account) {
    const mismatched = input.transactions.find((transaction) => transaction.moneda !== account.currency);
    if (mismatched) {
      throw new AccountCurrencyMismatchError(account.currency, mismatched.moneda, account.id);
    }
  }

  const settings = await getSettingsObject(db, userId);
  const accountHasPriorUpload = await hasPriorAccountUpload(db, userId, upload.account_id, input.upload_id);
  const [rules, dictionary, categories, allRejections] = await Promise.all([
    listRules(db, userId),
    listMerchantDictionary(db, userId),
    allRows<{ id: number; slug: string; name: string; color: string | null }>(
      db,
      "SELECT id, slug, name, color FROM categories WHERE user_id = ?",
      [userId],
    ),
    allRows<{ rule_id: number; desc_banco_normalized: string }>(
      db,
      "SELECT rule_id, desc_banco_normalized FROM rule_rejections WHERE user_id = ?",
      [userId],
    ),
  ]);
  const categoryById = new Map(categories.map((category) => [Number(category.id), category]));
  const periods = [...new Set(input.transactions.map((transaction) => toPeriod(transaction.fecha)).filter(Boolean))];
  const existingHashes = new Set<string>();
  if (periods.length > 0) {
    const rows = await allRows<{ dedup_hash: string }>(
      db,
      `
        SELECT dedup_hash
        FROM transactions
        WHERE user_id = ?
          AND period IN (${buildInClause(periods)})
      `,
      [userId, ...periods],
    );
    rows.forEach((row) => {
      if (row.dedup_hash) existingHashes.add(String(row.dedup_hash));
    });
  }

  let created = 0;
  let duplicatesSkipped = 0;
  let autoCategorized = 0;
  let suggested = 0;
  let pendingReview = 0;
  const createdTransactions: FastUploadTransaction[] = [];
  const ruleMatchCounts = new Map<number, number>();

  for (const transaction of input.transactions) {
    const entryType = transaction.entry_type ?? (transaction.monto >= 0 ? "income" : "expense");
    const signedAmount = entryType === "expense" ? -Math.abs(transaction.monto) : Math.abs(transaction.monto);
    const period = toPeriod(transaction.fecha);
    const dedupHash = buildDedupHash({
      fecha: transaction.fecha,
      monto: signedAmount,
      desc_banco: transaction.desc_banco,
    });
    if (existingHashes.has(dedupHash)) {
      duplicatesSkipped += 1;
      continue;
    }

    const identity = deriveRuleIdentity(transaction.desc_banco, {
      accountId: upload.account_id ?? null,
      currency: transaction.moneda,
      direction: entryType,
    });
    const normalizedDescription = normalizeRulePattern(transaction.desc_banco);
    const matchingRejections = normalizedDescription
      ? allRejections.filter((rejection) => normalizedDescription.includes(String(rejection.desc_banco_normalized || "")))
      : [];
    const classification = classifyTransactionWithCanonicalRules(
      {
        desc_banco: transaction.desc_banco,
        monto: signedAmount,
        moneda: transaction.moneda,
        account_id: upload.account_id ?? null,
      },
      rules,
      matchingRejections,
      settings,
      dictionary,
    );
    const categorizationStatus = classification.categorizationStatus === "categorized" && accountHasPriorUpload ? "categorized"
      : classification.categorizationStatus === "suggested" ? "suggested"
      : classification.categorizationStatus === "categorized" ? "suggested"
      : "uncategorized";
    const categoryId = classification.categoryId ?? null;
    const category = categoryId == null ? null : categoryById.get(Number(categoryId)) || null;

    const insert = await runStatement(
      db,
      `
        INSERT INTO transactions
        (
          user_id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
          categorization_status, category_source, category_confidence, category_rule_id,
          merchant_key, parse_quality, rule_skipped_reason, dedup_hash, upload_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        period,
        transaction.fecha,
        transaction.desc_banco,
        transaction.desc_usuario ?? null,
        signedAmount,
        transaction.moneda,
        categoryId,
        upload.account_id ?? null,
        entryType,
        categorizationStatus,
        classification.categorySource,
        classification.categoryConfidence,
        classification.categoryRuleId,
        identity.merchant_key,
        identity.skipped ? "partial" : "clean",
        identity.skippedReason,
        dedupHash,
        input.upload_id,
      ],
    );
    const insertedId = Number(insert.meta?.last_row_id || 0);
    const createdId = insertedId || Number((await firstRow<{ id: number }>(
      db,
      "SELECT id FROM transactions WHERE user_id = ? AND period = ? AND dedup_hash = ? LIMIT 1",
      [userId, period, dedupHash],
    ))?.id || 0);
    if (!createdId) continue;

    existingHashes.add(dedupHash);
    created += 1;
    if (categorizationStatus === "categorized") autoCategorized += 1;
    if (categorizationStatus === "suggested") suggested += 1;
    if (categorizationStatus !== "categorized") pendingReview += 1;
    if (classification.categoryRuleId) {
      const ruleId = Number(classification.categoryRuleId);
      ruleMatchCounts.set(ruleId, (ruleMatchCounts.get(ruleId) || 0) + 1);
    }

    await runStatement(
      db,
      `
        INSERT INTO rule_match_log (user_id, transaction_id, rule_id, category_id, layer, confidence, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        userId,
        createdId,
        classification.categoryRuleId,
        categoryId,
        classification.categorySource || (identity.skipped ? "fallback" : "import"),
        classification.categoryConfidence,
        classification.categorySource || identity.skippedReason || "imported",
      ],
    );

    createdTransactions.push({
      id: createdId,
      fecha: transaction.fecha,
      desc_banco: transaction.desc_banco,
      desc_usuario: transaction.desc_usuario ?? null,
      monto: signedAmount,
      moneda: transaction.moneda,
      category_id: categoryId,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
      account_id: upload.account_id ?? null,
      account_name: account?.name ?? null,
      entry_type: entryType,
      movement_kind: "normal",
      categorization_status: categorizationStatus,
      category_source: classification.categorySource,
      category_confidence: classification.categoryConfidence,
      category_rule_id: classification.categoryRuleId,
      merchant_key: identity.merchant_key,
    });
  }

  for (const [ruleId, count] of ruleMatchCounts.entries()) {
    await runStatement(
      db,
      `
        UPDATE rules
        SET match_count = match_count + ?,
            last_matched_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `,
      [count, userId, ruleId],
    );
  }

  const nextUpload = await markUploadStatus(db, userId, input.upload_id, {
    status: pendingReview > 0 ? "needs_review" : "processed",
    tx_count: created,
  });
  const reviewState = buildFastImportReviewState(createdTransactions, settings, {
    allowGroupedReview: accountHasPriorUpload,
  });

  return {
    upload: nextUpload,
    created,
    duplicates_skipped: duplicatesSkipped,
    auto_categorized: autoCategorized,
    suggested,
    pending_review: pendingReview,
    ...reviewState,
  };
}

export async function retryCategorizeUploadTransactions(db: D1DatabaseLike, userId: string, uploadId: number) {
  const upload = await getUploadById(db, userId, uploadId);
  if (!upload) return null;

  const rows = await allRows<{
    id: number;
    desc_banco: string;
    monto: number;
    moneda: "UYU" | "USD" | "EUR" | "ARS";
    account_id: string | null;
    category_id: number | null;
  }>(
    db,
    `
      SELECT id, desc_banco, monto, moneda, account_id, category_id
      FROM transactions
      WHERE user_id = ? AND upload_id = ?
      ORDER BY id ASC
    `,
    [userId, uploadId],
  );

  let categorized = 0;
  let suggested = 0;
  let pending = 0;

  for (const row of rows) {
    const classification = await classifyTransactionByRules(db, userId, {
      descBanco: row.desc_banco,
      amount: Number(row.monto),
      currency: row.moneda,
      accountId: row.account_id,
      entryType: Number(row.monto) >= 0 ? "income" : "expense",
      categoryId: null,
    });

    await runStatement(
      db,
      `
        UPDATE transactions
        SET category_id = ?,
            categorization_status = ?,
            category_source = ?,
            category_confidence = ?,
            category_rule_id = ?
        WHERE user_id = ? AND id = ?
      `,
      [
        classification.categoryId,
        classification.categorizationStatus,
        classification.categorySource,
        classification.categoryConfidence,
        classification.categoryRuleId,
        userId,
        row.id,
      ],
    );

    if (classification.matchedRule?.id) {
      await incrementRuleMatchCount(db, userId, Number(classification.matchedRule.id));
    }
    await logRuleMatch(db, userId, {
      transactionId: row.id,
      ruleId: classification.categoryRuleId,
      categoryId: classification.categoryId,
      layer: classification.categorySource || "fallback",
      confidence: classification.categoryConfidence,
      reason: classification.categorySource || "retry_categorize",
    });

    if (classification.categorizationStatus === "categorized") categorized += 1;
    else if (classification.categorizationStatus === "suggested") suggested += 1;
    else pending += 1;
  }

  const updated = await markUploadStatus(db, userId, uploadId, {
    status: pending + suggested > 0 ? "needs_review" : "processed",
    auto_categorized_count: categorized,
    suggested_count: suggested,
    pending_review_count: pending + suggested,
  });

  return {
    upload: updated,
    processed: rows.length,
    categorized,
    suggested,
    pending_review: pending + suggested,
    ...(await buildImportReviewState(db, userId, rows.map((row) => Number(row.id)))),
  };
}
