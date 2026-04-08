import type { CreateRuleInput, UpdateRuleInput } from "@smartfinance/contracts";
import {
  calculateLearnedRuleConfidence,
  deriveRulePattern,
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
  currency: string | null;
  direction: "any" | "expense" | "income";
  merchant_key: string | null;
  last_matched_at: string | null;
  created_at: string;
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
};

type RuleApplicationSummary = {
  affected_transactions: number;
  categorized_transactions: number;
  suggested_transactions: number;
};

function normalizeRuleScope(scope: RuleScope = {}) {
  return {
    account_id: scope.account_id ?? null,
    currency: scope.currency ?? null,
    direction: scope.direction ?? "any",
  };
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
        rules.currency,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at
      FROM rules
      LEFT JOIN categories
        ON categories.user_id = rules.user_id
       AND categories.id = rules.category_id
      WHERE rules.user_id = ?
      ORDER BY LENGTH(rules.normalized_pattern) DESC, rules.confidence DESC, rules.match_count DESC, rules.id ASC
    `,
    [userId],
  );
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
        rules.currency,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at
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
        rules.currency,
        rules.direction,
        rules.merchant_key,
        rules.last_matched_at,
        rules.created_at
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
  const result = await runStatement(
    db,
    `
      INSERT INTO rules (
        user_id,
        pattern,
        normalized_pattern,
        category_id,
        match_count,
        mode,
        confidence,
        source,
        account_id,
        currency,
        direction,
        merchant_key
      )
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      input.pattern.trim(),
      normalizedPattern,
      input.category_id,
      input.mode,
      input.confidence,
      input.source,
      scope.account_id,
      scope.currency,
      scope.direction,
      normalizedPattern,
    ],
  );

  return getRuleById(db, userId, Number(result.meta?.last_row_id || 0));
}

export async function updateRule(db: D1DatabaseLike, userId: string, ruleId: number, input: UpdateRuleInput) {
  const current = await getRuleById(db, userId, ruleId);
  if (!current) return null;

  await runStatement(
    db,
    `
      UPDATE rules
      SET category_id = ?, mode = ?, confidence = ?
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
    };
  }

  const matchedRule = await findMatchingRule(db, userId, {
    descBanco: input.descBanco,
    accountId: input.accountId ?? null,
    currency: input.currency,
    direction: input.entryType,
  });

  if (!matchedRule || matchedRule.category_id === null) {
    return {
      categoryId: null,
      categorizationStatus: "uncategorized",
      categorySource: null,
      categoryConfidence: null,
      categoryRuleId: null,
      matchedRule: null,
    };
  }

  const thresholds = await getRuleThresholds(db, userId);
  const confidence = Number(matchedRule.confidence || 0.72);

  if (matchedRule.mode === "auto" || confidence >= thresholds.autoThreshold) {
    return {
      categoryId: matchedRule.category_id,
      categorizationStatus: "categorized",
      categorySource: "rule_auto",
      categoryConfidence: confidence,
      categoryRuleId: matchedRule.id,
      matchedRule,
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
    };
  }

  return {
    categoryId: null,
    categorizationStatus: "uncategorized",
    categorySource: null,
    categoryConfidence: null,
    categoryRuleId: null,
    matchedRule: null,
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
  },
) {
  const pattern = deriveRulePattern(input.descBanco);
  if (!pattern) {
    return { status: "skipped" as const };
  }

  const normalizedPattern = normalizeRulePattern(pattern);
  const scope = normalizeRuleScope({
    account_id: input.accountId ?? null,
    currency: input.currency ?? null,
    direction: input.direction ?? "any",
  });
  const existing = await getRuleByNormalizedScope(db, userId, normalizedPattern, scope);

  if (!existing) {
    const created = await createRule(db, userId, {
      pattern,
      category_id: input.categoryId,
      mode: "auto",
      confidence: calculateLearnedRuleConfidence(0),
      source: "learned",
      account_id: scope.account_id ?? undefined,
      currency: scope.currency ?? undefined,
      direction: scope.direction,
    });

    if (created) {
      await incrementRuleMatchCount(db, userId, created.id);
    }

    return { status: "created" as const, rule: created ?? null };
  }

  if (existing.category_id === input.categoryId) {
    const nextConfidence = Math.max(existing.confidence, calculateLearnedRuleConfidence(Number(existing.match_count || 0) + 1));
    await updateRule(db, userId, existing.id, {
      category_id: input.categoryId,
      mode: existing.mode === "disabled" ? "suggest" : existing.mode,
      confidence: nextConfidence,
    });
    await incrementRuleMatchCount(db, userId, existing.id);
    return { status: "updated" as const, rule: await getRuleById(db, userId, existing.id) };
  }

  return { status: "conflict" as const, rule: existing };
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
