import { z } from "zod";

export const settingsSchema = z.record(z.string(), z.string());

export const updateSettingInputSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});

export const refreshRatesResponseSchema = z.object({
  ok: z.boolean(),
  source: z.string(),
  settings: settingsSchema,
});

export type SettingsMap = z.infer<typeof settingsSchema>;
export type UpdateSettingInput = z.infer<typeof updateSettingInputSchema>;
export type RefreshRatesResponse = z.infer<typeof refreshRatesResponseSchema>;
