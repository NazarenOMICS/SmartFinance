import { z } from "zod";
import { accountCurrencySchema } from "./accounts";
import { booleanishSchema } from "./common";

export const monthStringSchema = z.string().regex(/^\d{4}-\d{2}$/);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const categorizationStatusSchema = z.enum(["uncategorized", "suggested", "categorized", "parse_failed", "rule_rejected"]);

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
  merchant_key: z.string().nullable().optional(),
  parse_quality: z.string().nullable().optional(),
  rule_skipped_reason: z.string().nullable().optional(),
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
  counts_in_metrics: z.boolean().optional(),
  suggested_category_id: z.number().nullable().optional(),
  suggested_category_name: z.string().nullable().optional(),
  suggestion_source: z.string().nullable().optional(),
  suggestion_reason: z.string().nullable().optional(),
  amount_profile_id: z.number().nullable().optional(),
  counterparty_key: z.string().nullable().optional(),
  amount_similarity: z.number().nullable().optional(),
  historical_median: z.number().nullable().optional(),
  historical_sample_count: z.number().int().nonnegative().nullable().optional(),
  conflict_candidates: z.array(z.unknown()).optional(),
  ai_audited: z.boolean().optional(),
  ai_reason: z.string().nullable().optional(),
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
  rule_scope: z.enum(["account", "global"]).optional(),
});

export const transactionSummarySchema = z.object({
  month: monthStringSchema,
  income: z.number(),
  expenses: z.number(),
  net: z.number(),
  transaction_count: z.number().int().nonnegative(),
  currency: accountCurrencySchema,
  pending_count: z.number().int().nonnegative(),
  totals: z.object({
    income: z.number(),
    expenses: z.number(),
    net: z.number(),
    margin: z.number(),
    installments: z.number(),
    savings_monthly_target: z.number(),
  }),
  deltas: z.object({
    income: z.number(),
    expenses: z.number(),
  }),
  byCategory: z.array(z.object({
    id: z.number(),
    name: z.string(),
    slug: z.string().nullable().optional(),
    spent: z.number(),
    budget: z.number(),
    color: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })),
  byType: z.object({
    fijo: z.number(),
    variable: z.number(),
  }),
  budgets: z.array(z.object({
    id: z.number(),
    category_id: z.number(),
    name: z.string(),
    spent: z.number(),
    budget: z.number(),
    color: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
  })),
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
  rule_scope: z.enum(["account", "global"]).optional(),
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
  rule_scope: z.enum(["account", "global"]).optional(),
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

export const transactionBatchImportResultSchema = importReviewStateSchema.extend({
  upload_id: z.number().int().positive().optional(),
  created: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  duplicates_skipped: z.number().int().nonnegative().optional(),
  auto_categorized: z.number().int().nonnegative().optional(),
  suggested: z.number().int().nonnegative().optional(),
  pending_review: z.number().int().nonnegative().optional(),
  unmatched_count: z.number().int().nonnegative().optional(),
  errors: z.number().int().nonnegative(),
  parser: z.string().optional(),
  ai_assisted: booleanishSchema.optional(),
  ai_provider: z.string().nullable().optional(),
  ai_model: z.string().nullable().optional(),
  extracted_candidates: z.number().int().nonnegative().optional(),
  guided_onboarding_session: z.unknown().nullable().optional(),
}).passthrough();

export const transactionCategoryConfirmResponseSchema = z.object({
  confirmed: z.number().int().nonnegative(),
  transactions: z.array(transactionSchema),
});

export type Transaction = z.infer<typeof transactionSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;
export type TransactionSummary = z.infer<typeof transactionSummarySchema>;
export type TransactionMonthlyEvolutionPoint = z.infer<typeof transactionMonthlyEvolutionPointSchema>;
export type TransactionBatchResult = z.infer<typeof transactionBatchResultSchema>;
export type TransactionBatchImportResult = z.infer<typeof transactionBatchImportResultSchema>;
