import {
  accountLinkSchema,
  accountSchema,
  amountProfileListResponseSchema,
  amountProfileRebuildResponseSchema,
  assistantChatInputSchema,
  assistantChatResponseSchema,
  bankFormatSchema,
  bankFormatSuggestionInputSchema,
  bankFormatSuggestionSchema,
  categoryTrendPointSchema,
  consolidatedAccountsSchema,
  createAccountInputSchema,
  createAccountLinkInputSchema,
  createCategoryInputSchema,
  createInstallmentInputSchema,
  categorySchema,
  deletedResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  installmentCommitmentSchema,
  installmentSchema,
  onboardResponseSchema,
  pendingGuidedReviewInputSchema,
  createRuleInputSchema,
  createUploadIntentInputSchema,
  reconcileAccountLinkResponseSchema,
  recurringExpenseSchema,
  refreshRatesResponseSchema,
  resetRulesResponseSchema,
  ruleInsightSchema,
  ruleMutationResponseSchema,
  schemaStatusSchema,
  ruleSchema,
  savingsInsightsSchema,
  savingsProjectionSchema,
  settingsSchema,
  transactionBatchAssignCategoryInputSchema,
  transactionBatchDecisionInputSchema,
  transactionBatchImportInputSchema,
  transactionBatchImportResultSchema,
  transactionBatchResultSchema,
  transactionCategoryConfirmResponseSchema,
  transactionCategoryDecisionInputSchema,
  transactionCategoryRejectionInputSchema,
  importReviewStateSchema,
  transactionInternalOperationInputSchema,
  transactionInternalOperationRejectInputSchema,
  transactionMonthlyEvolutionPointSchema,
  transactionMovementKindInputSchema,
  transactionSchema,
  transactionSummarySchema,
  transactionUndoConfirmInputSchema,
  updateInstallmentInputSchema,
  updateAccountInputSchema,
  updateCategoryInputSchema,
  updateRuleInputSchema,
  updateSettingInputSchema,
  upsertBankFormatInputSchema,
  createTransactionInputSchema,
  updateTransactionInputSchema,
  uploadIntentSchema,
  uploadPreviewInputSchema,
  uploadPreviewResultSchema,
  uploadProcessInputSchema,
  uploadProcessResultSchema,
  uploadSchema,
  usageResponseSchema,
} from "@smartfinance/contracts";
import { z } from "zod";

export class SmartFinanceApiError extends Error {
  code: string;
  requestId: string;
  status: number;

  constructor(message: string, options: { code: string; requestId: string; status: number }) {
    super(message);
    this.name = "SmartFinanceApiError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export type TokenProvider = () => Promise<string | null> | string | null;

export function createApiClient(options: { baseUrl: string; getToken?: TokenProvider }) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");

  async function buildHeaders(init: RequestInit) {
    const token = options.getToken ? await options.getToken() : null;
    return {
      ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    };
  }

  async function request<T>(
    path: string,
    init: RequestInit,
    parser: { parse: (value: unknown) => T }
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: await buildHeaders(init),
    });

    const data = await response.json();

    if (!response.ok) {
      const parsedError = errorResponseSchema.parse(data);
      throw new SmartFinanceApiError(parsedError.error, {
        code: parsedError.code,
        requestId: parsedError.request_id,
        status: response.status,
      });
    }

