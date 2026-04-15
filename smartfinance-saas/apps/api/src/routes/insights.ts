import { Hono } from "hono";
import { categoryTrendPointSchema, monthStringSchema, recurringExpenseSchema } from "@smartfinance/contracts";
import { getLegacyCategoryTrend, getRecurringExpenses, listCategories } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { suggestRecurringCategoriesWithAi } from "../services/ai";
import { jsonError } from "../utils/http";

const insightsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

insightsRouter.get("/recurring", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const [recurring, categories] = await Promise.all([
    getRecurringExpenses(c.env.DB, auth.userId, parsedMonth.data),
    listCategories(c.env.DB, auth.userId),
  ]);
  const suggestions = await suggestRecurringCategoriesWithAi(c.env, {
    recurring,
    categories: categories.map((category) => ({
      id: Number(category.id),
      name: String(category.name),
      color: category.color == null ? null : String(category.color),
    })),
  });
  const suggestionByDescription = new Map(
    suggestions.map((item) => [String(item.desc_banco), item]),
  );

  return c.json(
    recurring.map((item) => recurringExpenseSchema.parse({
      ...item,
      ...(suggestionByDescription.get(String(item.desc_banco)) || {}),
    })),
  );
});

insightsRouter.get("/category-trend", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedEnd = monthStringSchema.safeParse(c.req.query("end"));
  const months = Number(c.req.query("months") || "4");
  if (!parsedEnd.success || !Number.isInteger(months) || months < 1 || months > 24) {
    return jsonError("Valid end and months query params are required", "VALIDATION_ERROR", requestId, 400);
  }

  const trend = await getLegacyCategoryTrend(c.env.DB, auth.userId, parsedEnd.data, months);
  return c.json(trend.map((point) => categoryTrendPointSchema.parse(point)));
});

export default insightsRouter;
