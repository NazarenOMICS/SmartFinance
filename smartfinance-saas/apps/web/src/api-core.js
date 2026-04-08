import { createApiClient } from "@smartfinance/client-sdk";
import { appConfig } from "./config";
import {
  convertCurrencyAmount,
  getExchangeRateMap,
  getExchangeRateSettingKey,
  isoMonth,
} from "./utils";

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

function calculateDeltaPercent(current, previous) {
  const prev = Number(previous || 0);
  const next = Number(current || 0);
  if (!prev) return next ? 100 : 0;
  return ((next - prev) / Math.abs(prev)) * 100;
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

async function buildSummary(month) {
  const previousMonth = shiftMonth(month, -1);
  const [transactions, previousTransactions, categories, settings] = await Promise.all([
    getTransactionsRich(month),
    getTransactionsRich(previousMonth).catch(() => []),
    getCategoriesRich(),
    sdk.getSettings(),
  ]);

  const expenseTransactions = transactions.filter((tx) => Number(tx.monto) < 0 && tx.movement_kind !== "internal_transfer");
  const incomeTransactions = transactions.filter((tx) => Number(tx.monto) > 0 && tx.movement_kind !== "internal_transfer");
  const previousExpenseTransactions = previousTransactions.filter((tx) => Number(tx.monto) < 0 && tx.movement_kind !== "internal_transfer");
  const previousIncomeTransactions = previousTransactions.filter((tx) => Number(tx.monto) > 0 && tx.movement_kind !== "internal_transfer");
  const pendingCount = transactions.filter((tx) => String(tx.categorization_status || "") !== "categorized").length;
  const incomeTotal = incomeTransactions.reduce((sum, tx) => sum + Number(tx.monto), 0);
  const expensesTotal = expenseTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.monto)), 0);
  const previousIncomeTotal = previousIncomeTransactions.reduce((sum, tx) => sum + Number(tx.monto), 0);
  const previousExpensesTotal = previousExpenseTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.monto)), 0);

  const byCategory = categories
    .filter((category) => category.name !== "Ingreso")
    .map((category) => {
      const spent = expenseTransactions
        .filter((tx) => Number(tx.category_id) === Number(category.id))
        .reduce((sum, tx) => sum + Math.abs(Number(tx.monto)), 0);
      return {
        id: category.id,
        name: category.name,
        slug: category.slug,
        spent,
        budget: Number(category.budget || 0),
        color: category.color,
        type: category.type,
      };
    })
    .filter((item) => item.spent > 0 || item.budget > 0)
    .sort((a, b) => b.spent - a.spent);

  const fixedSpent = byCategory
    .filter((item) => item.type === "fijo")
    .reduce((sum, item) => sum + item.spent, 0);
  const variableSpent = byCategory
    .filter((item) => item.type !== "fijo")
    .reduce((sum, item) => sum + item.spent, 0);

  return {
    month,
    currency: settings.display_currency || "UYU",
    pending_count: pendingCount,
    totals: {
      income: incomeTotal,
      expenses: expensesTotal,
      margin: incomeTotal - expensesTotal,
      installments: transactions.filter((tx) => tx.es_cuota).reduce((sum, tx) => sum + Math.abs(Number(tx.monto)), 0),
      savings_monthly_target: Number(settings.savings_monthly || 0),
    },
    deltas: {
      income: calculateDeltaPercent(incomeTotal, previousIncomeTotal),
      expenses: calculateDeltaPercent(expensesTotal, previousExpensesTotal),
    },
    byCategory,
    byType: {
      fijo: fixedSpent,
      variable: variableSpent,
    },
    budgets: byCategory.map((item) => ({
      id: item.id,
      category_id: item.id,
      name: item.name,
      spent: item.spent,
      budget: item.budget,
      color: item.color,
      type: item.type,
    })),
  };
}

