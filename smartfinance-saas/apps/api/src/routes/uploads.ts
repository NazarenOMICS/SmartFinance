import { Hono } from "hono";
import {
  createUploadIntentInputSchema,
  monthStringSchema,
  uploadIntentSchema,
  uploadPreviewInputSchema,
  uploadPreviewResultSchema,
  uploadProcessInputSchema,
  uploadProcessResultSchema,
  uploadSchema,
} from "@smartfinance/contracts";
import { extractTransactionsFromCsv, extractTransactionsFromText } from "@smartfinance/domain";
import { createUploadIntentRecord, getUploadById, getUsageSnapshot, listUploadsByMonth, markUploadStatus, processUploadTransactions } from "@smartfinance/database";
import { getSettingsObject } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { getUploadBinary, storeUploadBinary } from "../services/upload-storage";
import { jsonError } from "../utils/http";

const uploadsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

uploadsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const uploads = await listUploadsByMonth(c.env.DB, auth.userId, parsedMonth.data);
  return c.json(uploads.map((upload) => uploadSchema.parse(upload)));
});

uploadsRouter.post("/intent", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createUploadIntentInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid upload intent payload", "VALIDATION_ERROR", requestId, 400);
  }

  const usage = await getUsageSnapshot(c.env.DB, auth.userId);
  const maxSizeBytes = usage.usage.max_upload_size_mb * 1024 * 1024;
  if (body.data.size_bytes > maxSizeBytes) {
    return jsonError("Upload exceeds plan size limit", "UPLOAD_SIZE_LIMIT", requestId, 413);
  }

  if (usage.usage.uploads_this_month.used >= usage.usage.uploads_this_month.limit) {
    return jsonError("Monthly upload limit reached", "UPLOAD_LIMIT_REACHED", requestId, 409);
  }

  const upload = await createUploadIntentRecord(c.env.DB, auth.userId, body.data);
  const payload = uploadIntentSchema.parse({
    upload,
    upload_url: new URL(`/api/uploads/${upload?.id}/content`, c.req.url).toString(),
    method: "PUT",
    headers: {},
    max_upload_size_mb: usage.usage.max_upload_size_mb,
  });

  return c.json(payload, 201);
});

uploadsRouter.post("/preview", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = uploadPreviewInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid upload preview payload", "VALIDATION_ERROR", requestId, 400);
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

  const preview = body.data.source_type === "csv"
    ? extractTransactionsFromCsv(body.data.content, body.data.period)
    : extractTransactionsFromText(body.data.content, body.data.period, patterns);

  return c.json(uploadPreviewResultSchema.parse({
    transactions: preview.transactions,
    unmatched: preview.unmatched,
    detected_format: preview.detectedFormat ?? null,
    totals: {
      parsed: preview.transactions.length,
      unmatched: preview.unmatched.length,
    },
  }));
});

uploadsRouter.post("/:id/mark-uploaded", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const uploadId = Number(c.req.param("id"));
  if (!Number.isInteger(uploadId) || uploadId < 1) {
    return jsonError("Invalid upload id", "VALIDATION_ERROR", requestId, 400);
  }

  const upload = await markUploadStatus(c.env.DB, auth.userId, uploadId, { status: "uploaded" });
  if (!upload) {
    return jsonError("Upload not found", "UPLOAD_NOT_FOUND", requestId, 404);
  }

  return c.json(uploadSchema.parse(upload));
});

uploadsRouter.put("/:id/content", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const uploadId = Number(c.req.param("id"));
  if (!Number.isInteger(uploadId) || uploadId < 1) {
    return jsonError("Invalid upload id", "VALIDATION_ERROR", requestId, 400);
  }

  const upload = await getUploadById(c.env.DB, auth.userId, uploadId);
  if (!upload) {
    return jsonError("Upload not found", "UPLOAD_NOT_FOUND", requestId, 404);
  }

  const content = await c.req.arrayBuffer();
  if (!content.byteLength) {
    return jsonError("Upload content is required", "VALIDATION_ERROR", requestId, 400);
  }

  const stored = await storeUploadBinary(c.env, uploadSchema.parse(upload), content);

  const updated = await markUploadStatus(c.env.DB, auth.userId, uploadId, { status: "uploaded" });
  if (!updated) {
    return jsonError("Upload not found", "UPLOAD_NOT_FOUND", requestId, 404);
  }

  return c.json(uploadSchema.parse(updated));
});

uploadsRouter.get("/:id/content", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const uploadId = Number(c.req.param("id"));
  if (!Number.isInteger(uploadId) || uploadId < 1) {
    return jsonError("Invalid upload id", "VALIDATION_ERROR", requestId, 400);
  }

  const upload = await getUploadById(c.env.DB, auth.userId, uploadId);
  if (!upload) {
    return jsonError("Upload not found", "UPLOAD_NOT_FOUND", requestId, 404);
  }

  const object = await getUploadBinary(c.env, upload.storage_key);
  if (!object.found) {
    const storageDisabled = object.reason === "storage_disabled";
    const storageMissing = object.reason === "missing_bucket";
    return jsonError(
      storageDisabled
        ? "Binary upload storage is disabled for this environment"
        : storageMissing
          ? "Upload storage is not configured"
          : "Upload file not found",
      storageDisabled
        ? "UPLOAD_STORAGE_DISABLED"
        : storageMissing
          ? "R2_NOT_CONFIGURED"
          : "UPLOAD_FILE_NOT_FOUND",
      requestId,
      storageDisabled || storageMissing ? 503 : 404,
    );
  }

  return new Response(object.object.body, {
    status: 200,
    headers: {
      "content-type": object.object.httpMetadata?.contentType || upload.mime_type || "application/octet-stream",
      "content-disposition": `inline; filename="${upload.original_filename}"`,
    },
  });
});

uploadsRouter.post("/process", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = uploadProcessInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid upload process payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const result = await processUploadTransactions(c.env.DB, auth.userId, body.data);
    if (!result || !result.upload) {
      return jsonError("Upload not found", "UPLOAD_NOT_FOUND", requestId, 404);
    }

    return c.json(uploadProcessResultSchema.parse(result));
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      return jsonError("One or more transactions already exist for this month", "TRANSACTION_CONFLICT", requestId, 409);
    }
    throw error;
  }
});

export default uploadsRouter;
