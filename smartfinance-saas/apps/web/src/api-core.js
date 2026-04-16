import { createApiClient } from "@smartfinance/client-sdk";
import { appConfig } from "./config";
import { isoMonth } from "./utils";

let _getToken = null;
export function setTokenGetter(fn) {
  _getToken = fn;
}

export function getTokenGetter() {
  return _getToken;
}

class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.status = options.status || null;
    this.code = options.code || null;
    this.schema = options.schema || null;
    this.cause = options.cause;
  }
}

const sdk = createApiClient({
  baseUrl: appConfig.apiBaseUrl || "",
  getToken: () => (_getToken ? _getToken() : null),
});

function normalizeCategoryType(type) {
  if (type === "fixed" || type === "fijo") return "fijo";
  if (type === "income") return "ingreso";
  return "variable";
}

function normalizeRuleCategoryType(type) {
  return type === "fijo" ? "fixed" : "variable";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `item_${Date.now()}`;
}

function shiftMonth(month, delta) {
  const [year, monthNumber] = String(month || isoMonth()).split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function listMonthWindow(endMonth, count = 6) {
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, index - count + 1));
}

function normalizeMatcher(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveMeaningfulPattern(value) {
  const cleaned = normalizeMatcher(value)
    .replace(/\b\d+\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = cleaned
    .split(" ")
    .filter((token) => token.length > 2)
    .slice(0, 3);
  return tokens.join(" ").trim();
}

function buildHeaders(options, token) {
  return {
    ...(!(options.body instanceof FormData) && { "Content-Type": "application/json" }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers || {}),
  };
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || appConfig.apiTimeoutMs);
  const token = _getToken ? await _getToken() : null;
  const headers = buildHeaders(options, token);

  let response;
  try {
    response = await fetch(`${appConfig.apiBaseUrl}${url}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new ApiError("La request tardó demasiado. Probá de nuevo.", { code: "REQUEST_TIMEOUT", cause: error });
    }
    throw new ApiError("No se pudo conectar con la API.", { code: "NETWORK_ERROR", cause: error });
  }

  clearTimeout(timeoutId);

  if (!response.ok) {
    let message = "Request failed";
    let parsed = null;
    try {
      parsed = await response.json();
      message = parsed.error || message;
    } catch {
      message = response.statusText || message;
    }
    const error = new ApiError(message, { status: response.status, code: parsed?.code || null });
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

export async function requestCompat(url, options = {}) {
  return request(url, options);
}

function enrichCategories(categories) {
  return (categories || []).map((category) => ({
    ...category,
    type: normalizeCategoryType(category.type),
    usage_count: category.usage_count || 0,
    origin: category.origin || (category.slug === "ingreso" ? "seed" : "manual"),
  }));
}

function enrichRules(rules, categories, accounts) {
  const categoryById = new Map((categories || []).map((category) => [Number(category.id), category]));
  const accountById = new Map((accounts || []).map((account) => [account.id, account]));

  return (rules || []).map((rule) => {
    const category = categoryById.get(Number(rule.category_id));
    const account = rule.account_id ? accountById.get(rule.account_id) : null;
    return {
      ...rule,
      category_name: rule.category_name || category?.name || null,
      category_color: category?.color || null,
      category_slug: category?.slug || null,
      account_name: account?.name || null,
    };
  });
}

function enrichAccounts(accounts) {
  return (accounts || []).map((account) => ({
    ...account,
    live_balance: Number(account.balance || 0),
  }));
}

function enrichTransactions(transactions, categories, accounts) {
  const categoryById = new Map((categories || []).map((category) => [Number(category.id), category]));
  const accountById = new Map((accounts || []).map((account) => [account.id, account]));

  return (transactions || []).map((transaction) => {
    const category = transaction.category_id != null ? categoryById.get(Number(transaction.category_id)) : null;
    const account = transaction.account_id ? accountById.get(transaction.account_id) : null;
    return {
      ...transaction,
      category_name: category?.name || null,
      category_type: category?.type || null,
      category_color: category?.color || null,
      account_name: account?.name || null,
      es_cuota: transaction.es_cuota || 0,
      installment_id: transaction.installment_id || null,
    };
  });
}

async function getCategoriesRich() {
  const categories = await sdk.getCategories();
  return enrichCategories(categories);
}

async function getAccountsRich() {
  const accounts = await sdk.getAccounts();
  return enrichAccounts(accounts);
}

async function getTransactionsRich(month) {
  const [transactions, categories, accounts] = await Promise.all([
    sdk.getTransactions(month),
    getCategoriesRich(),
    getAccountsRich(),
  ]);
  return enrichTransactions(transactions, categories, accounts);
}

async function getTransactionsWindow(endMonth, months = 12) {
  const monthKeys = listMonthWindow(endMonth || isoMonth(), months);
  const monthlyTransactions = await Promise.all(monthKeys.map((month) => getTransactionsRich(month).catch(() => [])));
  return monthlyTransactions.flat();
}

async function findExistingRule(input) {
  const rules = await api.getRules();
  const normalizedPattern = normalizeMatcher(input.pattern);
  return rules.find((rule) => (
    normalizeMatcher(rule.pattern) === normalizedPattern
    && String(rule.account_id || "") === String(input.account_id || "")
    && String(rule.currency || "") === String(input.currency || "")
    && String(rule.direction || "any") === String(input.direction || "any")
  )) || null;
}

async function getRuleCandidatesCount(ruleId) {
  if (!ruleId) return 0;
  try {
    const candidates = await sdk.getRuleCandidates(ruleId);
    return candidates.length;
  } catch {
    return 0;
  }
}

function buildTransactionReviewItem(transaction, categories) {
  const category = transaction.category_id != null
    ? categories.find((item) => Number(item.id) === Number(transaction.category_id))
    : null;

  return {
    transaction_id: transaction.id,
    fecha: transaction.fecha,
    monto: Number(transaction.monto),
    moneda: transaction.moneda,
    desc_banco: transaction.desc_banco,
    account_id: transaction.account_id,
    suggested_category_id: transaction.category_id,
    suggested_category_name: category?.name || null,
    suggestion_source: transaction.category_source || (transaction.category_id ? "rule_suggest" : "manual_review"),
    suggestion_reason: transaction.category_id
      ? `Sugerido por el motor para "${category?.name || "categoría"}".`
      : "Todavía no hay suficiente contexto para aprender esta transacción.",
  };
}

function buildGuidedReviewGroups(transactions, categories) {
  const grouped = new Map();

  transactions
    .filter((transaction) => transaction.category_id != null)
    .forEach((transaction) => {
      const pattern = deriveMeaningfulPattern(transaction.desc_banco);
      if (!pattern) return;
      const key = `${pattern}::${transaction.category_id}`;
      const category = categories.find((item) => Number(item.id) === Number(transaction.category_id));
      const group = grouped.get(key) || {
        key,
        pattern,
        category_id: transaction.category_id,
        category_name: category?.name || "Sin categoría",
        count: 0,
        transaction_ids: [],
        samples: [],
      };

      group.count += 1;
      group.transaction_ids.push(transaction.id);
      if (!group.samples.includes(transaction.desc_banco) && group.samples.length < 5) {
        group.samples.push(transaction.desc_banco);
      }
      grouped.set(key, group);
    });

  return [...grouped.values()]
    .filter((group) => group.count >= 2)
    .sort((left, right) => right.count - left.count)
    .map((group) => ({
      ...group,
      priority: group.count >= 3 ? "high" : "medium",
      risk_label: group.count >= 4 ? "Patrón fuerte" : "Conviene confirmar",
      guided_reason: "Vimos varias descripciones parecidas en la misma categoría",
      suggested_rule_mode: group.count >= 3 ? "auto" : "suggest",
      suggested_rule_confidence: group.count >= 4 ? 0.94 : 0.84,
    }));
}

function buildImportReviewState(transactions, categories, settings = {}) {
  const pendingTransactions = transactions.filter((transaction) => String(transaction.categorization_status || "") !== "categorized");
  const guidedReviewGroups = buildGuidedReviewGroups(
    pendingTransactions.filter((transaction) => String(transaction.categorization_status || "") === "suggested"),
    categories,
  );
  const guidedIds = new Set(guidedReviewGroups.flatMap((group) => group.transaction_ids));
  const transactionReviewQueue = pendingTransactions
    .filter((transaction) => !guidedIds.has(transaction.id))
    .map((transaction) => buildTransactionReviewItem(transaction, categories));
  const guidedEnabled = settings.guided_categorization_onboarding_completed !== "1"
    && settings.guided_categorization_onboarding_skipped !== "1";

  return {
    review_groups: [],
    guided_review_groups: guidedReviewGroups,
    guided_onboarding_required: guidedEnabled && guidedReviewGroups.length > 0,
    transaction_review_queue: transactionReviewQueue,
    remaining_transaction_ids: pendingTransactions.map((transaction) => transaction.id),
  };
}

async function buildProjection(endMonth, months = 12) {
  return sdk.getSavingsProjection(endMonth, months);
}

async function buildInsights(month) {
  return sdk.getSavingsInsights(month);
}

async function parseUploadedFile(file, period) {
  const text = await file.text();
  const sourceType = file.name.toLowerCase().endsWith(".csv") ? "csv" : "text";
  return sdk.previewUpload({
    period,
    source_type: sourceType,
    content: text,
  });
}

export const api = {
  getDashboard: (month) => sdk.getTransactionSummary(month),
  getSchemaStatus: () => sdk.getSchemaStatus(),

  onboard: async () => {
    const response = await sdk.onboard();
    return { ...response, status: "existing" };
  },
  claimLegacy: async () => ({ ok: false, claimed: false }),
  completeGuidedCategorizationOnboarding: () => sdk.updateSetting({ key: "guided_categorization_onboarding_completed", value: "1" }),
  skipGuidedCategorizationOnboarding: () => sdk.updateSetting({ key: "guided_categorization_onboarding_skipped", value: "1" }),

  getSummary: (month) => sdk.getTransactionSummary(month),
  getTransactions: (month) => getTransactionsRich(month),
  updateTransaction: async (id, body) => {
    const updated = await sdk.updateTransaction(id, body);
    let rule = null;

    if (body.category_id !== undefined && body.category_id !== null) {
      const pattern = deriveMeaningfulPattern(updated.desc_banco);
      if (pattern) {
        const createdRule = await api.createRule({
          pattern,
          category_id: Number(body.category_id),
          mode: "auto",
          confidence: 0.84,
          account_id: updated.account_id || undefined,
          currency: updated.moneda || undefined,
          direction: Number(updated.monto) >= 0 ? "income" : "expense",
        }).catch(() => null);

        if (createdRule) {
          rule = {
            created: !createdRule.duplicate,
            conflict: Boolean(createdRule.duplicate && Number(createdRule.category_id) !== Number(body.category_id)),
            candidates_count: createdRule.candidates_count || 0,
            rule: createdRule,
          };
        }
      }
    }

    return { ...updated, transaction: updated, rule };
  },
  markTransactionMovement: (id, kind) => sdk.markTransactionMovement(id, { kind }),
  createTransaction: async (body) => {
    const payload = {
      fecha: body.fecha,
      desc_banco: body.desc_banco,
      desc_usuario: body.desc_usuario,
      monto: Number(body.monto),
      moneda: body.moneda || "UYU",
      category_id: body.category_id ?? null,
      account_id: body.account_id,
      entry_type: body.entry_type || (Number(body.monto) >= 0 ? "income" : "expense"),
    };
    return sdk.createTransaction(payload);
  },
  searchTransactions: (query, limit = 25) => sdk.searchTransactions(query, limit),
  batchCreateTransactions: (body) => sdk.batchImportTransactions(body),
  resumePendingGuidedReview: ({ transaction_ids = [], month = isoMonth() } = {}) =>
    sdk.resumePendingGuidedReview({ transaction_ids, month }),
  confirmInternalOperation: (body) => sdk.confirmInternalOperation(body),
  rejectInternalOperation: (body) => sdk.rejectInternalOperation(body),
  getEvolution: (end, months = 6) => sdk.getTransactionMonthlyEvolution(months, end),
  deleteTransaction: (id) => sdk.deleteTransaction(id),
  getCandidates: (pattern, categoryId) => sdk.getCandidates(pattern, categoryId),
  confirmCategory: (transactionIds, categoryId, options = {}) =>
    sdk.confirmCategorySelection({
      transaction_ids: transactionIds.map((id) => Number(id)),
      category_id: Number(categoryId),
      rule_id: options.ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  rejectCategory: (transactionId, ruleId, options = {}) =>
    sdk.rejectCategorySelection({
      transaction_id: Number(transactionId),
      rule_id: ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  undoRejectCategory: (transactionId, ruleId, options = {}) =>
    sdk.undoRejectCategorySelection({
      transaction_id: Number(transactionId),
      rule_id: ruleId ?? null,
      origin: options.origin ?? "review",
    }),
  undoConfirmCategory: (transactionId, categoryId, options = {}) =>
    sdk.undoConfirmCategorySelection({
      transaction_id: Number(transactionId),
      category_id: categoryId ?? null,
      origin: options.origin ?? "review",
    }),

  getCategories: () => getCategoriesRich(),
  createCategory: async (body) => {
    const created = await sdk.createCategory({
      slug: body.slug || slugify(body.name),
      name: body.name,
      type: normalizeRuleCategoryType(body.type),
      budget: Number(body.budget || 0),
      color: body.color,
      sort_order: Number(body.sort_order || 0),
    });
    return {
      ...created,
      type: normalizeCategoryType(created.type),
      usage_count: 0,
      origin: "manual",
    };
  },
  updateCategory: async (id, body) => {
    const updated = await sdk.updateCategory(id, {
      slug: body.slug || slugify(body.name),
      name: body.name,
      type: normalizeRuleCategoryType(body.type),
      budget: Number(body.budget || 0),
      color: body.color ?? null,
      sort_order: Number(body.sort_order || 0),
    });
    return {
      ...updated,
      type: normalizeCategoryType(updated.type),
    };
  },
  deleteCategory: (id) => sdk.deleteCategory(id),

  getAccounts: () => getAccountsRich(),
  createAccount: async (body) => {
    const id = body.id || slugify(body.name);
    return sdk.createAccount({
      id,
      name: body.name,
      currency: body.currency || "UYU",
      balance: Number(body.balance || 0),
      opening_balance: Number(body.opening_balance || body.balance || 0),
    });
  },
  updateAccount: (id, body) => sdk.updateAccount(id, body),
  deleteAccount: (id, force = false) => sdk.deleteAccount(id, force),
  getConsolidatedAccounts: () => sdk.getConsolidatedAccounts(),
  getAccountLinks: () => sdk.getAccountLinks(),
  createAccountLink: (body) => sdk.createAccountLink(body),
  reconcileAccountLink: (id, body = {}) => sdk.reconcileAccountLink(Number(id), body),
  deleteAccountLink: (id) => sdk.deleteAccountLink(Number(id)),

  getRules: async () => {
    const [rules, categories, accounts] = await Promise.all([
      sdk.getRules(),
      getCategoriesRich(),
      getAccountsRich(),
    ]);
    return enrichRules(rules, categories, accounts);
  },
  createRule: async (body) => {
    try {
      const result = await sdk.createRule(body);
      return {
        ...result.rule,
        candidates_count: await getRuleCandidatesCount(result.rule?.id),
        duplicate: false,
      };
    } catch (error) {
      if (Number(error?.status) !== 409) throw error;
      const existing = await findExistingRule(body);
      if (!existing) throw error;
      return {
        ...existing,
        candidates_count: await getRuleCandidatesCount(existing.id),
        duplicate: true,
      };
    }
  },
  updateRule: async (id, body) => {
    const result = await sdk.updateRule(id, body);
    return result.rule;
  },
  getRuleInsights: () => sdk.getRuleInsights(),
  getAmountProfiles: () => sdk.getAmountProfiles(),
  rebuildAmountProfiles: () => sdk.rebuildAmountProfiles(),
  disableAmountProfile: (id) => sdk.disableAmountProfile(Number(id)),
  resetRules: () => sdk.resetRules(),
  deleteRule: (id) => sdk.deleteRule(id),

  getInstallments: () => sdk.getInstallments(),
  createInstallment: (body) => sdk.createInstallment(body),
  updateInstallment: (id, body) => sdk.updateInstallment(Number(id), body),
  deleteInstallment: (id) => sdk.deleteInstallment(Number(id)),
  getCommitments: (start, months = 6) => sdk.getInstallmentCommitments(start, months),

  getSettings: () => sdk.getSettings(),
  updateSetting: async (key, value) => sdk.updateSetting({ key, value: String(value) }),
  refreshRates: () => sdk.refreshRates(),

  getProjection: (end, months = 12) => buildProjection(end, months),
  getInsights: (month) => buildInsights(month),
  getRecurring: (month) => sdk.getRecurring(month),
  getCategoryTrend: (month, months = 3) => sdk.getCategoryTrend(month, months),

  getUploads: (period) => sdk.getUploads(period || isoMonth()),
  uploadFile: async (formData) => {
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new ApiError("No se encontró archivo para subir.");
    }

    return requestCompat("/api/upload", {
      method: "POST",
      body: formData,
      timeoutMs: Math.max(appConfig.apiTimeoutMs, 90000),
    });
  },

  getBankFormats: () => sdk.getBankFormats(),
  getBankFormat: (key) => sdk.getBankFormat(key),
  suggestBankFormat: (body) => sdk.suggestBankFormat(body),
  saveBankFormat: (body) => sdk.saveBankFormat(body),
  deleteBankFormat: (key) => sdk.deleteBankFormat(key),

  assistantChat: ({ month, question }) => sdk.assistantChat({ month, question }),
};
