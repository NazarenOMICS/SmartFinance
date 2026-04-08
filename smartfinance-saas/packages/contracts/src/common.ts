import { z } from "zod";

export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  request_id: z.string(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
