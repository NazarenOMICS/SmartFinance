import type { CreateUploadIntentInput, UploadProcessInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { buildImportReviewState, createTransaction } from "./transactions";

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

  let created = 0;
  let duplicatesSkipped = 0;
  let autoCategorized = 0;
  let suggested = 0;
  let pendingReview = 0;
  const createdIds: number[] = [];

  for (const transaction of input.transactions) {
    const entryType = transaction.entry_type ?? (transaction.monto >= 0 ? "income" : "expense");
    try {
      const createdTransaction = await createTransaction(
        db,
        userId,
        {
          fecha: transaction.fecha,
          desc_banco: transaction.desc_banco,
          desc_usuario: transaction.desc_usuario,
          monto: transaction.monto,
          moneda: transaction.moneda,
          account_id: upload.account_id ?? undefined,
          entry_type: entryType,
        },
        { uploadId: input.upload_id },
      );

      if (!createdTransaction) continue;
      created += 1;
      createdIds.push(Number(createdTransaction.id));
      if (createdTransaction.categorization_status === "categorized") autoCategorized += 1;
      if (createdTransaction.categorization_status === "suggested") suggested += 1;
      if (createdTransaction.categorization_status !== "categorized") pendingReview += 1;
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        duplicatesSkipped += 1;
        continue;
      }
      throw error;
    }
  }

  const nextUpload = await markUploadStatus(db, userId, input.upload_id, {
    status: pendingReview > 0 ? "needs_review" : "processed",
    tx_count: created,
  });

  return {
    upload: nextUpload,
    created,
    duplicates_skipped: duplicatesSkipped,
    auto_categorized: autoCategorized,
    suggested,
    pending_review: pendingReview,
    ...(await buildImportReviewState(db, userId, createdIds)),
  };
}
