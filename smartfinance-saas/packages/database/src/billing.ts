import { firstRow, runStatement, type D1DatabaseLike } from "./client";

type SubscriptionRow = {
  user_id: string;
  plan_code: string;
  status: "inactive" | "active" | "past_due" | "trialing";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

export async function hasProcessedStripeWebhookEvent(db: D1DatabaseLike, eventId: string) {
  const row = await firstRow<{ event_id: string }>(
    db,
    "SELECT event_id FROM stripe_webhook_events WHERE event_id = ? LIMIT 1",
    [eventId],
  );
  return Boolean(row?.event_id);
}

export async function recordStripeWebhookEvent(
  db: D1DatabaseLike,
  input: {
    eventId: string;
    eventType: string;
    userId?: string | null;
    stripeCustomerId?: string | null;
  },
) {
  await runStatement(
    db,
    `
      INSERT INTO stripe_webhook_events (event_id, event_type, user_id, stripe_customer_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `,
    [
      input.eventId,
      input.eventType,
      input.userId ?? null,
      input.stripeCustomerId ?? null,
    ],
  );
}

export async function getSubscriptionRecord(db: D1DatabaseLike, userId: string) {
  return firstRow<SubscriptionRow>(
    db,
    `
      SELECT user_id, plan_code, status, stripe_customer_id, stripe_subscription_id
      FROM subscriptions
      WHERE user_id = ?
      LIMIT 1
    `,
    [userId],
  );
}

export async function ensureSubscriptionRecord(db: D1DatabaseLike, userId: string) {
  await runStatement(
    db,
    `
      INSERT INTO subscriptions (user_id, plan_code, status)
      VALUES (?, 'free', 'inactive')
      ON CONFLICT(user_id) DO NOTHING
    `,
    [userId],
  );
  return getSubscriptionRecord(db, userId);
}

export async function setStripeCustomerId(db: D1DatabaseLike, userId: string, stripeCustomerId: string) {
  await ensureSubscriptionRecord(db, userId);
  await runStatement(
    db,
    `
      UPDATE subscriptions
      SET stripe_customer_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [stripeCustomerId, userId],
  );
  return getSubscriptionRecord(db, userId);
}

export async function updateSubscriptionFromStripe(
  db: D1DatabaseLike,
  input: {
    userId?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    planCode?: string | null;
    status?: "inactive" | "active" | "past_due" | "trialing" | null;
  },
) {
  let userId = input.userId || null;
  if (!userId && input.stripeCustomerId) {
    const byCustomer = await firstRow<{ user_id: string }>(
      db,
      "SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1",
      [input.stripeCustomerId],
    );
    userId = byCustomer?.user_id || null;
  }
  if (!userId) return null;

  await ensureSubscriptionRecord(db, userId);
  await runStatement(
    db,
    `
      UPDATE subscriptions
      SET
        plan_code = COALESCE(?, plan_code),
        status = COALESCE(?, status),
        stripe_customer_id = COALESCE(?, stripe_customer_id),
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `,
    [
      input.planCode ?? null,
      input.status ?? null,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      userId,
    ],
  );
  return getSubscriptionRecord(db, userId);
}
