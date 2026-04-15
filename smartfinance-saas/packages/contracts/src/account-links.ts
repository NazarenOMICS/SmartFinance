import { z } from "zod";
import { accountCurrencySchema } from "./accounts";

export const accountLinkSchema = z.object({
  id: z.number().int().positive(),
  account_a_id: z.string(),
  account_b_id: z.string(),
  relation_type: z.string(),
  preferred_currency: accountCurrencySchema.nullable().optional(),
  reconciled_pairs: z.number().int().nonnegative().default(0),
  last_reconciled_at: z.string().nullable().optional(),
  account_a_name: z.string().nullable().optional(),
  account_b_name: z.string().nullable().optional(),
  account_a_currency: accountCurrencySchema.nullable().optional(),
  account_b_currency: accountCurrencySchema.nullable().optional(),
  created_at: z.string(),
});

export const createAccountLinkInputSchema = z.object({
  account_a_id: z.string().min(1),
  account_b_id: z.string().min(1),
  preferred_currency: accountCurrencySchema.optional().or(z.literal("")).optional(),
});

export const reconcileAccountLinkResponseSchema = z.object({
  reconciled_pairs: z.number().int().nonnegative(),
  link: accountLinkSchema,
});

export type AccountLink = z.infer<typeof accountLinkSchema>;
export type CreateAccountLinkInput = z.infer<typeof createAccountLinkInputSchema>;
export type ReconcileAccountLinkResponse = z.infer<typeof reconcileAccountLinkResponseSchema>;
