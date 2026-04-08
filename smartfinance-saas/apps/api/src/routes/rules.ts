import { Hono } from "hono";
import { createRuleInputSchema, ruleMutationResponseSchema, ruleSchema, transactionSchema, updateRuleInputSchema } from "@smartfinance/contracts";
import { applyRuleRetroactively, createRule, deleteRule, listRuleCandidates, listRules, updateRule } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const rulesRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

rulesRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const rules = await listRules(c.env.DB, auth.userId);
  return c.json(rules.map((rule) => ruleSchema.parse(rule)));
});

rulesRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createRuleInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid rule payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const rule = await createRule(c.env.DB, auth.userId, body.data);
    const application = rule ? await applyRuleRetroactively(c.env.DB, auth.userId, rule.id) : {
      affected_transactions: 0,
      categorized_transactions: 0,
      suggested_transactions: 0,
    };
    return c.json(ruleMutationResponseSchema.parse({ rule, application }), 201);
  } catch {
    return jsonError("Rule already exists", "RULE_CONFLICT", requestId, 409);
  }
});

rulesRouter.put("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const ruleId = Number(c.req.param("id"));
  if (!Number.isInteger(ruleId) || ruleId < 1) {
    return jsonError("Invalid rule id", "VALIDATION_ERROR", requestId, 400);
  }

  const body = updateRuleInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid rule payload", "VALIDATION_ERROR", requestId, 400);
  }

  const rule = await updateRule(c.env.DB, auth.userId, ruleId, body.data);
  if (!rule) {
    return jsonError("Rule not found", "RULE_NOT_FOUND", requestId, 404);
  }

  const application = body.data.apply_to_pending === false
    ? { affected_transactions: 0, categorized_transactions: 0, suggested_transactions: 0 }
    : await applyRuleRetroactively(c.env.DB, auth.userId, rule.id);

  return c.json(ruleMutationResponseSchema.parse({ rule, application }));
});

rulesRouter.get("/:id/candidates", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const ruleId = Number(c.req.param("id"));
  if (!Number.isInteger(ruleId) || ruleId < 1) {
    return jsonError("Invalid rule id", "VALIDATION_ERROR", requestId, 400);
  }

  const candidates = await listRuleCandidates(c.env.DB, auth.userId, ruleId);
  return c.json(candidates.map((candidate) => transactionSchema.parse(candidate)));
});

rulesRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const ruleId = Number(c.req.param("id"));
  if (!Number.isInteger(ruleId) || ruleId < 1) {
    return jsonError("Invalid rule id", "VALIDATION_ERROR", requestId, 400);
  }

  await deleteRule(c.env.DB, auth.userId, ruleId);
  return new Response(null, { status: 204 });
});

rulesRouter.post("/reset", async (c) => {
  const auth = c.get("auth");
  const rules = await listRules(c.env.DB, auth.userId);
  await Promise.all(rules.map((rule) => deleteRule(c.env.DB, auth.userId, Number(rule.id))));
  return c.json({
    deleted_count: rules.length,
    rules_count: 0,
  });
});

export default rulesRouter;
