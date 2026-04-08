import { z } from "zod";
import { monthStringSchema } from "./transactions";

export const savingsProjectionPointSchema = z.object({
  month: monthStringSchema,
  real: z.number().nullable(),
  projected: z.number().nullable(),
  goal: z.number().nullable(),
});

export const savingsProjectionSchema = z.object({
  currency: z.string(),
  average_monthly_savings: z.number(),
  commitments: z.array(z.object({
    month: monthStringSchema,
    total: z.number(),
  })),
  series: z.array(savingsProjectionPointSchema),
});

export const savingsInsightsSchema = z.object({
  currency: z.string(),
  growth: z.object({
    category: z.string(),
    delta_pct: z.number(),
    current_amount: z.number(),
    previous_amount: z.number(),
  }).nullable(),
  daily_average_spend: z.number(),
  budget_per_day: z.number(),
  remaining_budget: z.number(),
  days_left: z.number().int().nonnegative(),
  budget_exhausted: z.boolean(),
  eta_months: z.number().int().positive().nullable(),
});

export const recurringExpenseSchema = z.object({
  desc_banco: z.string(),
  moneda: z.string(),
  avg_amount: z.number(),
  occurrences: z.number().int().nonnegative(),
  months_seen: z.array(monthStringSchema),
  category_name: z.string().nullable(),
  category_color: z.string().nullable().optional(),
});

export const categoryTrendPointSchema = z.object({
  month: monthStringSchema,
  byCategory: z.record(z.string(), z.number()),
});

export type SavingsProjection = z.infer<typeof savingsProjectionSchema>;
export type SavingsInsights = z.infer<typeof savingsInsightsSchema>;
export type RecurringExpense = z.infer<typeof recurringExpenseSchema>;
