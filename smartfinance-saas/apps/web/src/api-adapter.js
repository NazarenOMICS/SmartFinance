import { api, requestCompat, setTokenGetter } from "./api-core";
import { isoMonth } from "./utils";

function monthParam(period) {
  return period ? `?period=${encodeURIComponent(period)}` : "";
}

api.claimLegacy = () => requestCompat("/api/onboard/claim-legacy", { method: "POST" });
api.completeGuidedCategorizationOnboarding = () =>
  requestCompat("/api/onboard/guided-categorization/complete", { method: "POST" });
api.skipGuidedCategorizationOnboarding = () =>
  requestCompat("/api/onboard/guided-categorization/skip", { method: "POST" });

api.getSummary = (month) => requestCompat(`/api/transactions/summary?month=${month}`);
api.getTransactions = (month) => requestCompat(`/api/transactions?month=${month}`);
api.getEvolution = (end, months = 6) =>
  requestCompat(`/api/transactions/monthly-evolution?end=${end}&months=${months}`);
api.searchTransactions = (query, limit = 25) =>
  requestCompat(`/api/transactions/search?q=${encodeURIComponent(query)}&limit=${limit}`);
api.batchCreateTransactions = (body) =>
  requestCompat("/api/transactions/batch", { method: "POST", body: JSON.stringify(body) });
api.resumePendingGuidedReview = (body = {}) =>
  requestCompat("/api/transactions/review/pending-guided", { method: "POST", body: JSON.stringify(body) });
api.getCandidates = (pattern, categoryId) =>
  requestCompat(`/api/transactions/candidates?pattern=${encodeURIComponent(pattern)}&category_id=${categoryId}`);
api.confirmCategory = (transactionIds, categoryId, options = {}) =>
  requestCompat("/api/transactions/confirm-category", {
    method: "POST",
    body: JSON.stringify({
      transaction_ids: transactionIds.map((id) => Number(id)),
      category_id: Number(categoryId),
      rule_id: options.ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  });
api.rejectCategory = (transactionId, ruleId, options = {}) =>
  requestCompat("/api/transactions/reject-category", {
    method: "POST",
    body: JSON.stringify({
      transaction_id: Number(transactionId),
      rule_id: ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  });
api.undoRejectCategory = (transactionId, ruleId, options = {}) =>
  requestCompat("/api/transactions/undo-reject-category", {
    method: "POST",
    body: JSON.stringify({
      transaction_id: Number(transactionId),
      rule_id: ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  });
api.undoConfirmCategory = (transactionId, categoryId, options = {}) =>
  requestCompat("/api/transactions/undo-confirm-category", {
    method: "POST",
    body: JSON.stringify({
      transaction_id: Number(transactionId),
      category_id: categoryId ?? null,
      origin: options.origin ?? "review",
    }),
  });
api.confirmInternalOperation = (body) =>
  requestCompat("/api/transactions/confirm-internal-operation", {
    method: "POST",
    body: JSON.stringify(body),
  });
api.rejectInternalOperation = (body) =>
  requestCompat("/api/transactions/reject-internal-operation", {
    method: "POST",
    body: JSON.stringify(body),
  });
api.markTransactionMovement = (id, kind) =>
  requestCompat(`/api/transactions/${id}/movement-kind`, {
    method: "PATCH",
    body: JSON.stringify({ kind }),
  });
api.deleteTransaction = async (id) => {
  await requestCompat(`/api/transactions/${id}`, { method: "DELETE" });
  return { deleted: true };
};
api.createTransaction = (body) =>
  requestCompat("/api/transactions", { method: "POST", body: JSON.stringify(body) });
api.updateTransaction = (id, body) =>
  requestCompat(`/api/transactions/${id}`, { method: "PUT", body: JSON.stringify(body) });

api.getConsolidatedAccounts = () => requestCompat("/api/accounts/consolidated");
api.getAccounts = async () => {
  const accounts = await requestCompat("/api/accounts");
  return accounts.map((account) => ({
    ...account,
    live_balance: Number(account.balance || 0),
  }));
};
api.getAccountLinks = () => requestCompat("/api/account-links");
api.createAccountLink = (body) =>
  requestCompat("/api/account-links", { method: "POST", body: JSON.stringify(body) });
api.reconcileAccountLink = (id, body = {}) =>
  requestCompat(`/api/account-links/${id}/reconcile`, { method: "POST", body: JSON.stringify(body) });
api.deleteAccountLink = (id) => requestCompat(`/api/account-links/${id}`, { method: "DELETE" });

api.getInstallments = () => requestCompat("/api/installments");
api.createInstallment = (body) =>
  requestCompat("/api/installments", { method: "POST", body: JSON.stringify(body) });
api.updateInstallment = (id, body) =>
  requestCompat(`/api/installments/${id}`, { method: "PUT", body: JSON.stringify(body) });
api.deleteInstallment = (id) => requestCompat(`/api/installments/${id}`, { method: "DELETE" });
api.getCommitments = (start, months = 6) =>
  requestCompat(`/api/installments/commitments?start=${start}&months=${months}`);

api.refreshRates = () => requestCompat("/api/settings/refresh-rates", { method: "POST" });
api.getProjection = (end, months = 12) =>
  requestCompat(`/api/savings/projection?end=${end}&months=${months}`);
api.getInsights = (month) => requestCompat(`/api/savings/insights?month=${month}`);
api.getRecurring = (month) => requestCompat(`/api/insights/recurring?month=${month}`);
api.getCategoryTrend = (month, months = 4) =>
  requestCompat(`/api/insights/category-trend?end=${month}&months=${months}`);

api.getUploads = (period) => requestCompat(`/api/upload${monthParam(period)}`);
api.uploadFile = (formData) => requestCompat("/api/upload", { method: "POST", body: formData });

api.getBankFormats = () => requestCompat("/api/bank-formats");
api.getBankFormat = (key) => requestCompat(`/api/bank-formats/${encodeURIComponent(key)}`);
api.saveBankFormat = (body) =>
  requestCompat("/api/bank-formats", { method: "POST", body: JSON.stringify(body) });
api.deleteBankFormat = (key) =>
  requestCompat(`/api/bank-formats/${encodeURIComponent(key)}`, { method: "DELETE" });

api.resetRules = () => requestCompat("/api/rules/reset", { method: "POST" });

api.assistantChat = async ({ month = isoMonth(), question = "" } = {}) => {
  const summary = await api.getSummary(month);
  return {
    answer: `El asistente todavia no esta migrado. Referencia rapida: ingresos ${summary.totals?.income ?? 0}, gastos ${summary.totals?.expenses ?? 0}, margen ${summary.totals?.margin ?? 0}. Pregunta: ${question}`,
  };
};

export { api, setTokenGetter };
