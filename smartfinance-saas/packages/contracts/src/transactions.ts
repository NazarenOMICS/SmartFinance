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
  entry_type: z.enum(["expense", "income"]).default("expense"),
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

export type Transaction = z.infer<typeof transactionSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionInputSchema>;
export type UpdateTransactionInput = z.infer<typeof updateTransactionInputSchema>;
export type TransactionSummary = z.infer<typeof transactionSummarySchema>;
export type TransactionMonthlyEvolutionPoint = z.infer<typeof transactionMonthlyEvolutionPointSchema>;
export type TransactionBatchResult = z.infer<typeof transactionBatchResultSchema>;
