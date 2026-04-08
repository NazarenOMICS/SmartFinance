import { z } from "zod";
import { monthStringSchema } from "./transactions";

export const installmentSchema = z.object({
  id: z.number().int().positive(),
  descripcion: z.string(),
  monto_total: z.number(),
  cantidad_cuotas: z.number().int().positive(),
  cuota_actual: z.number().int().positive(),
  monto_cuota: z.number(),
  account_id: z.string().nullable().optional(),
  account_name: z.string().nullable().optional(),
  account_currency: z.string().nullable().optional(),
  start_month: monthStringSchema.nullable().optional(),
  created_at: z.string(),
});

export const createInstallmentInputSchema = z.object({
  descripcion: z.string().min(1),
  monto_total: z.number().positive(),
  cantidad_cuotas: z.number().int().positive(),
  account_id: z.string().optional(),
  start_month: monthStringSchema.optional(),
});

export const updateInstallmentInputSchema = z.object({
  cuota_actual: z.number().int().positive().optional(),
});

export const installmentCommitmentSchema = z.object({
  month: monthStringSchema,
  total: z.number(),
});

export type Installment = z.infer<typeof installmentSchema>;
export type CreateInstallmentInput = z.infer<typeof createInstallmentInputSchema>;
export type UpdateInstallmentInput = z.infer<typeof updateInstallmentInputSchema>;
export type InstallmentCommitment = z.infer<typeof installmentCommitmentSchema>;
