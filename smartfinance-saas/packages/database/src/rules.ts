import type { CreateRuleInput, UpdateRuleInput } from "@smartfinance/contracts";
import {
  buildManualRuleUpsert,
  classifyTransaction as classifyTransactionWithCanonicalRules,
  calculateAmountSimilarity,
  calculateLearnedRuleConfidence,
  deriveCounterpartyKey,
  deriveRulePattern,
  deriveRuleIdentity,
  normalizeRulePattern,
  selectBestRuleMatch,
} from "@smartfinance/domain";
import { allRows, firstRow, runStatement, type D1DatabaseLike } from "./client";
import { getSettingsObject } from "./settings";

export type RuleRow = {
  id: number;
  pattern: string;
  normalized_pattern: string;
  category_id: number | null;
  category_name: string | null;
  match_count: number;
  mode: "auto" | "suggest" | "disabled";
  confidence: number;
  source: "manual" | "seed" | "learned" | "guided";
  account_id: string | null;
  merchant_scope: string | null;
  account_scope: string | null;
  currency: string | null;
  currency_scope: string | null;
  direction: "any" | "expense" | "income";
  merchant_key: string | null;
  last_matched_at: string | null;
  created_at: string;
  updated_at?: string | null;
};

export type RuleInsightRow = {
  kind: "duplicate_scope" | "overlap" | "weak_auto";
  title: string;
  description: string;
  rule_ids: number[];
  recommended_action: "merge" | "disable" | "lower_to_suggest" | "review";
  priority: "high" | "medium" | "low";
};

