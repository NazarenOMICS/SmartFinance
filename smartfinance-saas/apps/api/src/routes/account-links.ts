import { Hono } from "hono";
import { accountLinkSchema, createAccountLinkInputSchema } from "@smartfinance/contracts";
import { createAccountLink, deleteAccountLink, listAccountLinks, reconcileAccountLink } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const accountLinksRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

accountLinksRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const links = await listAccountLinks(c.env.DB, auth.userId);
  return c.json(links.map((link) => accountLinkSchema.parse(link)));
});

accountLinksRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createAccountLinkInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid account link payload", "VALIDATION_ERROR", requestId, 400);
  }
  if (body.data.account_a_id === body.data.account_b_id) {
    return jsonError("Accounts must be different", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const link = await createAccountLink(c.env.DB, auth.userId, body.data);
    return c.json(accountLinkSchema.parse(link), 201);
  } catch (error) {
    if (error instanceof Error && error.message.includes("exist")) {
      return jsonError("Linked accounts must exist", "ACCOUNT_NOT_FOUND", requestId, 404);
    }
    return jsonError("Account link already exists", "ACCOUNT_LINK_CONFLICT", requestId, 409);
  }
});

accountLinksRouter.post("/:id/reconcile", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const linkId = Number(c.req.param("id"));
  if (!Number.isInteger(linkId) || linkId < 1) {
    return jsonError("Invalid account link id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await reconcileAccountLink(c.env.DB, auth.userId, linkId);
  if (!result) {
    return jsonError("Account link not found", "ACCOUNT_LINK_NOT_FOUND", requestId, 404);
  }

  return c.json({
    reconciled_pairs: result.reconciled_pairs,
    link: accountLinkSchema.parse(result.link),
  });
});

accountLinksRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const linkId = Number(c.req.param("id"));
  if (!Number.isInteger(linkId) || linkId < 1) {
    return jsonError("Invalid account link id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await deleteAccountLink(c.env.DB, auth.userId, linkId);
  if (!result.deleted) {
    return jsonError("Account link not found", "ACCOUNT_LINK_NOT_FOUND", requestId, 404);
  }

  return c.json({ deleted: true });
});

export default accountLinksRouter;
