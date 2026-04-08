import { z } from "zod";

export const schemaStatusSchema = z.object({
  ok: z.boolean(),
  expected_version: z.string(),
  current_version: z.string().nullable(),
  blocking_reason: z.string().nullable(),
  request_id: z.string(),
});

export type SchemaStatus = z.infer<typeof schemaStatusSchema>;
