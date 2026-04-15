import { Hono } from "hono";
import {
  billingPortalInputSchema,
  billingPortalResponseSchema,
  checkoutSessionInputSchema,
  checkoutSessionResponseSchema,
  stripeWebhookAckSchema,
  subscriptionSummarySchema,
} from "@smartfinance/contracts";
import {
  ensureSubscriptionRecord,
  getSubscriptionRecord,
  getSubscriptionSnapshot,
  hasProcessedStripeWebhookEvent,
  recordStripeWebhookEvent,
  setStripeCustomerId,
  updateSubscriptionFromStripe,
} from "@smartfinance/database";
import { log } from "@smartfinance/observability";
import type { ApiBindings, ApiVariables } from "../env";
import { getRuntimeEnv } from "../env";
import { jsonError } from "../utils/http";

const billingRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

type StripeFormValue = string | number | boolean | null | undefined;

function isStripeConfigured(env: ApiBindings) {
  const runtime = getRuntimeEnv(env);
  return Boolean(runtime.STRIPE_SECRET_KEY);
}

function getBaseUrl(env: ApiBindings) {
  const runtime = getRuntimeEnv(env);
  return runtime.APP_BASE_URL || "https://smartfinance-saas-web.pages.dev";
}

function encodeStripeForm(values: Record<string, StripeFormValue>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value == null) continue;
    body.set(key, String(value));
  }
  return body;
}

