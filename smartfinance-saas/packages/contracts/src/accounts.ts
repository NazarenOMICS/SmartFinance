import { z } from "zod";

export const accountCurrencySchema = z.enum(["UYU", "USD", "EUR", "ARS"]);

export const accountSchema = z.object({
  id: z.string(),
  name: z.string(),
  currency: accountCurrencySchema,
  balance: z.number(),
  opening_balance: z.number(),
  created_at: z.string(),
});

export const createAccountInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  currency: accountCurrencySchema,
  balance: z.number().default(0),
  opening_balance: z.number().optional(),
});

export const updateAccountInputSchema = z.object({
  name: z.string().min(1).optional(),
  balance: z.number().optional(),
  opening_balance: z.number().optional(),
});

export type Account = z.infer<typeof accountSchema>;
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

