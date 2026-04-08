import { Hono } from "hono";
import {
  createTransactionInputSchema,
  monthStringSchema,
  transactionBatchAssignCategoryInputSchema,
  transactionBatchDecisionInputSchema,
  transactionBatchResultSchema,
  transactionMonthlyEvolutionPointSchema,
  transactionSummarySchema,
  transactionSchema,
  updateTransactionInputSchema,
} from "@smartfinance/contracts";
import {
  acceptSuggestedTransaction,
  acceptSuggestedTransactions,
  assignCategoryToTransactions,
  createTransaction,
  deleteTransaction,
  getTransactionMonthlyEvolution,
  getTransactionSummary,
  listPendingTransactionsByMonth,
  listTransactionsByMonth,
  findMatchingRule,
  rejectSuggestedTransaction,
  rejectSuggestedTransactions,
  rejectRuleForDescription,
  syncRuleFromCategorizedDescription,
  updateTransaction,
} from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";

const transactionsRouter = new Hono<{
  Bindings: ApiBindings;
  Variables: ApiVariables;
}>();

transactionsRouter.get("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const rows = await listTransactionsByMonth(c.env.DB, auth.userId, parsedMonth.data);
  return c.json(rows.map((row) => transactionSchema.parse(row)));
});

transactionsRouter.get("/summary", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const summary = await getTransactionSummary(c.env.DB, auth.userId, parsedMonth.data);
  return c.json(transactionSummarySchema.parse(summary));
});

transactionsRouter.get("/pending", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("month"));
  if (!parsedMonth.success) {
    return jsonError("month query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const rows = await listPendingTransactionsByMonth(c.env.DB, auth.userId, parsedMonth.data);
  return c.json(rows.map((row) => transactionSchema.parse(row)));
});

transactionsRouter.get("/monthly-evolution", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedMonth = monthStringSchema.safeParse(c.req.query("end"));
  const parsedMonths = Number(c.req.query("months") || "6");
  if (!parsedMonth.success || !Number.isInteger(parsedMonths) || parsedMonths < 1 || parsedMonths > 24) {
    return jsonError("Valid end and months query params are required", "VALIDATION_ERROR", requestId, 400);
  }

  const rows = await getTransactionMonthlyEvolution(c.env.DB, auth.userId, parsedMonths, parsedMonth.data);
  return c.json(rows.map((row) => transactionMonthlyEvolutionPointSchema.parse(row)));
});

transactionsRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = createTransactionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid transaction payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const transaction = await createTransaction(c.env.DB, auth.userId, parsedBody.data);
    return c.json(transactionSchema.parse(transaction), 201);
  } catch {
    return jsonError("Transaction already exists for this month", "TRANSACTION_CONFLICT", requestId, 409);
  }
});

transactionsRouter.put("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const parsedBody = updateTransactionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid transaction payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const transaction = await updateTransaction(c.env.DB, auth.userId, transactionId, parsedBody.data);
    if (!transaction) {
      return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
    }

    const parsedTransaction = transactionSchema.parse(transaction);

    if (parsedBody.data.category_id !== undefined && parsedTransaction.category_id !== null) {
      const conflictingRule = await findMatchingRule(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });
      if (conflictingRule && conflictingRule.category_id !== parsedTransaction.category_id) {
        await rejectRuleForDescription(c.env.DB, auth.userId, conflictingRule.id, parsedTransaction.desc_banco);
      }

      await syncRuleFromCategorizedDescription(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        categoryId: parsedTransaction.category_id,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });
    }

    return c.json(parsedTransaction);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      return jsonError("Transaction already exists for this month", "TRANSACTION_CONFLICT", requestId, 409);
    }
    throw error;
  }
});

transactionsRouter.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await deleteTransaction(c.env.DB, auth.userId, transactionId);
  if (!result.deleted) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return new Response(null, { status: 204 });
});

transactionsRouter.post("/:id/accept-suggestion", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await acceptSuggestedTransaction(c.env.DB, auth.userId, transactionId);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json(transactionSchema.parse(transaction));
});

transactionsRouter.post("/:id/reject-suggestion", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await rejectSuggestedTransaction(c.env.DB, auth.userId, transactionId);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json(transactionSchema.parse(transaction));
});

transactionsRouter.post("/review/accept", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = transactionBatchDecisionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid review payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transactions = await acceptSuggestedTransactions(c.env.DB, auth.userId, parsedBody.data.transaction_ids);
  return c.json(transactionBatchResultSchema.parse({
    processed: transactions.length,
    transactions,
  }));
});

transactionsRouter.post("/review/reject", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = transactionBatchDecisionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid review payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transactions = await rejectSuggestedTransactions(c.env.DB, auth.userId, parsedBody.data.transaction_ids);
  return c.json(transactionBatchResultSchema.parse({
    processed: transactions.length,
    transactions,
  }));
});

transactionsRouter.post("/review/assign-category", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = transactionBatchAssignCategoryInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid review payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transactions = await assignCategoryToTransactions(
    c.env.DB,
    auth.userId,
    parsedBody.data.transaction_ids,
    parsedBody.data.category_id,
  );

  for (const transaction of transactions) {
    const parsedTransaction = transactionSchema.parse(transaction);
    if (parsedTransaction.category_id !== null) {
      const conflictingRule = await findMatchingRule(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });
      if (conflictingRule && conflictingRule.category_id !== parsedTransaction.category_id) {
        await rejectRuleForDescription(c.env.DB, auth.userId, conflictingRule.id, parsedTransaction.desc_banco);
      }

      await syncRuleFromCategorizedDescription(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        categoryId: parsedTransaction.category_id,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });
    }
  }

  return c.json(transactionBatchResultSchema.parse({
    processed: transactions.length,
    transactions,
  }));
});

export default transactionsRouter;
