import { z } from "zod";

export const booleanishSchema = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  return value;
}, z.boolean());

export const errorResponseSchema = z.object({
  error: z.string(),
  code: z.string(),
  request_id: z.string(),
});

export const deletedResponseSchema = z.object({
  deleted: z.boolean(),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
export type DeletedResponse = z.infer<typeof deletedResponseSchema>;
