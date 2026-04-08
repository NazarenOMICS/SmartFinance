import type { CreateUploadIntentInput, UploadProcessInput } from "@smartfinance/contracts";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { createTransaction } from "./transactions";

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
  created_at: string;
};

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
  return allRows<UploadRow>(
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
}

export async function listUploads(db: D1DatabaseLike, userId: string) {
  return allRows<UploadRow>(
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
}

export async function getUploadById(db: D1DatabaseLike, userId: string, uploadId: number) {
  return firstRow<UploadRow>(
    db,
    `
      SELECT id, period, account_id, original_filename, storage_key, mime_type, size_bytes, tx_count, source, status, created_at
      FROM uploads
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
    [userId, uploadId],
  );
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
  input: { status: "pending" | "uploaded" | "processing" | "processed" | "needs_review"; tx_count?: number },
) {
  const current = await getUploadById(db, userId, uploadId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE uploads
      SET status = ?, tx_count = ?
      WHERE user_id = ? AND id = ?
    `,
    [input.status, input.tx_count ?? Number(current.tx_count || 0), userId, uploadId],
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
  };
}