export type AmountProfileRow = {
  id: number;
  counterparty_key: string;
  normalized_pattern: string;
  category_id: number;
  category_name: string | null;
  account_id: string | null;
  currency: "UYU" | "USD" | "EUR" | "ARS";
  direction: "any" | "expense" | "income";
  amount_median: number;
  amount_min: number;
  amount_max: number;
  amount_p25: number | null;
  amount_p75: number | null;
  sample_count: number;
  confidence: number;
  status: "active" | "disabled";
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

type RuleScope = {
  account_id?: string | null;
  currency?: "UYU" | "USD" | "EUR" | "ARS" | null;
  direction?: "any" | "expense" | "income";
};

type CategorizationDecision = {
  categoryId: number | null;
  categorizationStatus: "uncategorized" | "suggested" | "categorized";
  categorySource: string | null;
  categoryConfidence: number | null;
  categoryRuleId: number | null;
  matchedRule: RuleRow | null;
  amountProfileId?: number | null;
  amountProfile?: AmountProfileRow | null;
  amountSimilarity?: number | null;
  conflictCandidates?: Array<Record<string, unknown>>;
};

type RuleApplicationSummary = {
  affected_transactions: number;
  categorized_transactions: number;
  suggested_transactions: number;
};

type CategoryMatchRow = {
  id: number;
  slug?: string | null;
  name: string;
  type: string | null;
  color: string | null;
};

function normalizeRuleScope(scope: RuleScope = {}) {
  return {
    account_id: scope.account_id ?? null,
    currency: scope.currency ?? null,
    direction: scope.direction ?? "any",
  };
}

function buildScopeKey(rule: Pick<RuleRow, "account_id" | "currency" | "direction">) {
  return [rule.account_id || "", rule.currency || "", rule.direction || "any"].join("::");
}

async function getRuleThresholds(db: D1DatabaseLike, userId: string) {
  const settings = await getSettingsObject(db, userId);
  const autoThreshold = Number(settings.categorizer_auto_threshold || "0.9");
  const suggestThreshold = Number(settings.categorizer_suggest_threshold || "0.72");

  return {
    autoThreshold: Number.isFinite(autoThreshold) ? autoThreshold : 0.9,
    suggestThreshold: Number.isFinite(suggestThreshold) ? suggestThreshold : 0.72,
  };
}

async function getAmountProfileSettings(db: D1DatabaseLike, userId: string) {
  const settings = await getSettingsObject(db, userId);
  const autoThreshold = Number(settings.categorizer_amount_auto_threshold || "0.92");
  const suggestThreshold = Number(settings.categorizer_amount_suggest_threshold || "0.74");

  return {
    enabled: String(settings.categorizer_amount_profiles_enabled ?? "1") !== "0",
    autoThreshold: Number.isFinite(autoThreshold) ? autoThreshold : 0.92,
    suggestThreshold: Number.isFinite(suggestThreshold) ? suggestThreshold : 0.74,
  };
}

const CATEGORY_KEYWORD_ALIASES: Record<string, string[]> = {
  supermercado: ["supermercado", "devoto", "disco", "tienda inglesa", "geant", "frog", "kinko"],
  transporte: ["uber", "cabify", "bolt", "didi", "taxi", "peaje", "parking", "nafta", "combustible"],
  suscripciones: ["spotify", "netflix", "openai", "chatgpt", "anthropic", "claude", "youtube", "apple.com/bill"],
  restaurantes: ["mcdonald", "burger", "restaurant", "restaurante", "bar", "cafe", "cafeteria", "mostaza", "la pasiva"],
  delivery: ["pedidosya", "rappi", "uber eats"],
  servicios: ["ute", "ose", "antel", "internet", "energia", "agua", "gas"],
  alquiler: ["alquiler", "arrendamiento"],
  salud: ["farmashop", "farmacia", "clinica", "medico", "laboratorio", "hospital"],
  ingreso: ["sueldo", "nomina", "salary", "haberes", "ingreso"],
};

const REINTEGRO_KEYWORDS = [
  "devolucion",
  "devol",
  "reintegro",
  "reversa",
  "reverso",
  "cashback",
  "contracargo",
  "reversal",
];

const TRANSFER_KEYWORDS = [
  "supernet tc",
  "compra de dolares",
  "venta de dolares",
  "compra dolares",
  "venta dolares",
  "compra divisa",
  "venta divisa",
  "compra moneda extranjera",
  "venta moneda extranjera",
  "cambio divisas",
  "cambio de moneda",
  "transferencia propia",
  "transferencia entre cuentas",
  "transferencia interna",
  "movimiento entre cuentas",
  "transferencia inmediata",
  "transferencia realizada",
  "transf recibida",
  "debito debin",
  "credito debin",
];

const PERSON_TRANSFER_HINTS = [
  "transferencia enviada",
  "transferencia inmediata a",
  "transferencia realizada a",
  "transf recibida",
  "trf plaza",
  "trf. plaza",
];

const SUPERNET_INCOME_HINTS = [
  "credito por operacion en supernet p--/",
  "credito por operacion en supernet p ",
  "credito por operacion en supernet p-/",
];

const EDUCATION_HINTS = [
  "educuniversida",
  "educacion universitaria",
  "cuota ort",
  "ort centro",
  " universidad ",
  " facultad ",
  " curso ",
];

const CARD_PURCHASE_HINTS = [
  "compra con tarjeta",
  "compra tarjeta",
  "compra con debito",
  "compra con credito",
  "compra internacional",
  "dlo.",
];

function normalizeMatcher(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function listCategoriesForMatching(db: D1DatabaseLike, userId: string) {
  return allRows<CategoryMatchRow>(
    db,
    "SELECT id, slug, name, type, color FROM categories WHERE user_id = ? ORDER BY sort_order ASC, id ASC",
    [userId],
  );
}

async function findHistoryCategoryMatch(
  db: D1DatabaseLike,
  userId: string,
  input: {
    descBanco: string;
    accountId?: string | null;
    currency?: string | null;
    entryType: "expense" | "income";
  },
) {
  const pattern = normalizeRulePattern(deriveRulePattern(input.descBanco) || input.descBanco);
  if (!pattern) return null;

  const row = await firstRow<{
    category_id: number;
    matches: number;
  }>(
    db,
    `
      SELECT
        category_id,
        COUNT(*) AS matches
      FROM transactions
      WHERE user_id = ?
        AND category_id IS NOT NULL
        AND movement_kind = 'normal'
        AND LOWER(desc_banco) LIKE '%' || ? || '%'
        AND (? IS NULL OR account_id = ? OR account_id IS NULL)
        AND (? IS NULL OR moneda = ?)
        AND ((? = 'expense' AND monto < 0) OR (? = 'income' AND monto > 0))
      GROUP BY category_id
      ORDER BY matches DESC, category_id ASC
      LIMIT 1
    `,
    [
      userId,
      pattern,
      input.accountId ?? null,
      input.accountId ?? null,
      input.currency ?? null,
      input.currency ?? null,
      input.entryType,
      input.entryType,
    ],
  );

  if (!row?.category_id || Number(row.matches || 0) < 2) {
    return null;
  }

  return {
    categoryId: Number(row.category_id),
    confidence: Math.min(0.78 + (Number(row.matches) - 2) * 0.04, 0.9),
    source: "history",
  };
}

async function findKeywordCategoryMatch(db: D1DatabaseLike, userId: string, descBanco: string) {
  const categories = await listCategoriesForMatching(db, userId);
  const categoryBySlug = new Map(
    categories.map((category) => [normalizeMatcher(category.name), category]),
  );
  const normalizedDescription = ` ${normalizeMatcher(descBanco)} `;

  for (const [slug, aliases] of Object.entries(CATEGORY_KEYWORD_ALIASES)) {
    if (!aliases.some((alias) => normalizedDescription.includes(` ${normalizeMatcher(alias)} `))) {
      continue;
    }
    const category = categoryBySlug.get(slug)
      || categories.find((item) => normalizeMatcher(item.name).includes(slug))
      || null;
    if (!category) continue;
    return {
      categoryId: Number(category.id),
      confidence: slug === "delivery" || slug === "suscripciones" ? 0.82 : 0.74,
      source: "keyword",
    };
  }

  return null;
}

function quantile(sortedValues: number[], q: number) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sortedValues[base + 1];
  if (next === undefined) return sortedValues[base];
  return Number((sortedValues[base] + rest * (next - sortedValues[base])).toFixed(2));
}

function buildAmountBucket(amount: number, currency: string) {
  const absolute = Math.abs(Number(amount || 0));
  const step = currency === "USD" || currency === "EUR" ? 25 : currency === "ARS" ? 10000 : 1000;
  return `${currency}:${Math.round(absolute / step) * step}`;
}

function amountProfileReason(profile: AmountProfileRow, similarity: number) {
  const roundedMedian = Math.round(Number(profile.amount_median || 0));
  const percent = Math.round(similarity * 100);
  return `Parece ${profile.category_name || "esta categoria"}: ${profile.counterparty_key} con monto parecido a ${profile.sample_count} pago(s) anteriores, mediana ${roundedMedian} ${profile.currency}, similitud ${percent}%.`;
}

export async function listAmountProfiles(db: D1DatabaseLike, userId: string) {
  return allRows<AmountProfileRow>(
    db,
    `
      SELECT
        profiles.id,
        profiles.counterparty_key,
        profiles.normalized_pattern,
        profiles.category_id,
        categories.name AS category_name,
        profiles.account_id,
        profiles.currency,
        profiles.direction,
        profiles.amount_median,
        profiles.amount_min,
        profiles.amount_max,
        profiles.amount_p25,
        profiles.amount_p75,
        profiles.sample_count,
        profiles.confidence,
        profiles.status,
        profiles.last_seen_at,
        profiles.created_at,
        profiles.updated_at
      FROM categorization_profiles profiles
      LEFT JOIN categories
        ON categories.user_id = profiles.user_id
       AND categories.id = profiles.category_id
      WHERE profiles.user_id = ?
      ORDER BY profiles.updated_at DESC, profiles.sample_count DESC, profiles.confidence DESC
    `,
    [userId],
  );
}

export async function disableAmountProfile(db: D1DatabaseLike, userId: string, profileId: number) {
  await runStatement(
    db,
    "UPDATE categorization_profiles SET status = 'disabled', updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id = ?",
    [userId, profileId],
  );
  return listAmountProfiles(db, userId);
}

async function upsertAmountProfile(
  db: D1DatabaseLike,
  userId: string,
  input: {
    counterpartyKey: string;
    categoryId: number;
    accountId?: string | null;
    currency: "UYU" | "USD" | "EUR" | "ARS";
    direction: "expense" | "income";
    amounts: number[];
  },
) {
  const values = input.amounts
    .map((value) => Math.abs(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);
  if (values.length === 0) return null;

  const median = quantile(values, 0.5) ?? values[0];
  const p25 = quantile(values, 0.25);
  const p75 = quantile(values, 0.75);
  const confidence = Math.min(0.97, Number((0.68 + Math.log10(values.length + 1) * 0.18).toFixed(2)));
  const existing = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM categorization_profiles
      WHERE user_id = ?
        AND counterparty_key = ?
        AND category_id = ?
        AND IFNULL(account_id, '') = IFNULL(?, '')
        AND currency = ?
        AND direction = ?
      LIMIT 1
    `,
    [userId, input.counterpartyKey, input.categoryId, input.accountId ?? null, input.currency, input.direction],
  );

  if (existing) {
    await runStatement(
      db,
      `
        UPDATE categorization_profiles
        SET amount_median = ?,
            amount_min = ?,
            amount_max = ?,
            amount_p25 = ?,
            amount_p75 = ?,
            sample_count = ?,
            confidence = MAX(confidence, ?),
            status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END,
            last_seen_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `,
      [
        median,
        values[0],
        values[values.length - 1],
        p25,
        p75,
        values.length,
        confidence,
        userId,
        existing.id,
      ],
    );
  } else {
    await runStatement(
      db,
      `
        INSERT INTO categorization_profiles (
          user_id, counterparty_key, normalized_pattern, category_id, account_id, currency, direction,
          amount_median, amount_min, amount_max, amount_p25, amount_p75, sample_count, confidence, status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
      [
        userId,
        input.counterpartyKey,
        input.counterpartyKey,
        input.categoryId,
        input.accountId ?? null,
        input.currency,
        input.direction,
        median,
        values[0],
        values[values.length - 1],
        p25,
        p75,
        values.length,
        confidence,
      ],
    );
  }

  return firstRow<AmountProfileRow>(
    db,
    `
      SELECT
        profiles.id,
        profiles.counterparty_key,
        profiles.normalized_pattern,
        profiles.category_id,
        categories.name AS category_name,
        profiles.account_id,
        profiles.currency,
        profiles.direction,
        profiles.amount_median,
        profiles.amount_min,
        profiles.amount_max,
        profiles.amount_p25,
        profiles.amount_p75,
        profiles.sample_count,
        profiles.confidence,
        profiles.status,
        profiles.last_seen_at,
        profiles.created_at,
        profiles.updated_at
      FROM categorization_profiles profiles
      LEFT JOIN categories
        ON categories.user_id = profiles.user_id
       AND categories.id = profiles.category_id
      WHERE profiles.user_id = ?
        AND profiles.counterparty_key = ?
        AND profiles.category_id = ?
        AND IFNULL(profiles.account_id, '') = IFNULL(?, '')
        AND profiles.currency = ?
        AND profiles.direction = ?
      LIMIT 1
    `,
    [userId, input.counterpartyKey, input.categoryId, input.accountId ?? null, input.currency, input.direction],
  );
}

export async function syncAmountProfileFromCategorizedDescription(
  db: D1DatabaseLike,
  userId: string,
  input: {
    descBanco: string;
    amount: number;
    categoryId: number;
    accountId?: string | null;
    currency: "UYU" | "USD" | "EUR" | "ARS";
    direction: "expense" | "income";
  },
) {
  const counterpartyKey = deriveCounterpartyKey(input.descBanco);
  if (!counterpartyKey || !input.categoryId) {
    return { status: "skipped" as const };
  }

  const rows = await allRows<{ desc_banco: string; monto: number }>(
    db,
    `
      SELECT desc_banco, monto
      FROM transactions
      WHERE user_id = ?
        AND category_id = ?
        AND movement_kind = 'normal'
        AND categorization_status = 'categorized'
        AND moneda = ?
        AND (? IS NULL OR account_id = ?)
        AND ((? = 'expense' AND monto < 0) OR (? = 'income' AND monto > 0))
      ORDER BY fecha DESC, id DESC
      LIMIT 500
    `,
    [
      userId,
      input.categoryId,
      input.currency,
      input.accountId ?? null,
      input.accountId ?? null,
      input.direction,
      input.direction,
    ],
  );

  const amounts = rows
    .filter((row) => deriveCounterpartyKey(row.desc_banco) === counterpartyKey)
    .map((row) => Number(row.monto));

  const amountSet = new Set(amounts.map((amount) => Math.abs(Number(amount)).toFixed(2)));
  const inputAmountKey = Math.abs(Number(input.amount)).toFixed(2);
  if (!amountSet.has(inputAmountKey)) {
    amounts.push(input.amount);
  }

  const profile = await upsertAmountProfile(db, userId, {
    counterpartyKey,
    categoryId: input.categoryId,
    accountId: input.accountId ?? null,
    currency: input.currency,
    direction: input.direction,
    amounts,
  });

  return { status: profile ? "updated" as const : "skipped" as const, profile };
}

async function isAmountProfileRejectedForTransaction(
  db: D1DatabaseLike,
  userId: string,
  profileId: number,
  descBanco: string,
  amount: number,
  currency: string,
) {
  const normalizedDescription = normalizeRulePattern(descBanco);
  if (!normalizedDescription) return false;
  const row = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM categorization_profile_rejections
      WHERE user_id = ?
        AND profile_id = ?
        AND desc_banco_normalized = ?
        AND amount_bucket = ?
      LIMIT 1
    `,
    [userId, profileId, normalizedDescription, buildAmountBucket(amount, currency)],
  );
  return Boolean(row);
}

export async function rejectAmountProfileForTransaction(
  db: D1DatabaseLike,
  userId: string,
  input: { descBanco: string; amount: number; currency: string; accountId?: string | null; direction: "expense" | "income" },
) {
  const suggestion = await findAmountProfileCategoryMatch(db, userId, input);
  if (!suggestion?.profile) return;
  const normalizedDescription = normalizeRulePattern(input.descBanco);
  if (!normalizedDescription) return;

  await runStatement(
    db,
    `
      INSERT INTO categorization_profile_rejections (user_id, profile_id, desc_banco_normalized, amount_bucket)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, profile_id, desc_banco_normalized, amount_bucket) DO NOTHING
    `,
    [userId, suggestion.profile.id, normalizedDescription, buildAmountBucket(input.amount, input.currency)],
  );
}

export async function findAmountProfileCategoryMatch(
  db: D1DatabaseLike,
  userId: string,
  input: { descBanco: string; amount: number; currency: string; accountId?: string | null; entryType?: "expense" | "income"; direction?: "expense" | "income" },
) {
  const settings = await getAmountProfileSettings(db, userId);
  if (!settings.enabled) return null;

  const counterpartyKey = deriveCounterpartyKey(input.descBanco);
  const direction = input.direction || input.entryType || (Number(input.amount) >= 0 ? "income" : "expense");
  if (!counterpartyKey) return null;

  const profiles = await allRows<AmountProfileRow>(
    db,
    `
      SELECT
        profiles.id,
        profiles.counterparty_key,
        profiles.normalized_pattern,
        profiles.category_id,
        categories.name AS category_name,
        profiles.account_id,
        profiles.currency,
        profiles.direction,
        profiles.amount_median,
        profiles.amount_min,
        profiles.amount_max,
        profiles.amount_p25,
        profiles.amount_p75,
        profiles.sample_count,
        profiles.confidence,
        profiles.status,
        profiles.last_seen_at,
        profiles.created_at,
        profiles.updated_at
      FROM categorization_profiles profiles
      LEFT JOIN categories
        ON categories.user_id = profiles.user_id
       AND categories.id = profiles.category_id
      WHERE profiles.user_id = ?
        AND profiles.counterparty_key = ?
        AND profiles.currency = ?
        AND profiles.direction = ?
        AND profiles.status = 'active'
        AND profiles.sample_count >= 2
        AND (profiles.account_id IS NULL OR profiles.account_id = ?)
    `,
    [userId, counterpartyKey, input.currency, direction, input.accountId ?? null],
  );

  const scored = [];
  for (const profile of profiles) {
    if (await isAmountProfileRejectedForTransaction(db, userId, profile.id, input.descBanco, input.amount, input.currency)) {
      continue;
    }
    const similarity = calculateAmountSimilarity(input.amount, profile.amount_median, input.currency);
    if (similarity < 0.52) continue;

    let confidence = 0.42;
    confidence += similarity * 0.34;
    confidence += Math.min(0.1, Number(profile.sample_count || 0) * 0.025);
    confidence += Number(profile.confidence || 0.74) * 0.1;
    if (profile.account_id && profile.account_id === (input.accountId ?? null)) confidence += 0.04;
    confidence = Number(Math.min(0.98, confidence).toFixed(3));

    scored.push({
      profile,
      similarity,
      confidence,
      reason: amountProfileReason(profile, similarity),
    });
  }

  scored.sort((left, right) => right.confidence - left.confidence || right.similarity - left.similarity);
  const best = scored[0];
  if (!best) return null;

  const conflicts = scored
    .filter((candidate) => candidate.profile.category_id !== best.profile.category_id)
    .filter((candidate) => best.confidence - candidate.confidence <= 0.08)
    .slice(0, 3)
    .map((candidate) => ({
      profile_id: candidate.profile.id,
      category_id: candidate.profile.category_id,
      category_name: candidate.profile.category_name,
      amount_median: candidate.profile.amount_median,
      sample_count: candidate.profile.sample_count,
      confidence: candidate.confidence,
      amount_similarity: candidate.similarity,
    }));

  return {
    categoryId: best.profile.category_id,
    confidence: best.confidence,
    source: "amount_profile",
    profile: best.profile,
    similarity: best.similarity,
    reason: best.reason,
    conflictCandidates: conflicts,
    hasConflict: conflicts.length > 0,
  };
}

export async function rebuildAmountProfiles(db: D1DatabaseLike, userId: string) {
  await runStatement(db, "DELETE FROM categorization_profiles WHERE user_id = ?", [userId]);
  await runStatement(db, "DELETE FROM categorization_profile_rejections WHERE user_id = ?", [userId]);

  const rows = await allRows<{
    desc_banco: string;
    monto: number;
    moneda: "UYU" | "USD" | "EUR" | "ARS";
    category_id: number;
    account_id: string | null;
    entry_type: string;
  }>(
    db,
    `
      SELECT desc_banco, monto, moneda, category_id, account_id, entry_type
      FROM transactions
      WHERE user_id = ?
        AND category_id IS NOT NULL
        AND movement_kind = 'normal'
        AND categorization_status = 'categorized'
      ORDER BY fecha ASC, id ASC
    `,
    [userId],
  );

  for (const row of rows) {
    await syncAmountProfileFromCategorizedDescription(db, userId, {
      descBanco: row.desc_banco,
      amount: Number(row.monto),
      categoryId: Number(row.category_id),
      accountId: row.account_id,
      currency: row.moneda,
      direction: row.entry_type === "income" || Number(row.monto) > 0 ? "income" : "expense",
    });
  }

  const profiles = await listAmountProfiles(db, userId);
  return {
    rebuilt_count: profiles.length,
    profiles,
  };
}

async function findCategoryBySlugOrName(db: D1DatabaseLike, userId: string, slugsOrNames: string[]) {
  const categories = await listCategoriesForMatching(db, userId);
  const wanted = slugsOrNames.map(normalizeMatcher);
  return categories.find((category) =>
    wanted.includes(normalizeMatcher(category.slug || ""))
    || wanted.includes(normalizeMatcher(category.name)),
  ) || null;
}

function descriptionIncludesAny(descBanco: string, keywords: string[]) {
  const normalized = ` ${normalizeMatcher(descBanco)} `;
  return keywords.some((keyword) => normalized.includes(` ${normalizeMatcher(keyword)} `) || normalized.includes(normalizeMatcher(keyword)));
}

function hasCommercePurchaseContext(descBanco: string) {
  if (descriptionIncludesAny(descBanco, CARD_PURCHASE_HINTS)) return true;
  const keywordSlugs = ["supermercado", "transporte", "suscripciones", "restaurantes", "delivery", "servicios", "salud"];
  const normalizedDescription = ` ${normalizeMatcher(descBanco)} `;
  return keywordSlugs.some((slug) =>
    (CATEGORY_KEYWORD_ALIASES[slug] || []).some((alias) => normalizedDescription.includes(` ${normalizeMatcher(alias)} `)),
  );
}

async function findLegacyHeuristicCategoryMatch(
  db: D1DatabaseLike,
  userId: string,
  input: { descBanco: string; amount: number; currency: string; entryType: "expense" | "income" },
) {
  const descBanco = input.descBanco;

  if (input.amount > 0 && descriptionIncludesAny(descBanco, SUPERNET_INCOME_HINTS)) {
    const category = await findCategoryBySlugOrName(db, userId, ["ingreso"]);
    if (category) return { categoryId: Number(category.id), confidence: 0.95, source: "supernet_income" };
  }

  if (input.amount > 0 && descriptionIncludesAny(descBanco, REINTEGRO_KEYWORDS)) {
    const category = await findCategoryBySlugOrName(db, userId, ["reintegro", "ingreso"]);
    if (category) return { categoryId: Number(category.id), confidence: 0.9, source: "refund" };
  }

  if (!hasCommercePurchaseContext(descBanco) && descriptionIncludesAny(descBanco, [...TRANSFER_KEYWORDS, ...PERSON_TRANSFER_HINTS])) {
    const category = await findCategoryBySlugOrName(db, userId, ["transferencia"]);
    if (category) return { categoryId: Number(category.id), confidence: 0.88, source: "transfer" };
  }

  if (descriptionIncludesAny(descBanco, EDUCATION_HINTS)) {
    const category = await findCategoryBySlugOrName(db, userId, ["educacion"]);
    if (category) return { categoryId: Number(category.id), confidence: 0.84, source: "education" };
  }

  return null;
}

async function suggestCategoryWithOllama(
  db: D1DatabaseLike,
  userId: string,
  descBanco: string,
  amount: number,
  currency: string,
) {
  const settings = await getSettingsObject(db, userId);
  if (String(settings.categorizer_ollama_enabled || "0") !== "1") {
    return null;
  }

  const baseUrl = String(settings.categorizer_ollama_url || "").trim();
  if (!baseUrl) return null;

  const model = String(settings.categorizer_ollama_model || "qwen2.5:3b").trim();
  const categories = await listCategoriesForMatching(db, userId);
  if (categories.length === 0) return null;

  const categoryList = categories.map((category) => category.name).join(", ");
  const prompt = [
    "Elegi la categoria mas probable para un movimiento bancario.",
    `Descripcion: ${descBanco}`,
    `Monto: ${amount}`,
    `Moneda: ${currency}`,
    `Categorias disponibles: ${categoryList}`,
    'Respondeme solo JSON con {"category_name":"...","confidence":0.0}',
  ].join("\n");

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { response?: string };
    const parsed = JSON.parse(String(payload.response || "{}")) as { category_name?: string; confidence?: number };
    const matchedCategory = categories.find((category) => normalizeMatcher(category.name) === normalizeMatcher(parsed.category_name || ""));
    if (!matchedCategory) return null;
    return {
      categoryId: Number(matchedCategory.id),
      confidence: Math.max(0.55, Math.min(Number(parsed.confidence || 0.7), 0.92)),
      source: "ollama",
    };
  } catch {
    return null;
  }
}

export async function listRules(db: D1DatabaseLike, userId: string) {
  return allRows<RuleRow>(
    db,
    `
      SELECT
        rules.id,
        rules.pattern,
        rules.normalized_pattern,
        rules.category_id,
        categories.name AS category_name,
        rules.match_count,
        rules.mode,
        rules.confidence,
        rules.source,
        rules.account_id,
        rules.merchant_scope,
        rules.account_scope,
        rules.currency,
        rules.currency_scope,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at,
        rules.updated_at
      FROM rules
      LEFT JOIN categories
        ON categories.user_id = rules.user_id
       AND categories.id = rules.category_id
      WHERE rules.user_id = ?
      ORDER BY rules.merchant_key IS NULL ASC, rules.confidence DESC, rules.match_count DESC, rules.last_matched_at DESC, rules.id ASC
    `,
    [userId],
  );
}

export async function buildRuleInsights(db: D1DatabaseLike, userId: string) {
  const rules = await listRules(db, userId);
  const insights: RuleInsightRow[] = [];

  const exactGroups = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const key = `${rule.normalized_pattern}::${rule.category_id ?? "none"}::${buildScopeKey(rule)}`;
    const list = exactGroups.get(key) || [];
    list.push(rule);
    exactGroups.set(key, list);
  }

  exactGroups.forEach((group) => {
    if (group.length < 2) return;
    const sorted = [...group].sort((left, right) => Number(right.match_count || 0) - Number(left.match_count || 0));
    insights.push({
      kind: "duplicate_scope",
      title: `Hay ${group.length} reglas duplicadas para "${sorted[0].pattern}"`,
      description: "Tenes varias reglas con el mismo patron, categoria y scope. Conviene dejar una sola para evitar drift y mantenimiento innecesario.",
      rule_ids: sorted.map((item) => Number(item.id)),
      recommended_action: "merge",
      priority: group.length >= 3 ? "high" : "medium",
    });
  });

  const scopedRules = new Map<string, RuleRow[]>();
  for (const rule of rules) {
    const key = `${rule.category_id ?? "none"}::${buildScopeKey(rule)}`;
    const list = scopedRules.get(key) || [];
    list.push(rule);
    scopedRules.set(key, list);
  }

  scopedRules.forEach((group) => {
    const sorted = [...group].sort((left, right) => right.normalized_pattern.length - left.normalized_pattern.length);
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      for (let compareIndex = index + 1; compareIndex < sorted.length; compareIndex += 1) {
        const candidate = sorted[compareIndex];
        if (!current.normalized_pattern || !candidate.normalized_pattern) continue;
        if (!current.normalized_pattern.includes(candidate.normalized_pattern)) continue;
        if (candidate.normalized_pattern.length < 4) continue;
        if (Number(candidate.match_count || 0) > Number(current.match_count || 0)) continue;

        insights.push({
          kind: "overlap",
          title: `La regla "${candidate.pattern}" puede quedar absorbida por "${current.pattern}"`,
          description: "Hay una regla mas corta que pisa el mismo caso que otra mas especifica. Conviene revisarlas juntas para evitar categorizaciones ambiguas.",
          rule_ids: [Number(current.id), Number(candidate.id)],
          recommended_action: "review",
          priority: candidate.mode === "auto" ? "high" : "medium",
        });
        break;
      }
    }
  });

  rules.forEach((rule) => {
    if (rule.mode !== "auto") return;
    if (Number(rule.confidence || 0) >= 0.84 && Number(rule.match_count || 0) >= 3) return;
    insights.push({
      kind: "weak_auto",
      title: `La regla auto "${rule.pattern}" todavia es fragil`,
      description: "Esta regla esta automatizando con poca evidencia. Bajarla a suggest puede evitar falsos positivos mientras aprende mejor.",
      rule_ids: [Number(rule.id)],
      recommended_action: "lower_to_suggest",
      priority: Number(rule.match_count || 0) <= 1 ? "high" : "medium",
    });
  });

  return insights
    .slice(0, 12)
    .sort((left, right) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[left.priority] - order[right.priority];
    });
}

export async function getRuleById(db: D1DatabaseLike, userId: string, ruleId: number) {
  return firstRow<RuleRow>(
    db,
    `
      SELECT
        rules.id,
        rules.pattern,
        rules.normalized_pattern,
        rules.category_id,
        categories.name AS category_name,
        rules.match_count,
        rules.mode,
        rules.confidence,
        rules.source,
        rules.account_id,
        rules.merchant_scope,
        rules.account_scope,
        rules.currency,
        rules.currency_scope,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at,
        rules.updated_at
      FROM rules
      LEFT JOIN categories
        ON categories.user_id = rules.user_id
       AND categories.id = rules.category_id
      WHERE rules.user_id = ? AND rules.id = ?
      LIMIT 1
    `,
    [userId, ruleId],
  );
}

export async function getRuleByNormalizedScope(
  db: D1DatabaseLike,
  userId: string,
  normalizedPattern: string,
  scope: RuleScope = {},
) {
  const normalizedScope = normalizeRuleScope(scope);
  return firstRow<RuleRow>(
    db,
    `
      SELECT
        rules.id,
        rules.pattern,
        rules.normalized_pattern,
        rules.category_id,
        categories.name AS category_name,
        rules.match_count,
        rules.mode,
        rules.confidence,
        rules.source,
        rules.account_id,
        rules.merchant_scope,
        rules.account_scope,
        rules.currency,
        rules.currency_scope,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at,
        rules.updated_at
      FROM rules
      LEFT JOIN categories
        ON categories.user_id = rules.user_id
       AND categories.id = rules.category_id
      WHERE rules.user_id = ?
        AND rules.normalized_pattern = ?
        AND IFNULL(rules.account_id, '') = IFNULL(?, '')
        AND IFNULL(rules.currency, '') = IFNULL(?, '')
        AND rules.direction = ?
      LIMIT 1
    `,
    [userId, normalizedPattern, normalizedScope.account_id, normalizedScope.currency, normalizedScope.direction],
  );
}

export async function createRule(db: D1DatabaseLike, userId: string, input: CreateRuleInput) {
  const normalizedPattern = normalizeRulePattern(input.pattern);
  const scope = normalizeRuleScope(input);
  const identity = deriveRuleIdentity(input.pattern, {
    accountId: scope.account_id,
    currency: scope.currency,
    direction: scope.direction,
  });
  const merchantKey = identity.merchant_key || normalizedPattern;
  const merchantScope = merchantKey || normalizedPattern;
  const result = await runStatement(
    db,
    `
      INSERT INTO rules (
        user_id,
        pattern,
        normalized_pattern,
        merchant_key,
        merchant_scope,
        category_id,
        match_count,
        mode,
        confidence,
        source,
        account_id,
        account_scope,
        currency,
        currency_scope,
        direction,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, merchant_scope, account_scope, currency_scope, direction)
      DO UPDATE SET
        pattern = excluded.pattern,
        normalized_pattern = excluded.normalized_pattern,
        merchant_key = excluded.merchant_key,
        category_id = excluded.category_id,
        mode = excluded.mode,
        confidence = MAX(rules.confidence, excluded.confidence),
        source = excluded.source,
        match_count = rules.match_count + 1,
        last_matched_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      input.pattern.trim(),
      normalizedPattern,
      merchantKey,
      merchantScope,
      input.category_id,
      input.mode,
      input.confidence,
      input.source,
      scope.account_id,
      scope.account_id ?? "",
      scope.currency,
      scope.currency ?? "",
      scope.direction,
    ],
  );

  void result;
  const existingRule = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM rules
      WHERE user_id = ?
        AND merchant_scope = ?
        AND account_scope = ?
        AND currency_scope = ?
        AND direction = ?
      LIMIT 1
    `,
    [userId, merchantScope, scope.account_id ?? "", scope.currency ?? "", scope.direction],
  );
  return existingRule ? getRuleById(db, userId, existingRule.id) : null;
}

export async function updateRule(db: D1DatabaseLike, userId: string, ruleId: number, input: UpdateRuleInput) {
  const current = await getRuleById(db, userId, ruleId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE rules
      SET category_id = ?, mode = ?, confidence = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `,
    [
      input.category_id ?? current.category_id,
      input.mode ?? current.mode,
      input.confidence ?? current.confidence,
      userId,
      ruleId,
    ],
  );

  return getRuleById(db, userId, ruleId);
}