    return parser.parse(data);
  }

  async function rawRequest(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: await buildHeaders(init),
    });

    if (!response.ok) {
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        throw new SmartFinanceApiError(response.statusText || "Request failed", {
          code: "REQUEST_ERROR",
          requestId: "",
          status: response.status,
        });
      }
      const parsedError = errorResponseSchema.parse(parsed);
      throw new SmartFinanceApiError(parsedError.error, {
        code: parsedError.code,
        requestId: parsedError.request_id,
        status: response.status,
      });
    }

    return response;
  }

  return {
    getHealth() {
      return request("/api/health", { method: "GET" }, healthResponseSchema);
    },
    getSchemaStatus() {
      return request("/api/system/schema", { method: "GET" }, schemaStatusSchema);
    },
    getSystemLimits() {
      return request("/api/system/limits", { method: "GET" }, usageResponseSchema);
    },
    getUsage() {
      return request("/api/usage", { method: "GET" }, usageResponseSchema);
    },
    onboard() {
      return request("/api/onboard", { method: "POST" }, onboardResponseSchema);
    },
    getAccounts() {
      return request("/api/accounts", { method: "GET" }, z.array(accountSchema));
    },
    createAccount(input: unknown) {
      const payload = createAccountInputSchema.parse(input);
      return request("/api/accounts", { method: "POST", body: JSON.stringify(payload) }, accountSchema);
    },
    updateAccount(id: string, input: unknown) {
      const payload = updateAccountInputSchema.parse(input);
      return request(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(payload) }, accountSchema);
    },
    getConsolidatedAccounts() {
      return request("/api/accounts/consolidated", { method: "GET" }, consolidatedAccountsSchema);
    },
    async deleteAccount(id: string) {
      const response = await fetch(`${baseUrl}/api/accounts/${id}`, {
        method: "DELETE",
        headers: await buildHeaders({ method: "DELETE" }),
      });
      if (!response.ok && response.status !== 204) {
        const parsedError = errorResponseSchema.parse(await response.json());
        throw new SmartFinanceApiError(parsedError.error, {
          code: parsedError.code,
          requestId: parsedError.request_id,
          status: response.status,
        });
      }
    },
    getCategories() {
      return request("/api/categories", { method: "GET" }, z.array(categorySchema));
    },
    createCategory(input: unknown) {
      const payload = createCategoryInputSchema.parse(input);
      return request("/api/categories", { method: "POST", body: JSON.stringify(payload) }, categorySchema);
    },
    updateCategory(id: number, input: unknown) {
      const payload = updateCategoryInputSchema.parse(input);
      return request(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify(payload) }, categorySchema);
    },
    getSettings() {
      return request("/api/settings", { method: "GET" }, settingsSchema);
    },
    updateSetting(input: unknown) {
      const payload = updateSettingInputSchema.parse(input);
      return request("/api/settings", { method: "PUT", body: JSON.stringify(payload) }, settingsSchema);
    },
    getRules() {
      return request("/api/rules", { method: "GET" }, z.array(ruleSchema));
    },
    createRule(input: unknown) {
      const payload = createRuleInputSchema.parse(input);
      return request("/api/rules", { method: "POST", body: JSON.stringify(payload) }, ruleMutationResponseSchema);
    },
    updateRule(id: number, input: unknown) {
      const payload = updateRuleInputSchema.parse(input);
      return request(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(payload) }, ruleMutationResponseSchema);
    },
    getRuleCandidates(id: number) {
      return request(`/api/rules/${id}/candidates`, { method: "GET" }, z.array(transactionSchema));
    },
    getAmountProfiles() {
      return request("/api/rules/amount-profiles", { method: "GET" }, amountProfileListResponseSchema);
    },
    rebuildAmountProfiles() {
      return request("/api/rules/amount-profiles/rebuild", { method: "POST" }, amountProfileRebuildResponseSchema);
    },
    disableAmountProfile(id: number) {
      return request(`/api/rules/amount-profiles/${id}/disable`, { method: "POST" }, amountProfileListResponseSchema);
    },
    async deleteRule(id: number) {
      const response = await fetch(`${baseUrl}/api/rules/${id}`, {
        method: "DELETE",
        headers: await buildHeaders({ method: "DELETE" }),
      });
      if (!response.ok && response.status !== 204) {
        const parsedError = errorResponseSchema.parse(await response.json());
        throw new SmartFinanceApiError(parsedError.error, {
          code: parsedError.code,
          requestId: parsedError.request_id,
          status: response.status,
        });
      }
    },
    getTransactions(month: string) {
      return request(`/api/transactions?month=${encodeURIComponent(month)}`, { method: "GET" }, z.array(transactionSchema));
    },
    getPendingTransactions(month: string) {
      return request(`/api/transactions/pending?month=${encodeURIComponent(month)}`, { method: "GET" }, z.array(transactionSchema));
    },
    getTransactionSummary(month: string) {
      return request(`/api/transactions/summary?month=${encodeURIComponent(month)}`, { method: "GET" }, transactionSummarySchema);
    },
    getTransactionMonthlyEvolution(months: number, end: string) {
      return request(
        `/api/transactions/monthly-evolution?months=${encodeURIComponent(String(months))}&end=${encodeURIComponent(end)}`,
        { method: "GET" },
        z.array(transactionMonthlyEvolutionPointSchema),
      );
    },
    createTransaction(input: unknown) {
      const payload = createTransactionInputSchema.parse(input);
      return request("/api/transactions", { method: "POST", body: JSON.stringify(payload) }, transactionSchema);
    },
    searchTransactions(query: string, limit = 25) {
      return request(
        `/api/transactions/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
        { method: "GET" },
        z.array(transactionSchema),
      );
    },
    updateTransaction(id: number, input: unknown) {
      const payload = updateTransactionInputSchema.parse(input);
      return request(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) }, transactionSchema);
    },
    markTransactionMovement(id: number, input: unknown) {
      const payload = transactionMovementKindInputSchema.parse(input);
      return request(
        `/api/transactions/${id}/movement-kind`,
        { method: "PATCH", body: JSON.stringify(payload) },
        z.object({ transaction: transactionSchema.nullable() }),
      );
    },
    async deleteTransaction(id: number) {
      const response = await fetch(`${baseUrl}/api/transactions/${id}`, {
        method: "DELETE",
        headers: await buildHeaders({ method: "DELETE" }),
      });
      if (!response.ok && response.status !== 204) {
        const parsedError = errorResponseSchema.parse(await response.json());
        throw new SmartFinanceApiError(parsedError.error, {
          code: parsedError.code,
          requestId: parsedError.request_id,
          status: response.status,
        });
      }
      return { deleted: true };
    },
    acceptSuggestion(id: number) {
      return request(`/api/transactions/${id}/accept-suggestion`, { method: "POST" }, transactionSchema);
    },
    rejectSuggestion(id: number) {
      return request(`/api/transactions/${id}/reject-suggestion`, { method: "POST" }, transactionSchema);
    },
    acceptSuggestions(input: unknown) {
      const payload = transactionBatchDecisionInputSchema.parse(input);
      return request("/api/transactions/review/accept", { method: "POST", body: JSON.stringify(payload) }, transactionBatchResultSchema);
    },
    rejectSuggestions(input: unknown) {
      const payload = transactionBatchDecisionInputSchema.parse(input);
      return request("/api/transactions/review/reject", { method: "POST", body: JSON.stringify(payload) }, transactionBatchResultSchema);
    },
    assignCategoryToTransactions(input: unknown) {
      const payload = transactionBatchAssignCategoryInputSchema.parse(input);
      return request("/api/transactions/review/assign-category", { method: "POST", body: JSON.stringify(payload) }, transactionBatchResultSchema);
    },
    batchImportTransactions(input: unknown) {
      const payload = transactionBatchImportInputSchema.parse(input);
      return request("/api/transactions/batch", { method: "POST", body: JSON.stringify(payload) }, transactionBatchImportResultSchema);
    },
    resumePendingGuidedReview(input: unknown = {}) {
      const payload = pendingGuidedReviewInputSchema.parse(input);
      return request("/api/transactions/review/pending-guided", { method: "POST", body: JSON.stringify(payload) }, importReviewStateSchema);
    },
    getCandidates(pattern: string, categoryId?: number | null) {
      const query = new URLSearchParams({ pattern });
      if (categoryId != null) query.set("category_id", String(categoryId));
      return request(`/api/transactions/candidates?${query.toString()}`, { method: "GET" }, z.array(transactionSchema));
    },
    confirmCategorySelection(input: unknown) {
      const payload = transactionCategoryDecisionInputSchema.parse(input);
      return request("/api/transactions/confirm-category", { method: "POST", body: JSON.stringify(payload) }, transactionCategoryConfirmResponseSchema);
    },
    rejectCategorySelection(input: unknown) {
      const payload = transactionCategoryRejectionInputSchema.parse(input);
      return request("/api/transactions/reject-category", { method: "POST", body: JSON.stringify(payload) }, transactionSchema);
    },
    undoRejectCategorySelection(input: unknown) {
      const payload = transactionCategoryRejectionInputSchema.parse(input);
      return request("/api/transactions/undo-reject-category", { method: "POST", body: JSON.stringify(payload) }, transactionSchema);
    },
    undoConfirmCategorySelection(input: unknown) {
      const payload = transactionUndoConfirmInputSchema.parse(input);
      return request("/api/transactions/undo-confirm-category", { method: "POST", body: JSON.stringify(payload) }, transactionSchema);
    },
    confirmInternalOperation(input: unknown) {
      const payload = transactionInternalOperationInputSchema.parse(input);
      return request(
        "/api/transactions/confirm-internal-operation",
        { method: "POST", body: JSON.stringify(payload) },
        z.object({
          ok: z.boolean(),
          transaction: transactionSchema,
          counterpart: transactionSchema.nullable(),
        }),
      );
    },
    rejectInternalOperation(input: unknown) {
      const payload = transactionInternalOperationRejectInputSchema.parse(input);
      return request(
        "/api/transactions/reject-internal-operation",
        { method: "POST", body: JSON.stringify(payload) },
        z.object({
          ok: z.boolean(),
          transaction: transactionSchema,
        }),
      );
    },
    getAccountLinks() {
      return request("/api/account-links", { method: "GET" }, z.array(accountLinkSchema));
    },
    createAccountLink(input: unknown) {
      const payload = createAccountLinkInputSchema.parse(input);
      return request("/api/account-links", { method: "POST", body: JSON.stringify(payload) }, accountLinkSchema);
    },
    reconcileAccountLink(id: number, input: unknown = {}) {
      return request(
        `/api/account-links/${id}/reconcile`,
        { method: "POST", body: JSON.stringify(input) },
        reconcileAccountLinkResponseSchema,
      );
    },
    deleteAccountLink(id: number) {
      return request(`/api/account-links/${id}`, { method: "DELETE" }, deletedResponseSchema);
    },
    getInstallments() {
      return request("/api/installments", { method: "GET" }, z.array(installmentSchema));
    },
    getInstallmentCommitments(start: string, months = 6) {
      return request(
        `/api/installments/commitments?start=${encodeURIComponent(start)}&months=${encodeURIComponent(String(months))}`,
        { method: "GET" },
        z.array(installmentCommitmentSchema),
      );
    },
    createInstallment(input: unknown) {
      const payload = createInstallmentInputSchema.parse(input);
      return request("/api/installments", { method: "POST", body: JSON.stringify(payload) }, installmentSchema);
    },
    updateInstallment(id: number, input: unknown) {
      const payload = updateInstallmentInputSchema.parse(input);
      return request(`/api/installments/${id}`, { method: "PUT", body: JSON.stringify(payload) }, installmentSchema);
    },
    deleteInstallment(id: number) {
      return request(`/api/installments/${id}`, { method: "DELETE" }, deletedResponseSchema);
    },
    refreshRates() {
      return request("/api/settings/refresh-rates", { method: "POST" }, refreshRatesResponseSchema);
    },
    getSavingsProjection(end: string, months = 12) {
      return request(
        `/api/savings/projection?end=${encodeURIComponent(end)}&months=${encodeURIComponent(String(months))}`,
        { method: "GET" },
        savingsProjectionSchema,
      );
    },
    getSavingsInsights(month: string) {
      return request(
        `/api/savings/insights?month=${encodeURIComponent(month)}`,
        { method: "GET" },
        savingsInsightsSchema,
      );
    },
    getRecurring(month: string) {
      return request(
        `/api/insights/recurring?month=${encodeURIComponent(month)}`,
        { method: "GET" },
        z.array(recurringExpenseSchema),
      );
    },
    getCategoryTrend(end: string, months = 4) {
      return request(
        `/api/insights/category-trend?end=${encodeURIComponent(end)}&months=${encodeURIComponent(String(months))}`,
        { method: "GET" },
        z.array(categoryTrendPointSchema),
      );
    },
    getBankFormats() {
      return request("/api/bank-formats", { method: "GET" }, z.array(bankFormatSchema));
    },
    getBankFormat(key: string) {
      return request(`/api/bank-formats/${encodeURIComponent(key)}`, { method: "GET" }, bankFormatSchema);
    },
    suggestBankFormat(input: unknown) {
      const payload = bankFormatSuggestionInputSchema.parse(input);
      return request("/api/bank-formats/suggest", { method: "POST", body: JSON.stringify(payload) }, bankFormatSuggestionSchema);
    },
    saveBankFormat(input: unknown) {
      const payload = upsertBankFormatInputSchema.parse(input);
      return request("/api/bank-formats", { method: "POST", body: JSON.stringify(payload) }, bankFormatSchema);
    },
    deleteBankFormat(key: string) {
      return request(`/api/bank-formats/${encodeURIComponent(key)}`, { method: "DELETE" }, deletedResponseSchema);
    },
    getRuleInsights() {
      return request("/api/rules/insights", { method: "GET" }, z.array(ruleInsightSchema));
    },
    resetRules() {
      return request("/api/rules/reset", { method: "POST" }, resetRulesResponseSchema);
    },
    assistantChat(input: unknown) {
      const payload = assistantChatInputSchema.parse(input);
      return request("/api/assistant/chat", { method: "POST", body: JSON.stringify(payload) }, assistantChatResponseSchema);
    },
    getUploads(month: string) {
      return request(`/api/uploads?month=${encodeURIComponent(month)}`, { method: "GET" }, z.array(uploadSchema));
    },
    createUploadIntent(input: unknown) {
      const payload = createUploadIntentInputSchema.parse(input);
      return request("/api/uploads/intent", { method: "POST", body: JSON.stringify(payload) }, uploadIntentSchema);
    },
    async uploadUploadContent(id: number, content: Blob | ArrayBuffer, options: { contentType?: string; uploadUrl?: string | null } = {}) {
      const path = options.uploadUrl
        ? options.uploadUrl.replace(baseUrl, "")
        : `/api/uploads/${id}/content`;
      const response = await rawRequest(path, {
        method: "PUT",
        body: content,
        headers: {
          ...(options.contentType ? { "Content-Type": options.contentType } : {}),
        },
      });
      return uploadSchema.parse(await response.json());
    },
    previewUpload(input: unknown) {
      const payload = uploadPreviewInputSchema.parse(input);
      return request("/api/uploads/preview", { method: "POST", body: JSON.stringify(payload) }, uploadPreviewResultSchema);
    },
    markUploadUploaded(id: number) {
      return request(`/api/uploads/${id}/mark-uploaded`, { method: "POST" }, uploadSchema);
    },
    processUpload(input: unknown) {
      const payload = uploadProcessInputSchema.parse(input);
      return request("/api/uploads/process", { method: "POST", body: JSON.stringify(payload) }, uploadProcessResultSchema);
    },
  };
}
