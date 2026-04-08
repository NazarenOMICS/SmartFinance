import { Hono } from "hono";
import { onboardResponseSchema } from "@smartfinance/contracts";
import { ensureUserBootstrap } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";

const onboardRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

onboardRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const result = await ensureUserBootstrap(c.env.DB, auth.userId);

  return c.json(
    onboardResponseSchema.parse({
      request_id: c.get("requestId"),
      bootstrapped: true,
      seeded_categories: result.seededCategories,
      seeded_rules: result.seededRules,
      seeded_settings: result.seededSettings,
    }),
  );
});

export default onboardRouter;
