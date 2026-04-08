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

export default settingsRouter;

