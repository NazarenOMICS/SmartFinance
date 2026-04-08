import { Hono } from "hono";
import { extractTransactionsFromCsv, extractTransactionsFromText } from "@smartfinance/domain";
import { allRows } from "@smartfinance/database";
import { buildImportReviewState, createUploadIntentRecord, getSettingsObject, listUploads, listUploadsByMonth, markUploadStatus, processUploadTransactions } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const uploadRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

uploadRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const period = c.req.query("period");
  const uploads = period
    ? await listUploadsByMonth(c.env.DB, auth.userId, period)
    : await listUploads(c.env.DB, auth.userId);
  return c.json(uploads);
});

uploadRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const formData = await c.req.formData();
  const file = formData.get("file");
  const period = String(formData.get("period") || "").trim();
  const accountId = String(formData.get("account_id") || "").trim() || undefined;
  const extractedText = String(formData.get("extracted_text") || "");
  if (!(file instanceof File) || !period) {
    return jsonError("file and period are required", "VALIDATION_ERROR", requestId, 400);
  }

  const upload = await createUploadIntentRecord(c.env.DB, auth.userId, {
    original_filename: file.name,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.size,
    period,
    account_id: accountId,
    source: "web",
  });
  if (!upload) {
    return jsonError("Upload could not be created", "UPLOAD_ERROR", requestId, 500);
  }
  await markUploadStatus(c.env.DB, auth.userId, upload.id, { status: "uploaded" });

  const lowerName = file.name.toLowerCase();
  const content = extractedText || ((lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) ? await file.text() : "");
  if (!content) {
    await markUploadStatus(c.env.DB, auth.userId, upload.id, { status: "processed", tx_count: 0 });
    return c.json({
      upload_id: upload.id,
      new_transactions: 0,
      duplicates_skipped: 0,
      auto_categorized: 0,
      pending_review: 0,
      review_groups: [],
      guided_review_groups: [],
      transaction_review_queue: [],
      guided_onboarding_required: false,
      remaining_transaction_ids: [],
      unsupported: true,
    });
  }

  const settings = await getSettingsObject(c.env.DB, auth.userId);
  let patterns: string[] | undefined;
  try {
    const parsedPatterns = JSON.parse(settings.parsing_patterns || "[]");
    if (Array.isArray(parsedPatterns)) {
      patterns = parsedPatterns.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    }
  } catch {
    patterns = undefined;
  }

  const preview = lowerName.endsWith(".csv")
    ? extractTransactionsFromCsv(content, period)
    : extractTransactionsFromText(content, period, patterns);
  const processed = await processUploadTransactions(c.env.DB, auth.userId, {
    upload_id: upload.id,
    transactions: preview.transactions.map((transaction) => ({
      ...transaction,
      moneda: transaction.moneda || "UYU",
    })),
  });
  if (!processed) {
    return jsonError("Upload could not be processed", "UPLOAD_ERROR", requestId, 500);
  }

  const uploadTransactions = await allRows<{ id: number }>(
    c.env.DB,
    "SELECT id FROM transactions WHERE user_id = ? AND upload_id = ? ORDER BY id ASC",
    [auth.userId, upload.id],
  );
  const reviewState = await buildImportReviewState(c.env.DB, auth.userId, uploadTransactions.map((row) => Number(row.id)));

  return c.json({
    upload_id: upload.id,
    new_transactions: processed.created,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized: processed.auto_categorized,
    pending_review: processed.pending_review + processed.suggested,
    ...reviewState,
  });
});

export default uploadRouter;
