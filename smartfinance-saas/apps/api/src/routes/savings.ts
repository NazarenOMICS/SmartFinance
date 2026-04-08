import { Hono } from "hono";
import { monthStringSchema, savingsInsightsSchema, savingsProjectionSchema } from "@smartfinance/contracts";
import { getSavingsInsights, getSavingsProjection } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const savingsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

savingsRouter.get("/projection", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedEnd = monthStringSchema.safeParse(c.req.query("end"));
  const months = Number(c.req.query("months") || "12");
  if (!parsedEnd.success || !Number.isInteger(months) || months < 1 || months > 24) {
    return jsonError("Valid end and months query params are required", "VALIDATION_ERROR", requestId, 400);
  }

  const projection = await getSavingsProjection(c.env.DB, auth.userId, parsedEnd.data, months);
  return c.json(savingsProjectionSchema.parse(projection));
});

savingsRouter.get("/insights", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const insights = await getSavingsInsights(c.env.DB, auth.userId, parsedMonth.data);
  return c.json(savingsInsightsSchema.parse(insights));
});

export default savingsRouter;
