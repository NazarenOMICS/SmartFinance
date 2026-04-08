import { Hono } from "hono";
import { subscriptionSummarySchema } from "@smartfinance/contracts";
import { getSubscriptionSnapshot } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";

const billingRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

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

export default billingRouter;
