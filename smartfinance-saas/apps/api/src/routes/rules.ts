import { Hono } from "hono";
import { amountProfileListResponseSchema, amountProfileRebuildResponseSchema, createRuleInputSchema, ruleInsightSchema, ruleMutationResponseSchema, ruleSchema, transactionSchema, updateRuleInputSchema } from "@smartfinance/contracts";
import { applyRuleRetroactively, applyRuleRetroactivelyJob, buildRuleInsights, createRule, deleteRule, disableAmountProfile, listAmountProfiles, listRuleCandidates, listRules, rebuildAmountProfiles, updateRule } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { enhanceRuleInsightsWithAi } from "../services/ai";
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

rulesRouter.get("/insights", async (c) => {
  const auth = c.get("auth");
  const insights = await enhanceRuleInsightsWithAi(c.env, await buildRuleInsights(c.env.DB, auth.userId));
  return c.json(insights.map((insight) => ruleInsightSchema.parse(insight)));
});

rulesRouter.get("/amount-profiles", async (c) => {
  const auth = c.get("auth");
  const profiles = await listAmountProfiles(c.env.DB, auth.userId);
  return c.json(amountProfileListResponseSchema.parse({ profiles }));
});

rulesRouter.post("/amount-profiles/rebuild", async (c) => {
  const auth = c.get("auth");
  const result = await rebuildAmountProfiles(c.env.DB, auth.userId);
  return c.json(amountProfileRebuildResponseSchema.parse(result));
});

rulesRouter.post("/amount-profiles/:id/disable", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const profileId = Number(c.req.param("id"));
  if (!Number.isInteger(profileId) || profileId < 1) {
    return jsonError("Invalid amount profile id", "VALIDATION_ERROR", requestId, 400);
  }
  const profiles = await disableAmountProfile(c.env.DB, auth.userId, profileId);
  return c.json(amountProfileListResponseSchema.parse({ profiles }));
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

rulesRouter.post("/:id/apply-retroactively", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const ruleId = Number(c.req.param("id"));
  if (!Number.isInteger(ruleId) || ruleId < 1) {
    return jsonError("Invalid rule id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await applyRuleRetroactivelyJob(c.env.DB, auth.userId, ruleId);
  return c.json({
    job_id: result.job_id,
    status: result.status,
    total_count: result.affected_transactions,
    processed_count: result.affected_transactions,
    updated_transactions: result.affected_transactions,
    categorized_count: result.categorized_transactions,
    suggested_count: result.suggested_transactions,
  }, 202);
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
  const deletableRules = rules.filter((rule) => rule.source !== "seed");
  await Promise.all(deletableRules.map((rule) => deleteRule(c.env.DB, auth.userId, Number(rule.id))));
  const remainingRules = await listRules(c.env.DB, auth.userId);

  return c.json({
    deleted_count: deletableRules.length,
    rules_count: remainingRules.length,
  });
});

export default rulesRouter;
