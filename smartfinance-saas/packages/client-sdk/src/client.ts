import {
  accountSchema,
  createAccountInputSchema,
  createCategoryInputSchema,
  categorySchema,
  errorResponseSchema,
  healthResponseSchema,
  onboardResponseSchema,
  createRuleInputSchema,
  createUploadIntentInputSchema,
  ruleMutationResponseSchema,
  schemaStatusSchema,
  ruleSchema,
  settingsSchema,
  transactionBatchAssignCategoryInputSchema,
  transactionBatchDecisionInputSchema,
  transactionBatchResultSchema,
  transactionMonthlyEvolutionPointSchema,
  transactionSchema,
  transactionSummarySchema,
  updateAccountInputSchema,
  updateCategoryInputSchema,
  updateRuleInputSchema,
  updateSettingInputSchema,
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
    updateTransaction(id: number, input: unknown) {
      const payload = updateTransactionInputSchema.parse(input);
      return request(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) }, transactionSchema);
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
    getUploads(month: string) {
      return request(`/api/uploads?month=${encodeURIComponent(month)}`, { method: "GET" }, z.array(uploadSchema));
    },
    createUploadIntent(input: unknown) {
      const payload = createUploadIntentInputSchema.parse(input);
      return request("/api/uploads/intent", { method: "POST", body: JSON.stringify(payload) }, uploadIntentSchema);
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
