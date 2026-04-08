import { z } from "zod";
import { accountCurrencySchema } from "./accounts";

export const monthStringSchema = z.string().regex(/^\d{4}-\d{2}$/);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const categorizationStatusSchema = z.enum(["uncategorized", "suggested", "categorized"]);

export const transactionSchema = z.object({
  id: z.number(),
  period: monthStringSchema,
  fecha: isoDateSchema,
  desc_banco: z.string(),
  desc_usuario: z.string().nullable(),
  monto: z.number(),
  moneda: accountCurrencySchema,
  category_id: z.number().nullable(),
  account_id: z.string().nullable(),
  entry_type: z.string(),
  movement_kind: z.string(),
  categorization_status: categorizationStatusSchema,
  category_source: z.string().nullable(),
  category_confidence: z.number().nullable(),
  category_rule_id: z.number().nullable(),
  category_name: z.string().nullable().optional(),
  category_type: z.string().nullable().optional(),
  category_color: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  es_cuota: z.number().int().optional(),
  installment_id: z.number().nullable().optional(),
  paired_transaction_id: z.number().nullable().optional(),
  account_link_id: z.number().nullable().optional(),
  internal_group_id: z.string().nullable().optional(),
  internal_operation_kind: z.string().nullable().optional(),
  internal_operation_target_transaction_id: z.number().nullable().optional(),
  internal_operation_from_account_id: z.string().nullable().optional(),
  internal_operation_from_account_name: z.string().nullable().optional(),
  internal_operation_from_currency: z.string().nullable().optional(),
  internal_operation_to_account_id: z.string().nullable().optional(),
  internal_operation_to_account_name: z.string().nullable().optional(),
  internal_operation_to_currency: z.string().nullable().optional(),
  internal_operation_effective_rate: z.number().nullable().optional(),
  suggested_category_id: z.number().nullable().optional(),
  suggested_category_name: z.string().nullable().optional(),
  suggestion_source: z.string().nullable().optional(),
  suggestion_reason: z.string().nullable().optional(),
  proposed_new_category: z.object({
    name: z.string(),
    type: z.string().optional(),
    color: z.string().nullable().optional(),
  }).nullable().optional(),
  created_at: z.string(),
});

export const createTransactionInputSchema = z.object({
  fecha: isoDateSchema,
  desc_banco: z.string().min(1),
  desc_usuario: z.string().optional(),
  monto: z.number(),
  moneda: accountCurrencySchema.default("UYU"),
  category_id: z.number().nullable().optional(),
  account_id: z.string().optional(),
  entry_type: z.enum(["expense", "income", "internal_transfer"]).default("expense"),
  target_account_id: z.string().optional(),
  target_amount: z.number().optional(),
  fee_amount: z.number().optional(),
});

export const updateTransactionInputSchema = z.object({
  desc_usuario: z.string().nullable().optional(),
  category_id: z.number().nullable().optional(),
  account_id: z.string().nullable().optional(),
  fecha: isoDateSchema.optional(),
  monto: z.number().optional(),
});

export const transactionSummarySchema = z.object({
  month: monthStringSchema,
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  transaction_count: z.number().int().nonnegative(),
});

export const transactionMonthlyEvolutionPointSchema = z.object({
  month: monthStringSchema,
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  transaction_count: z.number().int().nonnegative(),
});

export const transactionBatchDecisionInputSchema = z.object({
  transaction_ids: z.array(z.number().int().positive()).min(1),
});

export const transactionBatchAssignCategoryInputSchema = z.object({
  transaction_ids: z.array(z.number().int().positive()).min(1),
  category_id: z.number().int().positive(),
});

export const transactionBatchResultSchema = z.object({
  processed: z.number().int().nonnegative(),
  transactions: z.array(transactionSchema),
});

export const transactionMovementKindInputSchema = z.object({
  kind: z.string().min(1),
});

export const transactionBatchImportInputSchema = z.object({
  account_id: z.string().optional(),
  period: monthStringSchema.optional(),
  transactions: z.array(createTransactionInputSchema).min(1),
});

export const pendingGuidedReviewInputSchema = z.object({
  transaction_ids: z.array(z.number().int().positive()).optional(),
  month: monthStringSchema.optional(),
  account_id: z.string().nullable().optional(),
});

export const transactionCategoryDecisionInputSchema = z.object({
  transaction_ids: z.array(z.number().int().positive()).min(1),
  category_id: z.number().int().positive(),
  rule_id: z.number().int().positive().nullable().optional(),
  origin: z.string().optional(),
});

export const transactionCategoryRejectionInputSchema = z.object({
  transaction_id: z.number().int().positive(),
  rule_id: z.number().int().positive().nullable().optional(),
  origin: z.string().optional(),
});

export const transactionUndoConfirmInputSchema = z.object({
  transaction_id: z.number().int().positive(),
  category_id: z.number().int().positive().nullable().optional(),
  origin: z.string().optional(),
});

export const transactionInternalOperationInputSchema = z.object({
  kind: z.string().min(1),
  source_transaction_id: z.number().int().positive(),
  target_transaction_id: z.number().int().positive().nullable().optional(),
  from_account_id: z.string().nullable().optional(),
  to_account_id: z.string().nullable().optional(),
  effective_rate: z.number().nullable().optional(),
});

export const transactionInternalOperationRejectInputSchema = z.object({
  source_transaction_id: z.number().int().positive(),
});

export const importReviewStateSchema = z.object({
  review_groups: z.array(z.unknown()),
  guided_review_groups: z.array(z.unknown()),
  transaction_review_queue: z.array(transactionSchema),
  guided_onboarding_required: z.boolean(),
  remaining_transaction_ids: z.array(z.number().int().positive()),
});

export type Transaction = z.infer<typeof transactionSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;
export type TransactionSummary = z.infer<typeof transactionSummarySchema>;
export type TransactionMonthlyEvolutionPoint = z.infer<typeof transactionMonthlyEvolutionPointSchema>;
export type TransactionBatchResult = z.infer<typeof transactionBatchResultSchema>;
