import { Hono } from "hono";
import { uploadSchema } from "@smartfinance/contracts";
import { extractTransactionsFromCsv, extractTransactionsFromText } from "@smartfinance/domain";
import { firstRow } from "@smartfinance/database";
import { createUploadIntentRecord, getSettingsObject, getUsageSnapshot, incrementUsageCounter, listUploads, listUploadsByMonth, markUploadStatus, processUploadTransactions } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { log } from "@smartfinance/observability";
import { extractTransactionsFromContentWithAi } from "../services/ai";
import { storeUploadBinary } from "../services/upload-storage";
import { jsonError } from "../utils/http";

const uploadRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

function dedupePreviewTransactions(transactions: Array<{
  fecha: string;
  desc_banco: string;
  monto: number;
  moneda: "UYU" | "USD" | "EUR" | "ARS";
  desc_usuario?: string;
  entry_type?: "expense" | "income";
}>) {
  const seen = new Set<string>();
  return transactions.filter((transaction) => {
    const key = `${transaction.fecha}|${Number(transaction.monto).toFixed(2)}|${String(transaction.desc_banco).trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeStatementCurrency(value: FormDataEntryValue | null) {
  const currency = String(value || "").trim().toUpperCase();
  return ["UYU", "USD", "EUR", "ARS"].includes(currency)
    ? currency as "UYU" | "USD" | "EUR" | "ARS"
    : null;
}

uploadRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const period = c.req.query("period");
  const uploads = period
    ? await listUploadsByMonth(c.env.DB, auth.userId, period)
    : await listUploads(c.env.DB, auth.userId);
  return c.json(uploads.map((upload) => uploadSchema.parse(upload)));
});

uploadRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const formData = await c.req.formData();
  const file = formData.get("file");
  const period = String(formData.get("period") || "").trim();
  const accountId = String(formData.get("account_id") || "").trim() || undefined;
  const extractedText = String(formData.get("extracted_text") || "");
  const statementCurrency = normalizeStatementCurrency(formData.get("statement_currency"));
  if (!(file instanceof File) || !period) {
    return jsonError("file and period are required", "VALIDATION_ERROR", requestId, 400);
  }

  const usage = await getUsageSnapshot(c.env.DB, auth.userId);
  const maxSizeBytes = usage.usage.max_upload_size_mb * 1024 * 1024;
  if (file.size > maxSizeBytes) {
    return jsonError("Upload exceeds plan size limit", "UPLOAD_SIZE_LIMIT", requestId, 413);
  }
  if (usage.usage.uploads_this_month.used >= usage.usage.uploads_this_month.limit) {
    return jsonError("Monthly upload limit reached", "UPLOAD_LIMIT_REACHED", requestId, 409);
  }

  const account = accountId
    ? await firstRow<{ currency: "UYU" | "USD" | "EUR" | "ARS" }>(
      c.env.DB,
      "SELECT currency FROM accounts WHERE user_id = ? AND id = ? LIMIT 1",
      [auth.userId, accountId],
    )
    : null;
  if (accountId && !account) {
    return jsonError("Account not found", "ACCOUNT_NOT_FOUND", requestId, 404);
  }
  const accountCurrency = account?.currency ?? null;

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
  const stored = await storeUploadBinary(c.env, upload, file);
  await markUploadStatus(c.env.DB, auth.userId, upload.id, { status: "uploaded" });

  const lowerName = file.name.toLowerCase();
  const content = extractedText || ((lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) ? await file.text() : "");
  if (!content) {
    await markUploadStatus(c.env.DB, auth.userId, upload.id, {
      status: "processed",
      tx_count: 0,
      parser: "unsupported",
      detected_format: null,
      parse_failure_reason: "no_text_content",
      extracted_candidates: 0,
      duplicates_skipped: 0,
      auto_categorized_count: 0,
      suggested_count: 0,
      pending_review_count: 0,
      unmatched_count: 0,
    });
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
      parser: "unsupported",
      detected_format: null,
      unmatched_count: 0,
      ai_assisted: false,
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
  let parser = lowerName.endsWith(".csv") ? "csv" : "text";
  let detectedFormat = preview.detectedFormat ?? (lowerName.endsWith(".csv") ? "generic_csv" : "generic_text");
  let aiAssisted = false;
  let aiProvider: string | null = null;
  let aiModel: string | null = null;
  let unmatchedCount = preview.unmatched.length;
  let previewTransactions: Array<{
    fecha: string;
    desc_banco: string;
    monto: number;
    moneda: "UYU" | "USD" | "EUR" | "ARS";
    desc_usuario?: string;
    entry_type?: "expense" | "income";
  }> = preview.transactions.map((transaction) => ({
    ...transaction,
    moneda: (transaction.moneda || statementCurrency || accountCurrency || "UYU") as "UYU" | "USD" | "EUR" | "ARS",
  }));

  const mismatchedCurrency = accountCurrency
    ? previewTransactions.find((transaction) => transaction.moneda !== accountCurrency)
    : null;
  if (mismatchedCurrency) {
    await markUploadStatus(c.env.DB, auth.userId, upload.id, {
      status: "processed",
      tx_count: 0,
      parser,
      detected_format: detectedFormat,
      parse_failure_reason: "account_currency_mismatch",
      extracted_candidates: previewTransactions.length,
      duplicates_skipped: 0,
      auto_categorized_count: 0,
      suggested_count: 0,
      pending_review_count: 0,
      unmatched_count: unmatchedCount,
    });
    return jsonError(
      `La cuenta seleccionada es ${accountCurrency}, pero el archivo parece ser ${mismatchedCurrency.moneda}. Elegi la cuenta correcta o subi el extracto correspondiente.`,
      "ACCOUNT_CURRENCY_MISMATCH",
      requestId,
      409,
    );
  }

  const shouldTryAi = Boolean(content)
    && usage.capabilities.ai_assisted_imports
    && usage.usage.ai_requests_this_month.used < usage.usage.ai_requests_this_month.limit
    && !lowerName.endsWith(".csv")
    && (
      previewTransactions.length === 0
      || (previewTransactions.length < 2 && preview.unmatched.length > 0)
      || (preview.unmatched.length > previewTransactions.length * 2 && preview.unmatched.length >= 4)
    );

  if (shouldTryAi) {
    const aiExtraction = await extractTransactionsFromContentWithAi(c.env, {
      period,
      content,
      fileName: file.name,
      statementCurrency: String(formData.get("statement_currency") || "") || null,
    });
    if (aiExtraction?.transactions?.length) {
      const merged = dedupePreviewTransactions([
        ...previewTransactions,
        ...aiExtraction.transactions,
      ]);
      aiAssisted = merged.length > previewTransactions.length;
      previewTransactions = merged;
      aiProvider = aiExtraction.provider;
      aiModel = aiExtraction.model || null;
      parser = previewTransactions.length > preview.transactions.length ? "hybrid" : parser;
      if (preview.transactions.length === 0) {
        parser = "ai";
      }
      detectedFormat = detectedFormat ? `${detectedFormat}+ai` : "ai";
      unmatchedCount = Math.max(0, preview.unmatched.length - aiExtraction.transactions.length);
      await incrementUsageCounter(c.env.DB, auth.userId, "ai_requests", 1);
    }
  }

  const aiMismatchedCurrency = accountCurrency
    ? previewTransactions.find((transaction) => transaction.moneda !== accountCurrency)
    : null;
  if (aiMismatchedCurrency) {
    await markUploadStatus(c.env.DB, auth.userId, upload.id, {
      status: "processed",
      tx_count: 0,
      parser,
      detected_format: detectedFormat,
      parse_failure_reason: "account_currency_mismatch",
      extracted_candidates: previewTransactions.length,
      duplicates_skipped: 0,
      auto_categorized_count: 0,
      suggested_count: 0,
      pending_review_count: 0,
      unmatched_count: unmatchedCount,
    });
    return jsonError(
      `La cuenta seleccionada es ${accountCurrency}, pero el archivo parece ser ${aiMismatchedCurrency.moneda}. Elegi la cuenta correcta o subi el extracto correspondiente.`,
      "ACCOUNT_CURRENCY_MISMATCH",
      requestId,
      409,
    );
  }

  const processed = await processUploadTransactions(c.env.DB, auth.userId, {
    upload_id: upload.id,
    transactions: previewTransactions,
  });
  if (!processed) {
    return jsonError("Upload could not be processed", "UPLOAD_ERROR", requestId, 500);
  }

  const persistedUpload = await markUploadStatus(c.env.DB, auth.userId, upload.id, {
    status: processed.pending_review > 0 ? "needs_review" : "processed",
    tx_count: processed.created,
    parser,
    detected_format: detectedFormat,
    parse_failure_reason: previewTransactions.length === 0 ? "no_transactions_detected" : null,
    ai_assisted: aiAssisted,
    ai_provider: aiProvider,
    ai_model: aiModel,
    extracted_candidates: previewTransactions.length,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized_count: processed.auto_categorized,
    suggested_count: processed.suggested,
    pending_review_count: processed.pending_review,
    unmatched_count: unmatchedCount,
  });

  log("info", "upload.processed", {
    request_id: requestId,
    user_id: auth.userId,
    upload_id: upload.id,
    parser,
    detected_format: detectedFormat,
    ai_assisted: aiAssisted,
    ai_provider: aiProvider,
    ai_model: aiModel,
    created: processed.created,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized: processed.auto_categorized,
    suggested: processed.suggested,
    pending_review: processed.pending_review,
    unsupported: false,
  });

  return c.json({
    upload_id: upload.id,
    new_transactions: processed.created,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized: processed.auto_categorized,
    pending_review: processed.pending_review,
    parser,
    detected_format: detectedFormat,
    ai_assisted: aiAssisted,
    ai_provider: aiProvider,
    ai_model: aiModel,
    extracted_candidates: previewTransactions.length,
    unmatched_count: unmatchedCount,
    upload: persistedUpload ? uploadSchema.parse(persistedUpload) : null,
    review_groups: processed.review_groups,
    guided_review_groups: processed.guided_review_groups,
    transaction_review_queue: processed.transaction_review_queue,
    guided_onboarding_required: processed.guided_onboarding_required,
    remaining_transaction_ids: processed.remaining_transaction_ids,
  });
});

export default uploadRouter;
