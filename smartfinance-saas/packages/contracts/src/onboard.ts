import { z } from "zod";

export const onboardResponseSchema = z.object({
  request_id: z.string(),
  bootstrapped: z.boolean(),
  seeded_categories: z.number().int().nonnegative(),
  seeded_rules: z.number().int().nonnegative(),
  seeded_settings: z.number().int().nonnegative(),
  status: z.enum(["created", "existing"]).optional(),
});

export type OnboardResponse = z.infer<typeof onboardResponseSchema>;
