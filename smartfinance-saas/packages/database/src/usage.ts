import { getDefaultPlanCode, getPlanDefinition } from "@smartfinance/domain";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";

export async function getSubscriptionSnapshot(db: D1DatabaseLike, userId: string) {
  const row = await firstRow<{
    plan_code: string;
    status: "inactive" | "active" | "past_due" | "trialing";
  }>(
    db,
    "SELECT plan_code, status FROM subscriptions WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const planCode = row?.plan_code ?? getDefaultPlanCode();
  const definition = getPlanDefinition(planCode);

  return {
    plan_code: definition.code,
    status: row?.status ?? "inactive",
    is_paid: definition.isPaid,
    definition,
  };
}

export async function getUsageSnapshot(db: D1DatabaseLike, userId: string) {
  const subscription = await getSubscriptionSnapshot(db, userId);
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const [accountsRow, uploadsRow, ocrRow, aiRow] = await Promise.all([
    allRows<{ count: number }>(
      db,
      "SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?",
      [userId]
    ),
    allRows<{ count: number }>(
      db,
      "SELECT COUNT(*) AS count FROM uploads WHERE user_id = ? AND substr(created_at, 1, 7) = ?",
      [userId, currentPeriod]
    ),
    allRows<{ value: number }>(
      db,
      "SELECT COALESCE(value, 0) AS value FROM usage_counters WHERE user_id = ? AND metric = ? AND period = ? LIMIT 1",
      [userId, "ocr_pages", currentPeriod]
    ),
    allRows<{ value: number }>(
      db,
      "SELECT COALESCE(value, 0) AS value FROM usage_counters WHERE user_id = ? AND metric = ? AND period = ? LIMIT 1",
      [userId, "ai_requests", currentPeriod]
    ),
  ]);

  return {
    subscription: {
      plan_code: subscription.plan_code,
      status: subscription.status,
      is_paid: subscription.is_paid,
    },
    capabilities: {
      exports_enabled: subscription.definition.capabilities.exportsEnabled,
      ai_assisted_imports: subscription.definition.capabilities.aiAssistedImports,
    },
    usage: {
      accounts: {
        used: Number(accountsRow[0]?.count || 0),
        limit: subscription.definition.limits.accounts,
      },
      uploads_this_month: {
        used: Number(uploadsRow[0]?.count || 0),
        limit: subscription.definition.limits.uploadsPerMonth,
      },
      ocr_pages_this_month: {
        used: Number(ocrRow[0]?.value || 0),
        limit: subscription.definition.limits.ocrPagesPerMonth,
      },
      ai_requests_this_month: {
        used: Number(aiRow[0]?.value || 0),
        limit: subscription.definition.limits.aiRequestsPerMonth,
      },
      max_upload_size_mb: subscription.definition.limits.maxUploadSizeMb,
    },
  };
}

export async function incrementUsageCounter(
  db: D1DatabaseLike,
  userId: string,
  metric: string,
  amount = 1,
  period = new Date().toISOString().slice(0, 7),
) {
  await runStatement(
    db,
    `
      INSERT INTO usage_counters (user_id, metric, period, value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, metric, period)
      DO UPDATE SET value = usage_counters.value + excluded.value
    `,
    [userId, metric, period, amount],
  );
}
