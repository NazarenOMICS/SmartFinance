import { z } from "zod";

export const planCodeSchema = z.enum(["free", "pro_monthly", "pro_yearly"]);

export const subscriptionSummarySchema = z.object({
  plan_code: planCodeSchema,
  status: z.enum(["inactive", "active", "past_due", "trialing"]),
  is_paid: z.boolean(),
});

export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;
