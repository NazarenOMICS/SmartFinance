import { Hono } from "hono";
import { onboardResponseSchema } from "@smartfinance/contracts";
import { ensureUserBootstrap, getSettingsObject, upsertSetting } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";

const onboardRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

onboardRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const result = await ensureUserBootstrap(c.env.DB, auth.userId);
  const settings = await getSettingsObject(c.env.DB, auth.userId);
  const status = settings.guided_categorization_onboarding_completed === "1" || settings.guided_categorization_onboarding_skipped === "1"
    ? "existing"
    : "created";

  return c.json(
    onboardResponseSchema.parse({
      request_id: c.get("requestId"),
      bootstrapped: true,
      seeded_categories: result.seededCategories,
      seeded_rules: result.seededRules,
      seeded_settings: result.seededSettings,
      status,
    }),
  );
});

onboardRouter.post("/claim-legacy", async (c) => {
  return c.json({ ok: false, claimed: false });
});

onboardRouter.post("/guided-categorization/complete", async (c) => {
  const auth = c.get("auth");
  await upsertSetting(c.env.DB, auth.userId, "guided_categorization_onboarding_completed", "1");
  await upsertSetting(c.env.DB, auth.userId, "guided_categorization_onboarding_skipped", "0");
  return c.json({ ok: true, settings: await getSettingsObject(c.env.DB, auth.userId) });
});

onboardRouter.post("/guided-categorization/skip", async (c) => {
  const auth = c.get("auth");
  await upsertSetting(c.env.DB, auth.userId, "guided_categorization_onboarding_completed", "0");
  await upsertSetting(c.env.DB, auth.userId, "guided_categorization_onboarding_skipped", "1");
  return c.json({ ok: true, settings: await getSettingsObject(c.env.DB, auth.userId) });
});

export default onboardRouter;
