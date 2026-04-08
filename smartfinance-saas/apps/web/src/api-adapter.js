import { createApiClient } from "@smartfinance/client-sdk";
import { api, getTokenGetter, requestCompat, setTokenGetter } from "./api-core";
import { appConfig } from "./config";
import { isoMonth } from "./utils";

const sdk = createApiClient({
  baseUrl: appConfig.apiBaseUrl || "",
  getToken: () => {
    const getter = getTokenGetter();
    return getter ? getter() : null;
  },
});

const originalGetTransactions = api.getTransactions.bind(api);
const originalGetCategories = api.getCategories.bind(api);
const originalGetAccounts = api.getAccounts.bind(api);
const originalGetSettings = api.getSettings.bind(api);

function shiftMonth(month, delta) {
  const [year, monthNumber] = String(month || isoMonth()).split("-").map(Number);
  const cursor = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function listMonthWindow(endMonth, count = 6) {
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth || isoMonth(), index - count + 1));
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
  return cleaned
    .split(" ")
    .filter((token) => token.length > 2)
    .slice(0, 3)
    .join(" ")
    .trim();
}

async function getTransactionsWindow(endMonth, months = 12) {
  const monthKeys = listMonthWindow(endMonth || isoMonth(), months);
  const monthlyTransactions = await Promise.all(monthKeys.map((month) => originalGetTransactions(month).catch(() => [])));
  return monthlyTransactions.flat();
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

async function findExistingRule(input) {
  const rules = await sdk.getRules();
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

function readBankFormats() {
  try {
    return JSON.parse(localStorage.getItem("sf_bank_formats") || "[]");
  } catch {
    return [];
  }
}

function writeBankFormats(value) {
  localStorage.setItem("sf_bank_formats", JSON.stringify(value));
}

api.updateTransaction = async (id, body) => {
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
};

api.searchTransactions = async (query, limit = 25) => {
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

      return {
        score: haystack.startsWith(normalizedQuery) ? 3 : haystack.includes(normalizedQuery) ? 2 : 0,
        transaction,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || String(right.transaction.fecha).localeCompare(String(left.transaction.fecha)))
    .slice(0, limit)
    .map((item) => item.transaction);
};

api.batchCreateTransactions = async (body) => {
  const month = body.period || isoMonth();
  const beforeTransactions = await originalGetTransactions(month);
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
    originalGetCategories(),
    originalGetSettings().catch(() => ({})),
    originalGetTransactions(month),
  ]);
  const importedTransactions = afterTransactions.filter((transaction) => !beforeIds.has(Number(transaction.id)));

  return {
    created: created.length,
    duplicates,
    errors,
    ...buildImportReviewState(importedTransactions, categories, settings),
    guided_onboarding_session: null,
  };
};

api.resumePendingGuidedReview = async ({ transaction_ids = [], month = isoMonth() } = {}) => {
  const [categories, settings, transactions] = await Promise.all([
    originalGetCategories(),
    originalGetSettings().catch(() => ({})),
    originalGetTransactions(month),
  ]);
  const pendingTransactions = transactions.filter((transaction) => (
    transaction_ids.includes(Number(transaction.id))
    && String(transaction.categorization_status || "") !== "categorized"
  ));

  return {
    ...buildImportReviewState(pendingTransactions, categories, settings),
    guided_onboarding_session: null,
  };
};

api.deleteTransaction = async (id) => {
  await requestCompat(`/api/transactions/${id}`, { method: "DELETE" });
  return { deleted: true };
};

api.getCandidates = async (pattern, categoryId) => {
  const existingRule = await findExistingRule({ pattern, category_id: categoryId });
  if (existingRule?.id) {
    try {
      const candidates = await sdk.getRuleCandidates(existingRule.id);
      const [categories, accounts] = await Promise.all([originalGetCategories(), originalGetAccounts()]);
      return candidates.map((candidate) => {
        const category = categories.find((item) => Number(item.id) === Number(candidate.category_id));
        const account = accounts.find((item) => item.id === candidate.account_id);
        return {
          ...candidate,
          category_name: category?.name || null,
          category_type: category?.type || null,
          category_color: category?.color || null,
          account_name: account?.name || null,
        };
      });
    } catch {
      // fall through to heuristic lookup
    }
  }

  const transactions = await getTransactionsWindow(isoMonth(), 12);
  const normalizedPattern = normalizeMatcher(pattern);
  return transactions
    .filter((transaction) => String(transaction.categorization_status || "") !== "categorized")
    .filter((transaction) => normalizeMatcher(transaction.desc_banco).includes(normalizedPattern))
    .slice(0, 50);
};

api.confirmCategory = async (transactionIds, categoryId) => {
  const result = await sdk.assignCategoryToTransactions({
    transaction_ids: transactionIds.map((id) => Number(id)),
    category_id: Number(categoryId),
  });
  return {
    confirmed: result.processed,
    transactions: result.transactions,
  };
};

