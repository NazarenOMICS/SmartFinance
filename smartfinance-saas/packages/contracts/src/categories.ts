import { z } from "zod";

export const categoryTypeSchema = z.enum(["fixed", "variable"]);

export const categorySchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  type: categoryTypeSchema,
  budget: z.number(),
  color: z.string().nullable(),
  sort_order: z.number(),
  created_at: z.string(),
});

export const createCategoryInputSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  type: categoryTypeSchema.default("variable"),
  budget: z.number().default(0),
  color: z.string().optional(),
  sort_order: z.number().int().default(0),
});

export const updateCategoryInputSchema = z.object({
  slug: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: categoryTypeSchema.optional(),
  budget: z.number().optional(),
  color: z.string().nullable().optional(),
  sort_order: z.number().int().optional(),
});

export type Category = z.infer<typeof categorySchema>;
export type CreateCategoryInput = z.infer<typeof createCategoryInputSchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>;

