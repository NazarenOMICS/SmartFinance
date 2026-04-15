import { z } from "zod";
import { monthStringSchema } from "./transactions";
import { booleanishSchema } from "./common";

export const uploadSourceSchema = z.enum(["web", "mobile", "import"]);
export const uploadStatusSchema = z.enum(["pending", "uploaded", "processing", "processed", "needs_review"]);
export const uploadPreviewSourceSchema = z.enum(["text", "csv"]);

export const uploadSchema = z.object({
  id: z.number(),
  period: monthStringSchema,
  account_id: z.string().nullable(),
  original_filename: z.string(),
  storage_key: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int().nonnegative(),
  tx_count: z.number().int().nonnegative(),
  source: uploadSourceSchema,
  status: uploadStatusSchema,
  parser: z.string().nullable().optional(),
  detected_format: z.string().nullable().optional(),
  parse_failure_reason: z.string().nullable().optional(),
  ai_assisted: booleanishSchema.optional(),
  ai_provider: z.string().nullable().optional(),
  ai_model: z.string().nullable().optional(),
  extracted_candidates: z.number().int().nonnegative().optional(),
  duplicates_skipped: z.number().int().nonnegative().optional(),
  auto_categorized_count: z.number().int().nonnegative().optional(),
  suggested_count: z.number().int().nonnegative().optional(),
  pending_review_count: z.number().int().nonnegative().optional(),
  unmatched_count: z.number().int().nonnegative().optional(),
  created_at: z.string(),
});

export const createUploadIntentInputSchema = z.object({
  original_filename: z.string().min(1),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
  period: monthStringSchema,
  account_id: z.string().optional(),
  source: uploadSourceSchema.default("web"),
});

export const uploadIntentSchema = z.object({
  upload: uploadSchema,
  upload_url: z.string().nullable(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
  max_upload_size_mb: z.number().int().positive(),
});

export const uploadImportedTransactionInputSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  desc_banco: z.string().min(1),
  monto: z.number(),
  moneda: z.enum(["UYU", "USD", "EUR", "ARS"]).default("UYU"),
  desc_usuario: z.string().optional(),
  entry_type: z.enum(["expense", "income"]).optional(),
});

export const uploadProcessInputSchema = z.object({
  upload_id: z.number().int().positive(),
  transactions: z.array(uploadImportedTransactionInputSchema).min(1),
});

export const uploadProcessResultSchema = z.object({
  upload: uploadSchema,
  created: z.number().int().nonnegative(),
  duplicates_skipped: z.number().int().nonnegative(),
  auto_categorized: z.number().int().nonnegative(),
  suggested: z.number().int().nonnegative(),
  pending_review: z.number().int().nonnegative(),
  review_groups: z.array(z.record(z.unknown())).default([]),
  guided_review_groups: z.array(z.record(z.unknown())).default([]),
  transaction_review_queue: z.array(z.record(z.unknown())).default([]),
  guided_onboarding_required: z.boolean().default(false),
  remaining_transaction_ids: z.array(z.number()).default([]),
});

export const uploadPreviewInputSchema = z.object({
  period: monthStringSchema,
  source_type: uploadPreviewSourceSchema,
  content: z.string().min(1),
});

export const uploadPreviewResultSchema = z.object({
  transactions: z.array(uploadImportedTransactionInputSchema),
  unmatched: z.array(z.string()),
  detected_format: z.string().nullable().optional(),
  totals: z.object({
    parsed: z.number().int().nonnegative(),
    unmatched: z.number().int().nonnegative(),
  }),
});

export type Upload = z.infer<typeof uploadSchema>;
export type CreateUploadIntentInput = z.infer<typeof createUploadIntentInputSchema>;
export type UploadIntent = z.infer<typeof uploadIntentSchema>;
export type UploadProcessInput = z.infer<typeof uploadProcessInputSchema>;
export type UploadProcessResult = z.infer<typeof uploadProcessResultSchema>;
export type UploadPreviewInput = z.infer<typeof uploadPreviewInputSchema>;
export type UploadPreviewResult = z.infer<typeof uploadPreviewResultSchema>;
