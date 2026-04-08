import { z } from "zod";
import { subscriptionSummarySchema } from "./billing";

export const usageMetricSchema = z.object({
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});

export const usageResponseSchema = z.object({
  request_id: z.string(),
  subscription: subscriptionSummarySchema,
  capabilities: z.object({
    exports_enabled: z.boolean(),
    ai_assisted_imports: z.boolean(),
  }),
  usage: z.object({
    accounts: usageMetricSchema,
    uploads_this_month: usageMetricSchema,
    ocr_pages_this_month: usageMetricSchema,
    max_upload_size_mb: z.number().positive(),
  }),
});

export type UsageResponse = z.infer<typeof usageResponseSchema>;