api.rejectCategory = async (transactionId) => sdk.rejectSuggestion(transactionId);
api.undoConfirmCategory = async (transactionId) => sdk.updateTransaction(transactionId, { category_id: null });
api.deleteCategory = async (id) => requestCompat(`/api/categories/${id}`, { method: "DELETE" });

api.createRule = async (body) => {
  try {
    const result = await sdk.createRule(body);
    return {
      ...result.rule,
      candidates_count: result.application.affected_transactions,
      duplicate: false,
    };
  } catch (error) {
    if (error?.code !== "RULE_CONFLICT") throw error;
    const existing = await findExistingRule(body);
    if (!existing) throw error;
    return {
      ...existing,
      candidates_count: await getRuleCandidatesCount(existing.id),
      duplicate: true,
    };
  }
};

api.resetRules = async () => {
  const rules = await sdk.getRules();
  await Promise.all(rules.map((rule) => sdk.deleteRule(rule.id)));
  return { deleted_count: rules.length, rules_count: 0 };
};

api.getRecurring = async (month) => {
  const transactions = await getTransactionsWindow(month || isoMonth(), 6);
  const categories = await originalGetCategories();
  const grouped = new Map();

  transactions
    .filter((transaction) => Number(transaction.monto) < 0 && transaction.movement_kind !== "internal_transfer")
    .forEach((transaction) => {
      const key = deriveMeaningfulPattern(transaction.desc_banco) || normalizeMatcher(transaction.desc_banco);
      if (!key) return;

      const group = grouped.get(key) || {
        key,
        desc_banco: transaction.desc_banco,
        moneda: transaction.moneda,
        total_amount: 0,
        occurrences: 0,
        months_seen: new Set(),
        category_ids: [],
      };

      group.total_amount += Math.abs(Number(transaction.monto));
      group.occurrences += 1;
      group.months_seen.add(transaction.period);
      if (transaction.category_id != null) {
        group.category_ids.push(Number(transaction.category_id));
      }
      grouped.set(key, group);
    });

  return [...grouped.values()]
    .filter((group) => group.months_seen.size >= 2)
    .map((group) => {
      const categoryId = group.category_ids[0] || null;
      const category = categoryId != null
        ? categories.find((item) => Number(item.id) === Number(categoryId))
        : null;
      return {
        desc_banco: group.desc_banco,
        moneda: group.moneda,
        avg_amount: group.total_amount / group.occurrences,
        occurrences: group.occurrences,
        months_seen: [...group.months_seen].sort(),
        category_name: category?.name || null,
        category_color: category?.color || null,
      };
    })
    .sort((left, right) => right.occurrences - left.occurrences || right.avg_amount - left.avg_amount);
};

api.uploadFile = async (formData) => {
  const file = formData.get("file");
  const accountId = formData.get("account_id") || undefined;
  const period = String(formData.get("period") || isoMonth());
  const extractedText = String(formData.get("extracted_text") || "");

  if (!(file instanceof File)) {
    throw new Error("No se encontró archivo para subir.");
  }

  const beforeTransactions = await originalGetTransactions(period);
  const beforeIds = new Set(beforeTransactions.map((transaction) => Number(transaction.id)));
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
  const content = extractedText || ((lowerName.endsWith(".csv") || lowerName.endsWith(".txt")) ? await file.text() : "");

  if (content) {
    const preview = await sdk.previewUpload({
      period,
      source_type: lowerName.endsWith(".csv") ? "csv" : "text",
      content,
    });
    const processed = await sdk.processUpload({
      upload_id: intent.upload.id,
      transactions: preview.transactions,
    });
    const [categories, settings, afterTransactions] = await Promise.all([
      originalGetCategories(),
      originalGetSettings().catch(() => ({})),
      originalGetTransactions(period),
    ]);
    const importedTransactions = afterTransactions.filter((transaction) => !beforeIds.has(Number(transaction.id)));

    return {
      upload_id: intent.upload.id,
      new_transactions: processed.created,
      duplicates_skipped: processed.duplicates_skipped,
      auto_categorized: processed.auto_categorized,
      pending_review: processed.pending_review + processed.suggested,
      ...buildImportReviewState(importedTransactions, categories, settings),
    };
  }

  return {
    upload_id: intent.upload.id,
    new_transactions: 0,
    duplicates_skipped: 0,
    auto_categorized: 0,
    pending_review: 0,
    review_groups: [],
    guided_review_groups: [],
    transaction_review_queue: [],
    guided_onboarding_required: false,
    unsupported: true,
  };
};

api.getBankFormats = async () => readBankFormats();
api.getBankFormat = async (key) => readBankFormats().find((item) => (item.format_key || item.key) === key) || null;
api.saveBankFormat = async (body) => {
  const formatKey = body.format_key || body.key;
  const current = readBankFormats().filter((item) => (item.format_key || item.key) !== formatKey);
  const next = [...current, { ...body, format_key: formatKey }];
  writeBankFormats(next);
  return { ...body, format_key: formatKey };
};
api.deleteBankFormat = async (key) => {
  writeBankFormats(readBankFormats().filter((item) => (item.format_key || item.key) !== key));
  return { deleted: true };
};

export { api, setTokenGetter };
