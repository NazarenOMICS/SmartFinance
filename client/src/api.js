const API_BASE = import.meta.env.VITE_API_URL || "";

// The Clerk `getToken` function is injected here by <AuthSync /> in App.jsx.
// This avoids having to thread the token through every call site.
let _getToken = null;
export function setTokenGetter(fn) { _getToken = fn; }

async function request(url, options = {}) {
  const token = _getToken ? await _getToken() : null;
  const headers = {
    ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers || {}),
  };

  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });

  if (!response.ok) {
    let message = "Request failed";
    let parsed = null;
    try {
      parsed = await response.json();
      message = parsed.error || (parsed.blocking_reason ? "La base de datos necesita migraciones antes de usar la app." : message);
    } catch {
      message = response.statusText || message;
    }
    const error = new Error(message);
    if (parsed?.blocking_reason) {
      error.code = "SCHEMA_MISMATCH";
      error.schema = parsed;
    }
    throw error;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response.text();
}

export const api = {
  getSchemaStatus: () => request("/api/system/schema"),

  // Onboarding
  onboard: () => request("/api/onboard", { method: "POST" }),
  claimLegacy: () => request("/api/onboard/claim-legacy", { method: "POST" }),
  completeGuidedCategorizationOnboarding: () =>
    request("/api/onboard/guided-categorization/complete", { method: "POST" }),
  skipGuidedCategorizationOnboarding: () =>
    request("/api/onboard/guided-categorization/skip", { method: "POST" }),

  // Transactions
  getSummary: (month) => request(`/api/transactions/summary?month=${month}`),
  getTransactions: (month) => request(`/api/transactions?month=${month}`),
  updateTransaction: (id, body) =>
    request(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  createTransaction: (body) =>
    request("/api/transactions", { method: "POST", body: JSON.stringify(body) }),
  searchTransactions: (q, limit = 20) =>
    request(`/api/transactions/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  batchCreateTransactions: (body) =>
    request("/api/transactions/batch", { method: "POST", body: JSON.stringify(body) }),
  resumePendingGuidedReview: (body) =>
    request("/api/transactions/review/pending-guided", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getEvolution: (end, months = 6) =>
    request(`/api/transactions/monthly-evolution?end=${end}&months=${months}`),
  deleteTransaction: (id) =>
    request(`/api/transactions/${id}`, { method: "DELETE" }),
  getCandidates: (pattern, categoryId) =>
    request(`/api/transactions/candidates?pattern=${encodeURIComponent(pattern)}&category_id=${categoryId}`),
  confirmCategory: (transactionIds, categoryId, options = {}) =>
    request("/api/transactions/confirm-category", { method: "POST", body: JSON.stringify({ transaction_ids: transactionIds, category_id: categoryId, rule_id: options.ruleId ?? null, origin: options.origin ?? "review" }) }),
  rejectCategory: (transactionId, ruleId, options = {}) =>
    request("/api/transactions/reject-category", { method: "POST", body: JSON.stringify({ transaction_id: transactionId, rule_id: ruleId, origin: options.origin ?? "review" }) }),
  undoRejectCategory: (transactionId, ruleId, options = {}) =>
    request("/api/transactions/undo-reject-category", { method: "POST", body: JSON.stringify({ transaction_id: transactionId, rule_id: ruleId, origin: options.origin ?? "review" }) }),
  undoConfirmCategory: (transactionId, categoryId, options = {}) =>
    request("/api/transactions/undo-confirm-category", { method: "POST", body: JSON.stringify({ transaction_id: transactionId, category_id: categoryId, origin: options.origin ?? "review" }) }),

  // Categories
  getCategories: () => request("/api/categories"),
  createCategory: (body) =>
    request("/api/categories", { method: "POST", body: JSON.stringify(body) }),
  updateCategory: (id, body) =>
    request(`/api/categories/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteCategory: (id) =>
    request(`/api/categories/${id}`, { method: "DELETE" }),

  // Accounts
  getAccounts: () => request("/api/accounts"),
  createAccount: (body) =>
    request("/api/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateAccount: (id, body) =>
    request(`/api/accounts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAccount: (id, force = false) =>
    request(`/api/accounts/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
  getConsolidatedAccounts: () => request("/api/accounts/consolidated"),

  // Rules
  getRules: () => request("/api/rules"),
  createRule: (body) =>
    request("/api/rules", { method: "POST", body: JSON.stringify(body) }),
  updateRule: (id, body) =>
    request(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  resetRules: () =>
    request("/api/rules/reset", { method: "POST" }),
  deleteRule: (id) =>
    request(`/api/rules/${id}`, { method: "DELETE" }),

  // Installments
  getInstallments: () => request("/api/installments"),
  createInstallment: (body) =>
    request("/api/installments", { method: "POST", body: JSON.stringify(body) }),
  updateInstallment: (id, body) =>
    request(`/api/installments/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteInstallment: (id) =>
    request(`/api/installments/${id}`, { method: "DELETE" }),
  getCommitments: (start, months = 6) =>
    request(`/api/installments/commitments?start=${start}&months=${months}`),

  // Settings
  getSettings: () => request("/api/settings"),
  updateSetting: (key, value) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify({ key, value }) }),
  refreshRates: () =>
    request("/api/settings/refresh-rates", { method: "POST" }),

  // Savings / Insights
  getProjection: (end, months = 12) =>
    request(`/api/savings/projection?end=${end}&months=${months}`),
  getInsights: (month) => request(`/api/savings/insights?month=${month}`),
  getRecurring: (month) => request(`/api/insights/recurring?month=${month}`),
  getCategoryTrend: (month, months = 3) =>
    request(`/api/insights/category-trend?end=${month}&months=${months}`),

  // Upload
  getUploads: (period) => request(period ? `/api/upload?period=${period}` : "/api/upload"),
  uploadFile: (formData) => request("/api/upload", { method: "POST", body: formData }),

  // Bank formats (column mapping memory)
  getBankFormats: () => request("/api/bank-formats"),
  getBankFormat: (key) => request(`/api/bank-formats/${key}`),
  saveBankFormat: (body) =>
    request("/api/bank-formats", { method: "POST", body: JSON.stringify(body) }),
  deleteBankFormat: (key) => request(`/api/bank-formats/${key}`, { method: "DELETE" }),
};
