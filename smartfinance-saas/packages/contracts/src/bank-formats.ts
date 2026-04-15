import { z } from "zod";

export const bankFormatSchema = z.object({
  id: z.number().int().positive(),
  format_key: z.string(),
  bank_name: z.string().nullable().optional(),
  col_fecha: z.number().int(),
  col_desc: z.number().int(),
  col_debit: z.number().int(),
  col_credit: z.number().int(),
  col_monto: z.number().int(),
  created_at: z.string(),
  updated_at: z.string().nullable().optional(),
});

export const upsertBankFormatInputSchema = z.object({
  format_key: z.string().min(1),
  bank_name: z.string().nullable().optional(),
  col_fecha: z.number().int().default(-1),
  col_desc: z.number().int().default(-1),
  col_debit: z.number().int().default(-1),
  col_credit: z.number().int().default(-1),
  col_monto: z.number().int().default(-1),
});

export const bankFormatSuggestionInputSchema = z.object({
  format_key: z.string().min(1).optional(),
  columns: z.array(z.string()).min(1),
  sample_rows: z.array(z.array(z.string())).default([]),
  account_currency: z.string().nullable().optional(),
});

export const bankFormatSuggestionSchema = z.object({
  format_key: z.string().nullable().optional(),
  bank_name: z.string().nullable().optional(),
  col_fecha: z.number().int().default(-1),
  col_desc: z.number().int().default(-1),
  col_debit: z.number().int().default(-1),
  col_credit: z.number().int().default(-1),
  col_monto: z.number().int().default(-1),
  confidence: z.number().min(0).max(1).default(0),
  provider: z.string(),
  model: z.string().nullable().optional(),
  fallback_used: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

export type BankFormat = z.infer<typeof bankFormatSchema>;
export type UpsertBankFormatInput = z.infer<typeof upsertBankFormatInputSchema>;
export type BankFormatSuggestionInput = z.infer<typeof bankFormatSuggestionInputSchema>;
export type BankFormatSuggestion = z.infer<typeof bankFormatSuggestionSchema>;
