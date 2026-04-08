import { Hono } from "hono";
import { createInstallmentInputSchema, installmentCommitmentSchema, installmentSchema, monthStringSchema, updateInstallmentInputSchema } from "@smartfinance/contracts";
import { createInstallment, deleteInstallment, getInstallmentCommitments, listInstallments, updateInstallment } from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const installmentsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

installmentsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const installments = await listInstallments(c.env.DB, auth.userId);
  return c.json(installments.map((item) => installmentSchema.parse(item)));
});

installmentsRouter.get("/commitments", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedStart = monthStringSchema.safeParse(c.req.query("start"));
  const months = Number(c.req.query("months") || "6");
  if (!parsedStart.success || !Number.isInteger(months) || months < 1 || months > 24) {
    return jsonError("Valid start and months query params are required", "VALIDATION_ERROR", requestId, 400);
  }

  const commitments = await getInstallmentCommitments(c.env.DB, auth.userId, parsedStart.data, months);
  return c.json(commitments.map((item) => installmentCommitmentSchema.parse(item)));
});

installmentsRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = createInstallmentInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid installment payload", "VALIDATION_ERROR", requestId, 400);
  }

  const installment = await createInstallment(c.env.DB, auth.userId, body.data);
  return c.json(installmentSchema.parse(installment), 201);
});

installmentsRouter.put("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const installmentId = Number(c.req.param("id"));
  if (!Number.isInteger(installmentId) || installmentId < 1) {
    return jsonError("Invalid installment id", "VALIDATION_ERROR", requestId, 400);
  }

  const body = updateInstallmentInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid installment payload", "VALIDATION_ERROR", requestId, 400);
  }

  const installment = await updateInstallment(c.env.DB, auth.userId, installmentId, body.data);
  if (!installment) {
    return jsonError("Installment not found", "INSTALLMENT_NOT_FOUND", requestId, 404);
  }

  return c.json(installmentSchema.parse(installment));
});

installmentsRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const installmentId = Number(c.req.param("id"));
  if (!Number.isInteger(installmentId) || installmentId < 1) {
    return jsonError("Invalid installment id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await deleteInstallment(c.env.DB, auth.userId, installmentId);
  if (!result.deleted) {
    return jsonError("Installment not found", "INSTALLMENT_NOT_FOUND", requestId, 404);
  }

  return c.json({ deleted: true });
});

export default installmentsRouter;
