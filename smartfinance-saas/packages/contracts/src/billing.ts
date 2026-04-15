import { z } from "zod";

export const planCodeSchema = z.enum(["free", "pro_monthly", "pro_yearly"]);

export const subscriptionSummarySchema = z.object({
  plan_code: planCodeSchema,
  status: z.enum(["inactive", "active", "past_due", "trialing"]),
  is_paid: z.boolean(),
});

export const checkoutSessionInputSchema = z.object({
  plan_code: planCodeSchema.exclude(["free"]),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

export const checkoutSessionResponseSchema = z.object({
  url: z.string().url(),
});

export const billingPortalInputSchema = z.object({
  return_url: z.string().url().optional(),
});

export const billingPortalResponseSchema = z.object({
  url: z.string().url(),
});

export const stripeWebhookAckSchema = z.object({
  received: z.boolean(),
  duplicate: z.boolean().optional(),
});

export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;
