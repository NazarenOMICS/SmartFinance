import { Hono } from "hono";
import { updateSettingInputSchema } from "@smartfinance/contracts";
import { getSettingsObject, upsertSetting } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const settingsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

settingsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  return c.json(await getSettingsObject(c.env.DB, auth.userId));
});

settingsRouter.put("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = updateSettingInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid settings payload", "VALIDATION_ERROR", requestId, 400);
  }

  return c.json(
    await upsertSetting(c.env.DB, auth.userId, body.data.key, body.data.value),
  );
});

settingsRouter.post("/refresh-rates", async (c) => {
  const auth = c.get("auth");
  const settings = await getSettingsObject(c.env.DB, auth.userId);

  const nextSettings = {
    effective_exchange_rate_usd_uyu: settings.manual_exchange_rate_usd_uyu || settings.exchange_rate_usd_uyu || "42.5",
    effective_exchange_rate_eur_uyu: settings.manual_exchange_rate_eur_uyu || settings.exchange_rate_eur_uyu || "46.5",
    effective_exchange_rate_ars_uyu: settings.manual_exchange_rate_ars_uyu || settings.exchange_rate_ars_uyu || "0.045",
    exchange_rate_source: settings.exchange_rate_mode === "manual" ? "manual_override" : "manual_refresh",
    exchange_rate_updated_at: new Date().toISOString(),
    exchange_rate_fetch_error: "",
  };

  for (const [key, value] of Object.entries(nextSettings)) {
    await upsertSetting(c.env.DB, auth.userId, key, value);
  }

  return c.json({
    ok: true,
    source: nextSettings.exchange_rate_source,
    settings: await getSettingsObject(c.env.DB, auth.userId),
  });
});

export default settingsRouter;