async function buildCategoryTrend(endMonth, months = 4) {
  const categories = await getCategoriesRich();
  const monthSeries = await sdk.getTransactionMonthlyEvolution(months, endMonth);
  const monthKeys = monthSeries.map((item) => item.month);
  const allTransactions = await Promise.all(monthKeys.map((month) => getTransactionsRich(month)));

  return monthKeys.map((month, index) => {
    const monthTransactions = allTransactions[index] || [];
    const byCategory = {};
    categories.forEach((category) => {
      const spent = monthTransactions
        .filter((tx) => Number(tx.monto) < 0 && Number(tx.category_id) === Number(category.id))
        .reduce((sum, tx) => sum + Math.abs(Number(tx.monto)), 0);
      if (spent > 0) {
        byCategory[category.name] = spent;
      }
    });
    return { month, byCategory };
  });
}

async function buildConsolidatedAccounts() {
  const [accounts, settings] = await Promise.all([getAccountsRich(), sdk.getSettings()]);
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(settings);
  const total = accounts.reduce(
    (sum, account) => sum + convertCurrencyAmount(Number(account.balance || 0), account.currency, displayCurrency, exchangeRates),
    0,
  );

  return {
    total,
    currency: displayCurrency,
    accounts: accounts.map((account) => ({
      ...account,
      converted_balance: convertCurrencyAmount(Number(account.balance || 0), account.currency, displayCurrency, exchangeRates),
    })),
  };
}

async function buildProjection(endMonth, months = 12) {
  const series = await sdk.getTransactionMonthlyEvolution(months, endMonth);
  const monthlyNet = series.map((point) => ({ month: point.month, value: point.net }));
  const average = monthlyNet.length
    ? monthlyNet.reduce((sum, point) => sum + point.value, 0) / monthlyNet.length
    : 0;

  return {
    series: monthlyNet,
    commitments: [],
    avg_savings: average,
    avg_monthly_savings: average,
    monthly_installments: 0,
    net_savings: average,
  };
}

