import { z } from "zod";

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal("api"),
  env: z.string(),
  request_id: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
