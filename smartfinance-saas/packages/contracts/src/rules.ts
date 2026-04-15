import { z } from "zod";
import { accountCurrencySchema } from "./accounts";

export const ruleModeSchema = z.enum(["auto", "suggest", "disabled"]);
export const ruleDirectionSchema = z.enum(["any", "expense", "income"]);
export const ruleSourceSchema = z.enum(["manual", "seed", "learned", "guided"]);

export const ruleSchema = z.object({
  id: z.number(),
  pattern: z.string(),
  normalized_pattern: z.string(),
  category_id: z.number().nullable(),
  category_name: z.string().nullable(),
  match_count: z.number().int().nonnegative(),
  mode: ruleModeSchema,
  confidence: z.number().min(0).max(1),
  source: ruleSourceSchema,
  account_id: z.string().nullable(),
  merchant_scope: z.string().optional(),
  account_scope: z.string().optional(),
  currency_scope: z.string().optional(),
  currency: accountCurrencySchema.nullable(),
  direction: ruleDirectionSchema,
  merchant_key: z.string().nullable(),
  last_matched_at: z.string().nullable(),
  created_at: z.string(),
});

export const createRuleInputSchema = z.object({
  pattern: z.string().min(1),
  category_id: z.number().int().positive(),
  mode: ruleModeSchema.default("suggest"),
  confidence: z.number().min(0).max(1).default(0.82),
  source: ruleSourceSchema.default("manual"),
  account_id: z.string().optional(),
  currency: accountCurrencySchema.optional(),
  direction: ruleDirectionSchema.default("any"),
});

export const updateRuleInputSchema = z.object({
  category_id: z.number().int().positive().optional(),
  mode: ruleModeSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  apply_to_pending: z.boolean().optional(),
});

export const ruleApplicationSummarySchema = z.object({
  affected_transactions: z.number().int().nonnegative(),
  categorized_transactions: z.number().int().nonnegative(),
  suggested_transactions: z.number().int().nonnegative(),
});

export const ruleInsightSchema = z.object({
  kind: z.enum(["duplicate_scope", "overlap", "weak_auto"]),
  title: z.string(),
  description: z.string(),
  rule_ids: z.array(z.number().int().positive()).min(1),
  recommended_action: z.enum(["merge", "disable", "lower_to_suggest", "review"]),
  priority: z.enum(["high", "medium", "low"]),
});

export const amountProfileSchema = z.object({
  id: z.number(),
  counterparty_key: z.string(),
  normalized_pattern: z.string(),
  category_id: z.number(),
  category_name: z.string().nullable().optional(),
  account_id: z.string().nullable(),
  currency: accountCurrencySchema,
  direction: ruleDirectionSchema,
  amount_median: z.number(),
  amount_min: z.number(),
  amount_max: z.number(),
  amount_p25: z.number().nullable().optional(),
  amount_p75: z.number().nullable().optional(),
  sample_count: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  status: z.enum(["active", "disabled"]),
  last_seen_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const amountProfileListResponseSchema = z.object({
  profiles: z.array(amountProfileSchema),
});

export const amountProfileRebuildResponseSchema = z.object({
  rebuilt_count: z.number().int().nonnegative(),
  profiles: z.array(amountProfileSchema),
});

export const ruleMutationResponseSchema = z.object({
  rule: ruleSchema,
  application: ruleApplicationSummarySchema,
});

export const resetRulesResponseSchema = z.object({
  deleted_count: z.number().int().nonnegative(),
  rules_count: z.number().int().nonnegative(),
});

export type Rule = z.infer<typeof ruleSchema>;
export type CreateRuleInput = z.infer<typeof createRuleInputSchema>;
export type UpdateRuleInput = z.infer<typeof updateRuleInputSchema>;
export type RuleMutationResponse = z.infer<typeof ruleMutationResponseSchema>;
export type RuleInsight = z.infer<typeof ruleInsightSchema>;
export type ResetRulesResponse = z.infer<typeof resetRulesResponseSchema>;
export type AmountProfile = z.infer<typeof amountProfileSchema>;
