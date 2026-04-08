import { Hono } from "hono";
import {
  createTransactionInputSchema,
  importReviewStateSchema,
  monthStringSchema,
  pendingGuidedReviewInputSchema,
  transactionCategoryDecisionInputSchema,
  transactionCategoryRejectionInputSchema,
  transactionBatchAssignCategoryInputSchema,
  transactionBatchImportInputSchema,
  transactionBatchDecisionInputSchema,
  transactionBatchResultSchema,
  transactionInternalOperationInputSchema,
  transactionInternalOperationRejectInputSchema,
  transactionMovementKindInputSchema,
  transactionMonthlyEvolutionPointSchema,
  transactionSchema,
  transactionUndoConfirmInputSchema,
  updateTransactionInputSchema,
} from "@smartfinance/contracts";
import {
  acceptSuggestedTransaction,
  acceptSuggestedTransactions,
  assignCategoryToTransactions,
  batchCreateTransactions,
  buildImportReviewState,
  confirmCategorySelection,
  confirmInternalOperation,
  createTransaction,
  deleteTransaction,
  getTransactionMonthlyEvolution,
  getTransactionSummary,
  listCandidateTransactions,
  listPendingTransactionsByMonth,
  listTransactionsByMonth,
  markTransactionMovement,
  rejectCategorySelection,
  rejectInternalOperation,
  findMatchingRule,
  rejectSuggestedTransaction,
  rejectSuggestedTransactions,
  rejectRuleForDescription,
  searchTransactions,
  syncRuleFromCategorizedDescription,
  undoConfirmCategorySelection,
  undoRejectCategorySelection,
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
  return c.json(summary);
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

transactionsRouter.get("/search", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const query = String(c.req.query("q") || "").trim();
  const limit = Number(c.req.query("limit") || "20");
  if (query.length < 2 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return jsonError("Valid q and limit query params are required", "VALIDATION_ERROR", requestId, 400);
  }

  const transactions = await searchTransactions(c.env.DB, auth.userId, query, limit);
  return c.json(transactions.map((transaction) => transactionSchema.parse(transaction)));
});

transactionsRouter.get("/candidates", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const pattern = String(c.req.query("pattern") || "").trim();
  if (!pattern) {
    return jsonError("pattern query param is required", "VALIDATION_ERROR", requestId, 400);
  }

  const candidates = await listCandidateTransactions(c.env.DB, auth.userId, pattern);
  return c.json(candidates.map((candidate) => transactionSchema.parse(candidate)));
});

transactionsRouter.post("/", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = createTransactionInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid transaction payload", "VALIDATION_ERROR", requestId, 400);
  }

  try {
    const transaction = parsedBody.data.entry_type === "internal_transfer"
      ? await (async () => {
          const source = await createTransaction(c.env.DB, auth.userId, {
            ...parsedBody.data,
            entry_type: "expense",
            monto: Math.abs(parsedBody.data.monto),
          });
          if (!source) return null;
          await confirmInternalOperation(c.env.DB, auth.userId, {
            kind: parsedBody.data.target_account_id && parsedBody.data.account_id && parsedBody.data.target_account_id !== parsedBody.data.account_id ? "fx_exchange" : "internal_transfer",
            source_transaction_id: Number(source.id),
            from_account_id: parsedBody.data.account_id ?? null,
            to_account_id: parsedBody.data.target_account_id ?? null,
            effective_rate: parsedBody.data.target_amount && parsedBody.data.monto
              ? Math.abs(Number(parsedBody.data.monto)) / Math.max(Math.abs(Number(parsedBody.data.target_amount)), 0.0001)
              : null,
          });
          return source;
        })()
      : await createTransaction(c.env.DB, auth.userId, parsedBody.data);
    return c.json(transactionSchema.parse(transaction), 201);
  } catch {
    return jsonError("Transaction already exists for this month", "TRANSACTION_CONFLICT", requestId, 409);
  }
});

transactionsRouter.post("/batch", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = transactionBatchImportInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid batch payload", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await batchCreateTransactions(c.env.DB, auth.userId, parsedBody.data);
  return c.json({
    ...result,
    ...importReviewStateSchema.parse({
      review_groups: result.review_groups,
      guided_review_groups: result.guided_review_groups,
      transaction_review_queue: result.transaction_review_queue,
      guided_onboarding_required: result.guided_onboarding_required,
      remaining_transaction_ids: result.remaining_transaction_ids,
    }),
  });
});