export async function deleteRule(db: D1DatabaseLike, userId: string, ruleId: number) {
  await runStatement(
    db,
    "DELETE FROM rule_rejections WHERE user_id = ? AND rule_id = ?",
    [userId, ruleId],
  );
  await runStatement(
    db,
    "DELETE FROM rules WHERE user_id = ? AND id = ?",
    [userId, ruleId],
  );
}

export async function logRuleMatch(
  db: D1DatabaseLike,
  userId: string,
  input: {
    transactionId: number;
    ruleId?: number | null;
    categoryId?: number | null;
    layer: string;
    confidence?: number | null;
    reason?: string | null;
  },
) {
  await runStatement(
    db,
    `
      INSERT INTO rule_match_log (user_id, transaction_id, rule_id, category_id, layer, confidence, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      input.transactionId,
      input.ruleId ?? null,
      input.categoryId ?? null,
      input.layer,
      input.confidence ?? null,
      input.reason ?? null,
    ],
  );
}

export async function listRuleMatchLog(db: D1DatabaseLike, userId: string, transactionId: number) {
  return allRows(
    db,
    `
      SELECT
        log.id,
        log.transaction_id,
        log.rule_id,
        log.category_id,
        log.layer,
        log.confidence,
        log.reason,
        log.created_at,
        rules.pattern AS rule_pattern,
        categories.name AS category_name
      FROM rule_match_log log
      LEFT JOIN rules
        ON rules.user_id = log.user_id
       AND rules.id = log.rule_id
      LEFT JOIN categories
        ON categories.user_id = log.user_id
       AND categories.id = log.category_id
      WHERE log.user_id = ? AND log.transaction_id = ?
      ORDER BY log.created_at DESC, log.id DESC
    `,
    [userId, transactionId],
  );
}

export async function incrementRuleMatchCount(db: D1DatabaseLike, userId: string, ruleId: number) {
  const current = await getRuleById(db, userId, ruleId);
  if (!current) return;

  const nextMatchCount = Number(current.match_count || 0) + 1;
  const nextConfidence = current.source === "learned" || current.source === "manual"
    ? Math.max(current.confidence, calculateLearnedRuleConfidence(nextMatchCount, current.confidence))
    : current.confidence;

  await runStatement(
    db,
    `
      UPDATE rules
      SET match_count = ?,
          confidence = ?,
          last_matched_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `,
    [nextMatchCount, nextConfidence, userId, ruleId],
  );
}

export async function listRuleCandidates(db: D1DatabaseLike, userId: string, ruleId: number) {
  const rule = await getRuleById(db, userId, ruleId);
  if (!rule) return [];

  return allRows(
    db,
    `
      SELECT id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type, movement_kind,
             categorization_status, category_source, category_confidence, category_rule_id, created_at
      FROM transactions
      WHERE user_id = ?
        AND categorization_status != 'categorized'
        AND LOWER(desc_banco) LIKE '%' || ? || '%'
      ORDER BY fecha DESC, id DESC
      LIMIT 50
    `,
    [userId, rule.normalized_pattern],
  );
}

export async function rejectRuleForDescription(db: D1DatabaseLike, userId: string, ruleId: number, descBanco: string) {
  const normalizedDescription = normalizeRulePattern(descBanco);
  if (!normalizedDescription) return;

  await runStatement(
    db,
    `
      INSERT INTO rule_rejections (user_id, rule_id, desc_banco_normalized)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, rule_id, desc_banco_normalized) DO NOTHING
    `,
    [userId, ruleId, normalizedDescription],
  );
}

async function isRuleRejectedForDescription(db: D1DatabaseLike, userId: string, ruleId: number, descBanco: string) {
  const normalizedDescription = normalizeRulePattern(descBanco);
  if (!normalizedDescription) return false;

  const row = await firstRow<{ id: number }>(
    db,
    `
      SELECT id
      FROM rule_rejections
      WHERE user_id = ? AND rule_id = ? AND desc_banco_normalized = ?
      LIMIT 1
    `,
    [userId, ruleId, normalizedDescription],
  );

  return Boolean(row);
}

export async function findMatchingRule(
  db: D1DatabaseLike,
  userId: string,
  input: { descBanco: string; accountId?: string | null; currency?: string | null; direction?: "expense" | "income" },
) {
  const rules = await listRules(db, userId);
  const eligibleRules: RuleRow[] = [];

  for (const rule of rules) {
    if (await isRuleRejectedForDescription(db, userId, rule.id, input.descBanco)) {
      continue;
    }
    eligibleRules.push(rule);
  }

  return selectBestRuleMatch(eligibleRules, {
    description: input.descBanco,
    accountId: input.accountId ?? null,
    currency: input.currency ?? null,
    direction: input.direction ?? "expense",
  });
}

export async function classifyTransactionByRules(
  db: D1DatabaseLike,
  userId: string,
  input: {
    descBanco: string;
    amount: number;
    currency: "UYU" | "USD" | "EUR" | "ARS";
    accountId?: string | null;
    entryType: "expense" | "income";
    categoryId?: number | null;
  },
): Promise<CategorizationDecision> {
  if (input.categoryId !== undefined && input.categoryId !== null) {
    return {
      categoryId: input.categoryId,
      categorizationStatus: "categorized",
      categorySource: "manual",
      categoryConfidence: null,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: null,
      amountProfile: null,
      amountSimilarity: null,
      conflictCandidates: [],
    };
  }

  const settings = await getSettingsObject(db, userId);
  if (String(settings.categorizer_v2_enabled ?? "1") !== "0") {
    const canonical = classifyTransactionWithCanonicalRules(
      {
        desc_banco: input.descBanco,
        monto: input.amount,
        moneda: input.currency,
        account_id: input.accountId ?? null,
      },
      await listRules(db, userId),
      [],
      settings,
    );

    if (canonical.categorizationStatus !== "uncategorized") {
      return {
        categoryId: canonical.categoryId,
        categorizationStatus: canonical.categorizationStatus === "categorized" ? "categorized" : "suggested",
        categorySource: canonical.categorySource,
        categoryConfidence: canonical.categoryConfidence,
        categoryRuleId: canonical.categoryRuleId,
        matchedRule: canonical.matchedRule as RuleRow | null,
        amountProfileId: null,
        amountProfile: null,
        amountSimilarity: null,
        conflictCandidates: [],
      };
    }
  }

  const matchedRule = await findMatchingRule(db, userId, {
    descBanco: input.descBanco,
    accountId: input.accountId ?? null,
    currency: input.currency,
    direction: input.entryType,
  });

  const thresholds = await getRuleThresholds(db, userId);
  if (matchedRule && matchedRule.category_id !== null) {
    const confidence = Number(matchedRule.confidence || 0.72);

    if (matchedRule.mode === "auto" || confidence >= thresholds.autoThreshold) {
      return {
        categoryId: matchedRule.category_id,
        categorizationStatus: "categorized",
        categorySource: "rule_auto",
        categoryConfidence: confidence,
        categoryRuleId: matchedRule.id,
        matchedRule,
        amountProfileId: null,
        amountProfile: null,
        amountSimilarity: null,
        conflictCandidates: [],
      };
    }

    if (confidence >= thresholds.suggestThreshold) {
      return {
        categoryId: matchedRule.category_id,
        categorizationStatus: "suggested",
        categorySource: "rule_suggest",
        categoryConfidence: confidence,
        categoryRuleId: matchedRule.id,
        matchedRule,
        amountProfileId: null,
        amountProfile: null,
        amountSimilarity: null,
        conflictCandidates: [],
      };
    }
  }

  const amountProfileMatch = await findAmountProfileCategoryMatch(db, userId, {
    descBanco: input.descBanco,
    amount: input.amount,
    currency: input.currency,
    accountId: input.accountId ?? null,
    direction: input.entryType,
  });
  const amountProfileSettings = await getAmountProfileSettings(db, userId);
  if (amountProfileMatch && amountProfileMatch.confidence >= amountProfileSettings.suggestThreshold) {
    const canAutoCategorize = !amountProfileMatch.hasConflict
      && amountProfileMatch.profile.sample_count >= 3
      && amountProfileMatch.confidence >= amountProfileSettings.autoThreshold;
    return {
      categoryId: amountProfileMatch.categoryId,
      categorizationStatus: canAutoCategorize ? "categorized" : "suggested",
      categorySource: "amount_profile",
      categoryConfidence: amountProfileMatch.confidence,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: amountProfileMatch.profile.id,
      amountProfile: amountProfileMatch.profile,
      amountSimilarity: amountProfileMatch.similarity,
      conflictCandidates: amountProfileMatch.conflictCandidates,
    };
  }

  const legacyHeuristicMatch = await findLegacyHeuristicCategoryMatch(db, userId, {
    descBanco: input.descBanco,
    amount: input.amount,
    currency: input.currency,
    entryType: input.entryType,
  });
  if (legacyHeuristicMatch && legacyHeuristicMatch.confidence >= thresholds.suggestThreshold) {
    return {
      categoryId: legacyHeuristicMatch.categoryId,
      categorizationStatus: legacyHeuristicMatch.confidence >= thresholds.autoThreshold ? "categorized" : "suggested",
      categorySource: legacyHeuristicMatch.source,
      categoryConfidence: legacyHeuristicMatch.confidence,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: null,
      amountProfile: null,
      amountSimilarity: null,
      conflictCandidates: [],
    };
  }

  const historyMatch = await findHistoryCategoryMatch(db, userId, {
    descBanco: input.descBanco,
    accountId: input.accountId ?? null,
    currency: input.currency ?? null,
    entryType: input.entryType,
  });
  if (historyMatch && historyMatch.confidence >= thresholds.suggestThreshold) {
    return {
      categoryId: historyMatch.categoryId,
      categorizationStatus: "suggested",
      categorySource: historyMatch.source,
      categoryConfidence: historyMatch.confidence,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: null,
      amountProfile: null,
      amountSimilarity: null,
      conflictCandidates: [],
    };
  }

  const keywordMatch = await findKeywordCategoryMatch(db, userId, input.descBanco);
  if (keywordMatch && keywordMatch.confidence >= thresholds.suggestThreshold) {
    return {
      categoryId: keywordMatch.categoryId,
      categorizationStatus: keywordMatch.confidence >= thresholds.autoThreshold ? "categorized" : "suggested",
      categorySource: keywordMatch.source,
      categoryConfidence: keywordMatch.confidence,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: null,
      amountProfile: null,
      amountSimilarity: null,
      conflictCandidates: [],
    };
  }

  const ollamaMatch = await suggestCategoryWithOllama(db, userId, input.descBanco, input.amount, input.currency);
  if (ollamaMatch && ollamaMatch.confidence >= 0.55) {
    return {
      categoryId: ollamaMatch.categoryId,
      categorizationStatus: "suggested",
      categorySource: ollamaMatch.source,
      categoryConfidence: ollamaMatch.confidence,
      categoryRuleId: null,
      matchedRule: null,
      amountProfileId: null,
      amountProfile: null,
      amountSimilarity: null,
      conflictCandidates: [],
    };
  }

  return {
    categoryId: null,
    categorizationStatus: "uncategorized",
    categorySource: null,
    categoryConfidence: null,
    categoryRuleId: null,
    matchedRule: null,
    amountProfileId: null,
    amountProfile: null,
    amountSimilarity: null,
    conflictCandidates: [],
  };
}

export async function syncRuleFromCategorizedDescription(
  db: D1DatabaseLike,
  userId: string,
  input: {
    descBanco: string;
    categoryId: number;
    accountId?: string | null;
    currency?: "UYU" | "USD" | "EUR" | "ARS" | null;
    direction?: "expense" | "income";
    scopePreference?: "account" | "global" | null;
  },
) {
  const upsert = buildManualRuleUpsert({
    desc_banco: input.descBanco,
    monto: input.direction === "income" ? 1 : -1,
    moneda: input.currency,
    account_id: input.accountId ?? null,
  }, input.categoryId, input.scopePreference || (input.accountId ? "account" : "global"));

  if (upsert.skipped) {
    return { status: "skipped" as const, skipped_reason: upsert.skippedReason };
  }

  const before = await firstRow<{ id: number; category_id: number | null }>(
    db,
    `
      SELECT id, category_id
      FROM rules
      WHERE user_id = ?
        AND merchant_scope = ?
        AND account_scope = ?
        AND currency_scope = ?
        AND direction = ?
      LIMIT 1
    `,
    [userId, upsert.merchant_scope, upsert.account_scope, upsert.currency_scope, upsert.direction],
  );

  await runStatement(
    db,
    `
      INSERT INTO rules (
        user_id, pattern, normalized_pattern, merchant_key, merchant_scope,
        account_id, account_scope, currency, currency_scope, direction,
        category_id, match_count, mode, confidence, source, last_matched_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'auto', ?, 'learned', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, merchant_scope, account_scope, currency_scope, direction)
      DO UPDATE SET
        pattern = excluded.pattern,
        normalized_pattern = excluded.normalized_pattern,
        merchant_key = excluded.merchant_key,
        category_id = excluded.category_id,
        source = 'learned',
        mode = CASE WHEN rules.mode = 'disabled' THEN 'suggest' ELSE rules.mode END,
        confidence = MAX(rules.confidence, excluded.confidence),
        match_count = rules.match_count + 1,
        last_matched_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      userId,
      upsert.pattern,
      upsert.normalized_pattern,
      upsert.merchant_key,
      upsert.merchant_scope,
      upsert.account_id,
      upsert.account_scope,
      upsert.currency,
      upsert.currency_scope,
      upsert.direction,
      input.categoryId,
      upsert.confidence,
    ],
  );

  const rule = await firstRow<RuleRow>(
    db,
    `
      SELECT
        rules.id,
        rules.pattern,
        rules.normalized_pattern,
        rules.category_id,
        categories.name AS category_name,
        rules.match_count,
        rules.mode,
        rules.confidence,
        rules.source,
        rules.account_id,
        rules.merchant_scope,
        rules.account_scope,
        rules.currency,
        rules.currency_scope,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at,
        rules.updated_at
      FROM rules
      LEFT JOIN categories
        ON categories.user_id = rules.user_id
       AND categories.id = rules.category_id
      WHERE rules.user_id = ?
        AND rules.merchant_scope = ?
        AND rules.account_scope = ?
        AND rules.currency_scope = ?
        AND rules.direction = ?
      LIMIT 1
    `,
    [userId, upsert.merchant_scope, upsert.account_scope, upsert.currency_scope, upsert.direction],
  );

  return {
    status: before ? (before.category_id === input.categoryId ? "updated" as const : "overrode_conflict" as const) : "created" as const,
    rule: rule ?? null,
  };
}

