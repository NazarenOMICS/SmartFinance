import { Hono } from "hono";
import { usageResponseSchema } from "@smartfinance/contracts";
import { getUsageSnapshot } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";

const usageRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

usageRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const usage = await getUsageSnapshot(c.env.DB, auth.userId);

  return c.json(
    usageResponseSchema.parse({
      ...usage,
      request_id: c.get("requestId"),
    }),
  );
});

export default usageRouter;
