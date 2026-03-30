import { Hono } from "hono";
import { getSettingsObject, normalizeSettingValue, upsertSetting } from "../db.js";
import { refreshExchangeRates } from "../services/exchange-rates.js";

const router = new Hono();

router.get("/", async (c) => {
  const userId = c.get("userId");
  return c.json(await getSettingsObject(c.env, userId));
});

router.put("/", async (c) => {
  const userId = c.get("userId");
  const { key, value } = await c.req.json();
  if (!key) return c.json({ error: "key is required" }, 400);
  const normalizedValue = normalizeSettingValue(key, value);
  await upsertSetting(c.env, key, normalizedValue, userId);
  return c.json({ key, value: normalizedValue });
});

router.post("/refresh-rates", async (c) => {
  const result = await refreshExchangeRates(c.env);
  if (!result) {
    return c.json({ error: "No se pudieron actualizar las tasas de cambio." }, 502);
  }

  return c.json({
    source: result.source,
    exchange_rate_usd_uyu: result.usd_uyu,
    exchange_rate_eur_uyu: result.eur_uyu,
    exchange_rate_ars_uyu: result.ars_uyu,
    updated: result.updated_at,
  });
});

export default router;
