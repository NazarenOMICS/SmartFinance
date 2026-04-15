import { z } from "zod";
import { monthStringSchema } from "./transactions";

export const assistantChatInputSchema = z.object({
  month: monthStringSchema,
  question: z.string().trim().min(1).max(2000),
});

export const assistantChatResponseSchema = z.object({
  answer: z.string(),
  provider: z.string(),
  model: z.string().nullable().optional(),
  fallback_used: z.boolean().default(false),
});

export type AssistantChatInput = z.infer<typeof assistantChatInputSchema>;
export type AssistantChatResponse = z.infer<typeof assistantChatResponseSchema>;