export async function applyRuleRetroactively(db: D1DatabaseLike, userId: string, ruleId: number): Promise<RuleApplicationSummary> {
  const rule = await getRuleById(db, userId, ruleId);
  if (!rule || rule.category_id === null || rule.mode === "disabled") {
    return {
      affected_transactions: 0,
      categorized_transactions: 0,
      suggested_transactions: 0,
    };
  }

  const candidates = await listRuleCandidates(db, userId, ruleId);
  let affectedTransactions = 0;
  let categorizedTransactions = 0;
  let suggestedTransactions = 0;

  for (const candidate of candidates) {
    const classification = await classifyTransactionByRules(db, userId, {
      descBanco: String(candidate.desc_banco),
      amount: Number(candidate.monto),
      currency: String(candidate.moneda) as "UYU" | "USD" | "EUR" | "ARS",
      accountId: candidate.account_id == null ? null : String(candidate.account_id),
      entryType: Number(candidate.monto) >= 0 ? "income" : "expense",
      categoryId: null,
    });

    if (classification.categoryRuleId !== ruleId) {
      continue;
    }

    await runStatement(
      db,
      `
        UPDATE transactions
        SET category_id = ?,
            categorization_status = ?,
            category_source = ?,
            category_confidence = ?,
            category_rule_id = ?
        WHERE user_id = ? AND id = ?
      `,
      [
        classification.categoryId,
        classification.categorizationStatus,
        classification.categorySource,
        classification.categoryConfidence,
        classification.categoryRuleId,
        userId,
        Number(candidate.id),
      ],
    );

    affectedTransactions += 1;
    if (classification.categorizationStatus === "categorized") categorizedTransactions += 1;
    if (classification.categorizationStatus === "suggested") suggestedTransactions += 1;
  }

  return {
    affected_transactions: affectedTransactions,
    categorized_transactions: categorizedTransactions,
    suggested_transactions: suggestedTransactions,
  };
}

export async function applyRuleRetroactivelyJob(db: D1DatabaseLike, userId: string, ruleId: number) {
  const jobId = `rule_${ruleId}_${Date.now()}`;
  const summary = await applyRuleRetroactively(db, userId, ruleId);
  await runStatement(
    db,
    `
      INSERT INTO categorization_jobs (id, user_id, type, status, total, processed, result_json, updated_at)
      VALUES (?, ?, 'apply_rule_retroactively', 'completed', ?, ?, ?, CURRENT_TIMESTAMP)
    `,
    [
      jobId,
      userId,
      summary.affected_transactions,
      summary.affected_transactions,
      JSON.stringify(summary),
    ],
  );
  return { job_id: jobId, status: "completed" as const, ...summary };
}

export async function getCategorizationJob(db: D1DatabaseLike, userId: string, jobId: string) {
  return firstRow(
    db,
    "SELECT id, type, status, total, processed, result_json, created_at, updated_at FROM categorization_jobs WHERE user_id = ? AND id = ? LIMIT 1",
    [userId, jobId],
  );
}