async function stripeRequest<T = Record<string, unknown>>(
  env: ApiBindings,
  path: string,
  body: Record<string, StripeFormValue>,
): Promise<T> {
  const runtime = getRuntimeEnv(env);
  if (!runtime.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured");
  }

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encodeStripeForm(body),
  });

  const payload = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Stripe request failed (${response.status})`);
  }
  return payload;
}

async function verifyStripeSignature(env: ApiBindings, rawBody: string, signature: string | null) {
  const runtime = getRuntimeEnv(env);
  if (!runtime.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe webhook secret is not configured");
  }
  if (!signature) {
    throw new Error("Missing Stripe signature");
  }

  const parts = Object.fromEntries(
    signature.split(",").map((chunk) => {
      const [key, value] = chunk.split("=");
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) {
    throw new Error("Invalid Stripe signature header");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(runtime.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const actual = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected) {
    throw new Error("Stripe signature invalid");
  }
}

billingRouter.get("/subscription", async (c) => {
  const auth = c.get("auth");
  const subscription = await getSubscriptionSnapshot(c.env.DB, auth.userId);

  return c.json(
    subscriptionSummarySchema.parse({
      plan_code: subscription.plan_code,
      status: subscription.status,
      is_paid: subscription.is_paid,
    }),
  );
});

billingRouter.post("/checkout", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = checkoutSessionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid checkout payload", "VALIDATION_ERROR", requestId, 400);
  }
  if (!isStripeConfigured(c.env)) {
    return jsonError("Stripe is not configured", "BILLING_UNAVAILABLE", requestId, 503);
  }

  const runtime = getRuntimeEnv(c.env);
  const priceId = parsedBody.data.plan_code === "pro_yearly"
    ? runtime.STRIPE_PRICE_PRO_YEARLY
    : runtime.STRIPE_PRICE_PRO_MONTHLY;
  if (!priceId) {
    return jsonError("Stripe price is not configured", "BILLING_MISCONFIGURED", requestId, 503);
  }

  const ensured = await ensureSubscriptionRecord(c.env.DB, auth.userId);
  let customerId = ensured?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await stripeRequest<{ id: string }>(c.env, "customers", {
      metadata: JSON.stringify({ user_id: auth.userId }),
      "metadata[user_id]": auth.userId,
    });
    customerId = customer.id;
    await setStripeCustomerId(c.env.DB, auth.userId, customerId);
  }

  const baseUrl = getBaseUrl(c.env);
  const checkout = await stripeRequest<{ url: string }>(c.env, "checkout/sessions", {
    mode: "subscription",
    customer: customerId,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": 1,
    success_url: parsedBody.data.success_url || `${baseUrl}/billing/success`,
    cancel_url: parsedBody.data.cancel_url || `${baseUrl}/billing/cancel`,
    "metadata[user_id]": auth.userId,
  });

  log("info", "billing.checkout.created", {
    request_id: requestId,
    user_id: auth.userId,
    plan_code: parsedBody.data.plan_code,
    stripe_customer_id: customerId,
  });

  return c.json(checkoutSessionResponseSchema.parse({ url: checkout.url }));
});

billingRouter.post("/portal", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = billingPortalInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsedBody.success) {
    return jsonError("Invalid portal payload", "VALIDATION_ERROR", requestId, 400);
  }
  if (!isStripeConfigured(c.env)) {
    return jsonError("Stripe is not configured", "BILLING_UNAVAILABLE", requestId, 503);
  }

  const subscription = await getSubscriptionRecord(c.env.DB, auth.userId);
  if (!subscription?.stripe_customer_id) {
    return jsonError("No Stripe customer found", "BILLING_CUSTOMER_NOT_FOUND", requestId, 404);
  }

  const portal = await stripeRequest<{ url: string }>(c.env, "billing_portal/sessions", {
    customer: subscription.stripe_customer_id,
    return_url: parsedBody.data.return_url || getBaseUrl(c.env),
  });
  log("info", "billing.portal.created", {
    request_id: requestId,
    user_id: auth.userId,
    stripe_customer_id: subscription.stripe_customer_id,
  });
  return c.json(billingPortalResponseSchema.parse({ url: portal.url }));
});

billingRouter.post("/webhooks/stripe", async (c) => {
  const requestId = c.get("requestId");
  const rawBody = await c.req.text();
  try {
    await verifyStripeSignature(c.env, rawBody, c.req.header("Stripe-Signature") || null);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid webhook", "WEBHOOK_INVALID", requestId, 401);
  }

  const event = JSON.parse(rawBody) as {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  if (!event.id) {
    return jsonError("Stripe event id missing", "WEBHOOK_INVALID", requestId, 400);
  }

  if (await hasProcessedStripeWebhookEvent(c.env.DB, event.id)) {
    log("info", "billing.webhook.duplicate", {
      request_id: requestId,
      event_id: event.id,
      event_type: String(event.type || "unknown"),
    });
    return c.json(stripeWebhookAckSchema.parse({ received: true, duplicate: true }));
  }

  const object = event.data?.object || {};

  const metadataUserId = typeof object.metadata === "object" && object.metadata
    ? String((object.metadata as Record<string, unknown>).user_id || "")
    : "";
  const customerId = typeof object.customer === "string" ? object.customer : null;
  const subscriptionId = typeof object.id === "string" && String(event.type || "").startsWith("customer.subscription")
    ? object.id
    : typeof object.subscription === "string"
      ? object.subscription
      : null;

  const items = (object as { items?: { data?: Array<{ price?: { id?: string } }> } }).items;
  const linePrice = Array.isArray(items?.data)
    ? items?.data?.[0]?.price?.id || null
    : null;

  const runtime = getRuntimeEnv(c.env);
  const nextPlanCode =
    linePrice === runtime.STRIPE_PRICE_PRO_YEARLY
      ? "pro_yearly"
      : linePrice === runtime.STRIPE_PRICE_PRO_MONTHLY
        ? "pro_monthly"
        : String(event.type || "").includes("deleted")
          ? "free"
          : null;

  const nextStatus = String(event.type || "").includes("deleted")
    ? "inactive"
    : object.status === "active" || object.status === "trialing" || object.status === "past_due"
      ? object.status as "active" | "trialing" | "past_due"
      : null;

  await updateSubscriptionFromStripe(c.env.DB, {
    userId: metadataUserId || null,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    planCode: nextPlanCode,
    status: nextStatus,
  });
  await recordStripeWebhookEvent(c.env.DB, {
    eventId: event.id,
    eventType: String(event.type || "unknown"),
    userId: metadataUserId || null,
    stripeCustomerId: customerId,
  });

  log("info", "billing.webhook.processed", {
    request_id: requestId,
    event_id: event.id,
    event_type: String(event.type || "unknown"),
    user_id: metadataUserId || null,
    stripe_customer_id: customerId,
    next_plan_code: nextPlanCode,
    next_status: nextStatus,
  });

  return c.json(stripeWebhookAckSchema.parse({ received: true }));
});

export default billingRouter;