transactionsRouter.post("/review/pending-guided", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const parsedBody = pendingGuidedReviewInputSchema.safeParse(await c.req.json());
  if (!parsedBody.success) {
    return jsonError("Invalid pending review payload", "VALIDATION_ERROR", requestId, 400);
  }

  let transactionIds = parsedBody.data.transaction_ids || [];
  if (transactionIds.length === 0 && parsedBody.data.month) {
    const pending = await listPendingTransactionsByMonth(c.env.DB, auth.userId, parsedBody.data.month);
    transactionIds = pending
      .filter((transaction) => !parsedBody.data.account_id || transaction.account_id === parsedBody.data.account_id)
      .map((transaction) => Number(transaction.id));
  }

  const result = await buildImportReviewState(c.env.DB, auth.userId, transactionIds);
  return c.json(importReviewStateSchema.parse(result));
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

    let rulePayload: Record<string, unknown> | null = null;
    if (parsedBody.data.category_id !== undefined && parsedTransaction.category_id !== null) {
      const conflictingRule = await findMatchingRule(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });
      if (conflictingRule && conflictingRule.category_id !== parsedTransaction.category_id) {
        await rejectRuleForDescription(c.env.DB, auth.userId, conflictingRule.id, parsedTransaction.desc_banco);
        rulePayload = {
          created: false,
          conflict: true,
          candidates_count: 0,
          rule: conflictingRule,
        };
      }

      const syncResult = await syncRuleFromCategorizedDescription(c.env.DB, auth.userId, {
        descBanco: parsedTransaction.desc_banco,
        categoryId: parsedTransaction.category_id,
        accountId: parsedTransaction.account_id,
        currency: parsedTransaction.moneda,
        direction: parsedTransaction.entry_type === "income" ? "income" : "expense",
      });

      if (syncResult?.rule) {
        rulePayload = {
          created: syncResult.status === "created",
          conflict: Boolean(rulePayload?.conflict),
          candidates_count: 0,
          rule: syncResult.rule,
        };
      }
    }

    return c.json({
      ...parsedTransaction,
      transaction: parsedTransaction,
      rule: rulePayload,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      return jsonError("Transaction already exists for this month", "TRANSACTION_CONFLICT", requestId, 409);
    }
    throw error;
  }
});

transactionsRouter.patch("/:id/movement-kind", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const body = transactionMovementKindInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid movement kind payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await markTransactionMovement(c.env.DB, auth.userId, transactionId, body.data.kind);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json({ transaction: transactionSchema.parse(transaction) });
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

transactionsRouter.post("/confirm-category", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionCategoryDecisionInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid category payload", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await confirmCategorySelection(c.env.DB, auth.userId, body.data.transaction_ids, body.data.category_id);
  return c.json({
    confirmed: result.confirmed,
    transactions: result.transactions.map((transaction) => transactionSchema.parse(transaction)),
  });
});

transactionsRouter.post("/reject-category", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionCategoryRejectionInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid reject payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await rejectCategorySelection(c.env.DB, auth.userId, body.data.transaction_id, body.data.rule_id);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json(transactionSchema.parse(transaction));
});

transactionsRouter.post("/undo-reject-category", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionCategoryRejectionInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid undo reject payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await undoRejectCategorySelection(c.env.DB, auth.userId, body.data.transaction_id, body.data.rule_id);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json(transactionSchema.parse(transaction));
});

transactionsRouter.post("/undo-confirm-category", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionUndoConfirmInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid undo confirm payload", "VALIDATION_ERROR", requestId, 400);
  }

  const transaction = await undoConfirmCategorySelection(c.env.DB, auth.userId, body.data.transaction_id);
  if (!transaction) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json(transactionSchema.parse(transaction));
});

transactionsRouter.post("/confirm-internal-operation", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionInternalOperationInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid internal operation payload", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await confirmInternalOperation(c.env.DB, auth.userId, body.data);
  if (!result) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json({
    ok: true,
    transaction: transactionSchema.parse(result.transaction),
    counterpart: result.counterpart ? transactionSchema.parse(result.counterpart) : null,
  });
});

transactionsRouter.post("/reject-internal-operation", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const body = transactionInternalOperationRejectInputSchema.safeParse(await c.req.json());
  if (!body.success) {
    return jsonError("Invalid internal operation payload", "VALIDATION_ERROR", requestId, 400);
  }

  const result = await rejectInternalOperation(c.env.DB, auth.userId, body.data.source_transaction_id);
  if (!result) {
    return jsonError("Transaction not found", "TRANSACTION_NOT_FOUND", requestId, 404);
  }

  return c.json({
    ok: true,
    transaction: transactionSchema.parse(result.transaction),
  });
});

export default transactionsRouter;