async function buildInsights(month) {
  const [summary, projection, settings] = await Promise.all([
    buildSummary(month),
    buildProjection(month, 6),
    sdk.getSettings(),
  ]);

  const averageDaily = summary.totals.expenses / 30;
  const savingsGoal = Number(settings.savings_goal || 0);
  const savingsInitial = Number(settings.savings_initial || 0);
  const etaMonths = projection.avg_monthly_savings > 0
    ? Math.max(0, Math.ceil((savingsGoal - savingsInitial) / projection.avg_monthly_savings))
    : null;

  return {
    biggest_increase: summary.byCategory[0]
      ? {
          category: summary.byCategory[0].name,
          delta_pct: 0,
          current_amount: summary.byCategory[0].spent,
          previous_amount: summary.byCategory[0].spent,
        }
      : null,
    average_daily_spend: averageDaily,
    budget_per_day: Math.max(0, (summary.totals.margin || 0) / 30),
    remaining_days: 15,
    eta_months: etaMonths,
  };
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

const BANK_FORMATS_KEY = "sf_bank_formats";

function readBankFormats() {
  try {
    return JSON.parse(localStorage.getItem(BANK_FORMATS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeBankFormats(value) {
  localStorage.setItem(BANK_FORMATS_KEY, JSON.stringify(value));
}

export const api = {
  getDashboard: (month) => buildSummary(month),
  getSchemaStatus: () => sdk.getSchemaStatus(),

  onboard: async () => {
    const response = await sdk.onboard();
    return { ...response, status: "existing" };
  },
  claimLegacy: async () => ({ ok: false, claimed: false }),
  completeGuidedCategorizationOnboarding: () => sdk.updateSetting({ key: "guided_categorization_onboarding_completed", value: "1" }),
  skipGuidedCategorizationOnboarding: () => sdk.updateSetting({ key: "guided_categorization_onboarding_skipped", value: "1" }),

  getSummary: (month) => buildSummary(month),
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
  markTransactionMovement: async (id, kind) => {
    const currentMonth = isoMonth();
    const transactions = await getTransactionsRich(currentMonth);
    const transaction = transactions.find((item) => Number(item.id) === Number(id));
    return { transaction: transaction ? { ...transaction, movement_kind: kind } : null };
  },
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
  searchTransactions: async (query, limit = 25) => {
    const normalizedQuery = normalizeMatcher(query);
    if (normalizedQuery.length < 2) return [];

    const transactions = await getTransactionsWindow(isoMonth(), 12);
    return transactions
      .map((transaction) => {
        const haystack = normalizeMatcher([
          transaction.desc_banco,
          transaction.desc_usuario,
          transaction.category_name,
          transaction.account_name,
          transaction.fecha,
          Math.abs(Number(transaction.monto || 0)),
        ].filter(Boolean).join(" "));
        const startsWith = haystack.startsWith(normalizedQuery);
        const includes = haystack.includes(normalizedQuery);
        return {
          score: startsWith ? 3 : includes ? 2 : 0,
          transaction,
        };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || String(right.transaction.fecha).localeCompare(String(left.transaction.fecha)))
      .slice(0, limit)
      .map((item) => item.transaction);
  },
  batchCreateTransactions: async (body) => {
    const month = body.period || isoMonth();
    const beforeTransactions = await getTransactionsRich(month);
    const beforeIds = new Set(beforeTransactions.map((transaction) => Number(transaction.id)));
    const created = [];
    let duplicates = 0;
    let errors = 0;
    for (const transaction of body.transactions || []) {
      try {
        const result = await sdk.createTransaction({
          ...transaction,
          account_id: transaction.account_id || body.account_id,
          entry_type: transaction.entry_type || (Number(transaction.monto) >= 0 ? "income" : "expense"),
          moneda: transaction.moneda || "UYU",
        });
        created.push(result);
      } catch (error) {
        if (String(error?.message || "").toLowerCase().includes("exists")) duplicates += 1;
        else errors += 1;
      }
    }
    const [categories, settings, afterTransactions] = await Promise.all([
      getCategoriesRich(),
      sdk.getSettings().catch(() => ({})),
      getTransactionsRich(month),
    ]);
    const importedTransactions = afterTransactions.filter((transaction) => !beforeIds.has(Number(transaction.id)));
    const reviewState = buildImportReviewState(importedTransactions, categories, settings);
    return {
      created: created.length,
      duplicates,
      errors,
      ...reviewState,
      guided_onboarding_session: null,
    };
  },
  resumePendingGuidedReview: async ({ transaction_ids = [], month = isoMonth() } = {}) => {
    const [categories, settings, transactions] = await Promise.all([
      getCategoriesRich(),
      sdk.getSettings().catch(() => ({})),
      getTransactionsRich(month),
    ]);
    const pendingTransactions = transactions.filter((transaction) => (
      transaction_ids.includes(Number(transaction.id))
      && String(transaction.categorization_status || "") !== "categorized"
    ));
    return {
      ...buildImportReviewState(pendingTransactions, categories, settings),
      guided_onboarding_session: null,
    };
  },
  confirmInternalOperation: async () => ({ ok: true, transaction: null }),
  rejectInternalOperation: async () => ({ ok: true, transaction: null }),
  getEvolution: (end, months = 6) => sdk.getTransactionMonthlyEvolution(months, end),
  deleteTransaction: async () => {
    throw new ApiError("Eliminar transacciones todavía no está disponible en SaaS.");
  },
  getCandidates: async () => [],
  confirmCategory: async (transactionIds) => sdk.acceptSuggestions({ transaction_ids: transactionIds }),
  rejectCategory: async (transactionId) => sdk.rejectSuggestion(transactionId),
  undoRejectCategory: async () => ({ undone: false }),
  undoConfirmCategory: async (transactionId, categoryId) => sdk.updateTransaction(transactionId, { category_id: categoryId ?? null }),

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
  deleteAccount: (id) => sdk.deleteAccount(id),
  getConsolidatedAccounts: () => buildConsolidatedAccounts(),
  getAccountLinks: async () => [],
  createAccountLink: async () => {
    throw new ApiError("Account linking todavía no está migrado al SaaS.");
  },
  reconcileAccountLink: async () => ({ reconciled_pairs: 0 }),
  deleteAccountLink: async () => ({ deleted: false }),

  getRules: async () => {
    const [rules, categories, accounts] = await Promise.all([
      sdk.getRules(),
      getCategoriesRich(),
      getAccountsRich(),
    ]);
    return enrichRules(rules, categories, accounts);
  },
  createRule: async (body) => {
    const result = await sdk.createRule(body);
    return {
      ...result.rule,
      candidates_count: result.application.affected_transactions,
      duplicate: false,
    };
  },
  updateRule: async (id, body) => {
    const result = await sdk.updateRule(id, body);
    return result.rule;
  },
  resetRules: async () => ({ deleted_count: 0, rules_count: 0 }),
  deleteRule: (id) => sdk.deleteRule(id),

  getInstallments: async () => [],
  createInstallment: async () => {
    throw new ApiError("Cuotas todavía no están migradas al SaaS.");
  },
  updateInstallment: async () => {
    throw new ApiError("Cuotas todavía no están migradas al SaaS.");
  },
  deleteInstallment: async () => {
    throw new ApiError("Cuotas todavía no están migradas al SaaS.");
  },
  getCommitments: async () => [],

  getSettings: () => sdk.getSettings(),
  updateSetting: async (key, value) => sdk.updateSetting({ key, value: String(value) }),
  refreshRates: async () => ({ ok: false, source: "manual" }),

  getProjection: (end, months = 12) => buildProjection(end, months),
  getInsights: (month) => buildInsights(month),
  getRecurring: async () => [],
  getCategoryTrend: (month, months = 3) => buildCategoryTrend(month, months),

  getUploads: (period) => sdk.getUploads(period || isoMonth()),
  uploadFile: async (formData) => {
    const file = formData.get("file");
    const accountId = formData.get("account_id") || undefined;
    const period = String(formData.get("period") || isoMonth());

    if (!(file instanceof File)) {
      throw new ApiError("No se encontró archivo para subir.");
    }

    const intent = await sdk.createUploadIntent({
      original_filename: file.name,
      mime_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      period,
      account_id: accountId ? String(accountId) : undefined,
      source: "web",
    });

    await sdk.markUploadUploaded(intent.upload.id);

    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) {
      const preview = await parseUploadedFile(file, period);
      return sdk.processUpload({
        upload_id: intent.upload.id,
        transactions: preview.transactions,
      });
    }

    return {
      upload_id: intent.upload.id,
      new_transactions: 0,
      duplicates_skipped: 0,
      auto_categorized: 0,
      pending_review: 0,
      unsupported: true,
    };
  },

  getBankFormats: async () => readBankFormats(),
  getBankFormat: async (key) => readBankFormats().find((item) => item.key === key) || null,
  saveBankFormat: async (body) => {
    const current = readBankFormats().filter((item) => item.key !== body.key);
    const next = [...current, { ...body }];
    writeBankFormats(next);
    return body;
  },
  deleteBankFormat: async (key) => {
    writeBankFormats(readBankFormats().filter((item) => item.key !== key));
    return { deleted: true };
  },

  assistantChat: async ({ month, question }) => {
    const summary = await buildSummary(month);
    return {
      answer: `Todavía no migramos el asistente conversacional. Como referencia rápida: ingresos ${summary.totals.income}, gastos ${summary.totals.expenses} y margen ${summary.totals.margin}. Pregunta: ${question}`,
    };
  },
};
