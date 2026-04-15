import { Hono } from "hono";
import { assistantChatInputSchema, assistantChatResponseSchema } from "@smartfinance/contracts";
import {
  getConsolidatedAccounts,
  getRecurringExpenses,
  getSavingsInsights,
  getTransactionSummary,
  getUsageSnapshot,
  incrementUsageCounter,
} from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { log } from "@smartfinance/observability";
import { buildDeterministicAssistantAnswer, generateAssistantAnswer } from "../services/ai";
import { jsonError } from "../utils/http";

const assistantRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

assistantRouter.post("/chat", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = assistantChatInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid assistant payload", "VALIDATION_ERROR", requestId, 400);
  }

  const [summary, savings, recurring, netWorth] = await Promise.all([
    getTransactionSummary(c.env.DB, auth.userId, parsedBody.data.month),
    getSavingsInsights(c.env.DB, auth.userId, parsedBody.data.month),
    getRecurringExpenses(c.env.DB, auth.userId, parsedBody.data.month),
    getConsolidatedAccounts(c.env.DB, auth.userId),
  ]);
  const usage = await getUsageSnapshot(c.env.DB, auth.userId);

  const context = {
    month: parsedBody.data.month,
    question: parsedBody.data.question,
    summary: {
      income: Number(summary.totals?.income || 0),
      expenses: Number(summary.totals?.expenses || 0),
      margin: Number(summary.totals?.margin || 0),
      pending_count: Number(summary.pending_count || 0),
      top_categories: (summary.byCategory || [])
        .slice(0, 3)
        .map((item) => ({ name: String(item.name || "Sin categoria"), spent: Number(item.spent || 0) })),
    },
    savings: {
      eta_months: savings.eta_months,
      remaining_budget: Number(savings.remaining_budget || 0),
      budget_per_day: Number(savings.budget_per_day || 0),
      daily_average_spend: Number(savings.daily_average_spend || 0),
    },
    recurring: recurring.slice(0, 3).map((item) => ({
      desc_banco: item.desc_banco,
      avg_amount: Number(item.avg_amount || 0),
      moneda: item.moneda,
    })),
    net_worth: {
      total: Number(netWorth.total || 0),
      currency: netWorth.currency,
    },
  };

  const aiLimitReached = usage.usage.ai_requests_this_month.used >= usage.usage.ai_requests_this_month.limit;
  const answer = aiLimitReached
    ? buildDeterministicAssistantAnswer(context)
    : await generateAssistantAnswer(c.env, context);

  if (!answer.fallback_used) {
    await incrementUsageCounter(c.env.DB, auth.userId, "ai_requests", 1);
  }

  log("info", "assistant.response.generated", {
    request_id: requestId,
    user_id: auth.userId,
    month: parsedBody.data.month,
    provider: answer.provider,
    model: answer.model || null,
    fallback_used: answer.fallback_used,
    ai_limit_reached: aiLimitReached,
  });

  return c.json(assistantChatResponseSchema.parse(answer));
});

export default assistantRouter;
