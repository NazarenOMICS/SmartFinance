import { Hono } from "hono";
import { createAccountInputSchema, updateAccountInputSchema } from "@smartfinance/contracts";
import { createAccount, deleteAccount, deleteAccountCascade, getConsolidatedAccounts, getUsageSnapshot, listAccountsWithLinks, updateAccount } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const accountsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

accountsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  return c.json(await listAccountsWithLinks(c.env.DB, auth.userId));
});

accountsRouter.get("/consolidated", async (c) => {
  const auth = c.get("auth");
  return c.json(await getConsolidatedAccounts(c.env.DB, auth.userId));
});

accountsRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createAccountInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid account payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const usage = await getUsageSnapshot(c.env.DB, auth.userId);
    if (usage.usage.accounts.used >= usage.usage.accounts.limit) {
      return jsonError("Account limit reached for current plan", "ACCOUNT_LIMIT_REACHED", requestId, 409);
    }
    const account = await createAccount(c.env.DB, auth.userId, body.data);
    return c.json(account, 201);
  } catch {
    return jsonError("Account already exists", "ACCOUNT_CONFLICT", requestId, 409);
  }
});

accountsRouter.put("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = updateAccountInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid account payload", "VALIDATION_ERROR", requestId, 400);
  }

  const account = await updateAccount(c.env.DB, auth.userId, c.req.param("id"), body.data);
  if (!account) {
    return jsonError("Account not found", "ACCOUNT_NOT_FOUND", requestId, 404);
  }

  return c.json(account);
});

accountsRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const force = c.req.query("force") === "true";
  const result = force
    ? await deleteAccountCascade(c.env.DB, auth.userId, c.req.param("id"))
    : await deleteAccount(c.env.DB, auth.userId, c.req.param("id"));

  if (!result.deleted) {
    return jsonError("Account cannot be deleted yet", result.reason, requestId, 409);
  }

  return new Response(null, { status: 204 });
});

export default accountsRouter;
