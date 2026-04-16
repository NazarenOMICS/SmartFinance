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
  uploadSchema,
  transactionUndoConfirmInputSchema,
  updateTransactionInputSchema,
} from "@smartfinance/contracts";
import {
  AccountCurrencyMismatchError,
  acceptSuggestedTransaction,
  acceptSuggestedTransactions,
  assignCategoryToTransactions,
  buildImportReviewState,
  confirmCategorySelection,
  confirmInternalOperation,
  createUploadIntentRecord,
  createTransaction,
  deleteTransaction,
  getTransactionMonthlyEvolution,
  getTransactionSummary,
  getUsageSnapshot,
  listCandidateTransactions,
  listPendingTransactionsByMonth,
  listRuleMatchLog,
  listTransactionsByMonth,
  logRuleMatch,
  markUploadStatus,
  markTransactionMovement,
  processUploadTransactions,
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
  TransactionAccountNotFoundError,
  updateTransaction,
} from "@smartfinance/database";
import type { ApiBindings, ApiVariables } from "../env";
import { jsonError } from "../utils/http";
import { allRows } from "@smartfinance/database";

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

transactionsRouter.get("/:id/categorization-log", async (c) => {
  const auth = c.get("auth");
  const requestId = c.get("requestId");
  const transactionId = Number(c.req.param("id"));
  if (!Number.isInteger(transactionId) || transactionId < 1) {
    return jsonError("Invalid transaction id", "VALIDATION_ERROR", requestId, 400);
  }

  const rows = await listRuleMatchLog(c.env.DB, auth.userId, transactionId);
  return c.json({ transaction_id: transactionId, events: rows });
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
  } catch (error) {
    if (error instanceof AccountCurrencyMismatchError) {
      return jsonError(error.message, "ACCOUNT_CURRENCY_MISMATCH", requestId, 409);
    }
    if (error instanceof TransactionAccountNotFoundError) {
      return jsonError(error.message, "ACCOUNT_NOT_FOUND", requestId, 404);
    }
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

  const usage = await getUsageSnapshot(c.env.DB, auth.userId);
  if (usage.usage.uploads_this_month.used >= usage.usage.uploads_this_month.limit) {
    return jsonError("Monthly upload limit reached", "UPLOAD_LIMIT_REACHED", requestId, 409);
  }

  const estimatedBytes = new TextEncoder().encode(JSON.stringify(parsedBody.data.transactions)).length;
  const maxSizeBytes = usage.usage.max_upload_size_mb * 1024 * 1024;
  if (estimatedBytes > maxSizeBytes) {
    return jsonError("Import exceeds plan size limit", "UPLOAD_SIZE_LIMIT", requestId, 413);
  }

  const importPeriod = parsedBody.data.period || parsedBody.data.transactions[0]?.fecha?.slice(0, 7) || new Date().toISOString().slice(0, 7);
  const upload = await createUploadIntentRecord(c.env.DB, auth.userId, {
    original_filename: `manual-import-${parsedBody.data.period || "batch"}.csv`,
    mime_type: "text/csv",
    size_bytes: Math.max(estimatedBytes, 1),
    period: importPeriod,
    account_id: parsedBody.data.account_id,
    source: "import",
  });
  if (!upload) {
    return jsonError("Import could not be created", "UPLOAD_ERROR", requestId, 500);
  }

  await markUploadStatus(c.env.DB, auth.userId, upload.id, { status: "uploaded" });
  let processed;
  try {
    processed = await processUploadTransactions(c.env.DB, auth.userId, {
      upload_id: upload.id,
      transactions: parsedBody.data.transactions.map((transaction) => ({
        fecha: transaction.fecha,
        desc_banco: transaction.desc_banco,
        monto: transaction.monto,
        moneda: transaction.moneda,
        desc_usuario: transaction.desc_usuario,
        entry_type: transaction.entry_type === "internal_transfer"
          ? (transaction.monto >= 0 ? "income" : "expense")
          : transaction.entry_type,
      })),
    });
  } catch (error) {
    if (error instanceof AccountCurrencyMismatchError) {
      await markUploadStatus(c.env.DB, auth.userId, upload.id, {
        status: "processed",
        parser: "csv",
        parse_failure_reason: "account_currency_mismatch",
        extracted_candidates: parsedBody.data.transactions.length,
        tx_count: 0,
      });
      return jsonError(error.message, "ACCOUNT_CURRENCY_MISMATCH", requestId, 409);
    }
    if (error instanceof TransactionAccountNotFoundError) {
      return jsonError(error.message, "ACCOUNT_NOT_FOUND", requestId, 404);
    }
    throw error;
  }
  if (!processed || !processed.upload) {
    return jsonError("Import could not be processed", "UPLOAD_ERROR", requestId, 500);
  }

  const persistedUpload = await markUploadStatus(c.env.DB, auth.userId, upload.id, {
    status: processed.pending_review > 0 ? "needs_review" : "processed",
    tx_count: processed.created,
    parser: "csv",
    ai_assisted: false,
    ai_provider: null,
    ai_model: null,
    extracted_candidates: parsedBody.data.transactions.length,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized_count: processed.auto_categorized,
    suggested_count: processed.suggested,
    pending_review_count: processed.pending_review + processed.suggested,
    unmatched_count: 0,
  });

  const uploadTransactions = await allRows<{ id: number }>(
    c.env.DB,
    "SELECT id FROM transactions WHERE user_id = ? AND upload_id = ? ORDER BY id ASC",
    [auth.userId, upload.id],
  );
  const reviewState = await buildImportReviewState(
    c.env.DB,
    auth.userId,
    uploadTransactions.map((row) => Number(row.id)),
  );

  return c.json({
    upload_id: upload.id,
    upload: persistedUpload ? uploadSchema.parse(persistedUpload) : null,
    created: processed.created,
    duplicates: processed.duplicates_skipped,
    duplicates_skipped: processed.duplicates_skipped,
    auto_categorized: processed.auto_categorized,
    suggested: processed.suggested,
    pending_review: processed.pending_review + processed.suggested,
    errors: 0,
    parser: "csv",
    ai_assisted: false,
    ai_provider: null,
    ai_model: null,
    extracted_candidates: parsedBody.data.transactions.length,
    unmatched_count: 0,
    guided_onboarding_session: null,
    ...importReviewStateSchema.parse({
      review_groups: reviewState.review_groups,
      guided_review_groups: reviewState.guided_review_groups,
      transaction_review_queue: reviewState.transaction_review_queue,
      guided_onboarding_required: reviewState.guided_onboarding_required,
      remaining_transaction_ids: reviewState.remaining_transaction_ids,
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
        scopePreference: parsedBody.data.rule_scope === "global" ? "global" : parsedBody.data.rule_scope === "account" ? "account" : null,
      });

      if (syncResult?.rule) {
        rulePayload = {
          created: syncResult.status === "created",
          conflict: Boolean(rulePayload?.conflict),
          candidates_count: 0,
          rule: syncResult.rule,
        };
        await logRuleMatch(c.env.DB, auth.userId, {
          transactionId,
          ruleId: Number(syncResult.rule.id),
          categoryId: parsedTransaction.category_id,
          layer: "manual",
          confidence: Number(syncResult.rule.confidence ?? 0.9),
          reason: syncResult.status === "overrode_conflict" ? "Manual category overrode existing rule scope" : "Manual category confirmed rule",
        });
      } else if (syncResult?.status === "skipped") {
        rulePayload = {
          created: false,
          conflict: false,
          candidates_count: 0,
          skipped: true,
          skipped_reason: syncResult.skipped_reason,
        };
        await logRuleMatch(c.env.DB, auth.userId, {
          transactionId,
          ruleId: null,
          categoryId: parsedTransaction.category_id,
          layer: "manual",
          confidence: null,
          reason: `Rule skipped: ${syncResult.skipped_reason}`,
        });
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
        scopePreference: parsedBody.data.rule_scope === "global" ? "global" : parsedBody.data.rule_scope === "account" ? "account" : null,
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
