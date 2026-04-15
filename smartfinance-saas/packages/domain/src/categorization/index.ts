export type CategorizationDirection = "any" | "expense" | "income";
export type CategorizationStatus = "uncategorized" | "suggested" | "categorized" | "parse_failed" | "rule_rejected" | "rejected";
export type RuleMode = "auto" | "suggest" | "disabled";

export type MerchantDictionaryEntry = {
  merchant_key: string;
  display_name?: string | null;
  aliases_json?: string | null;
  aliases?: string[];
  default_category_id?: number | null;
  origin?: "seed" | "learned" | string;
};

export type RuleCandidate = {
  id?: number;
  pattern: string;
  normalized_pattern?: string | null;
  merchant_key?: string | null;
  merchant_scope?: string | null;
  account_id?: string | null;
  currency?: string | null;
  direction?: CategorizationDirection | null;
  category_id?: number | null;
  mode?: RuleMode | null;
  source?: string | null;
  confidence?: number | null;
  match_count?: number | null;
  last_matched_at?: string | null;
};

export type TransactionForCategorization = {
  desc_banco: string;
  monto?: number | null;
  moneda?: string | null;
  account_id?: string | null;
  merchant_key?: string | null;
};

export type CategorizationSettings = {
  categorizer_auto_threshold?: string | number | null;
  categorizer_suggest_threshold?: string | number | null;
  categorizer_v2_enabled?: string | number | boolean | null;
};

export type RuleRejection = {
  rule_id: number;
  desc_banco_normalized: string;
};

export type MatchDecision = {
  categoryId: number | null;
  categorizationStatus: CategorizationStatus;
  categorySource: string | null;
  categoryConfidence: number | null;
  categoryRuleId: number | null;
  matchedRule: RuleCandidate | null;
  merchantKey: string | null;
  layer: "merchant_exact" | "pattern_substring" | "heuristic" | "fallback";
  reason: string;
};

const EDGE_NOISE_PHRASES = ["compra con tarjeta", "compra tarjeta", "compra con debito", "compra con credito", "compra internacional", "debito automatico", "debito aut", "credito por operacion", "debito operacion", "operacion en supernet", "pago con tarjeta", "pago tarjeta", "visa pos", "mastercard pos", "pos", "web", "online", "dlo"];

const GENERIC_TOKENS = new Set(["a", "al", "con", "de", "del", "el", "en", "la", "por", "para", "tarjeta", "compra", "compras", "debito", "deb", "credito", "cred", "visa", "master", "mastercard", "pago", "pagos", "cuota", "cuotas", "consumo", "local", "comercio", "pos", "web", "online", "internacional", "internac", "nacional", "uy", "uru", "cta", "caja", "ahorro", "movimiento", "compraweb", "punto", "venta", "servicio", "tc", "titular", "operacion", "supernet", "sms"]);

const STRONG_NOISE_TOKENS = new Set([...GENERIC_TOKENS, "comision", "mercado", "trip", "one", "viaje", "transferencia", "transf", "trf", "brou", "itau", "santander", "bbva", "scotia", "hsbc"]);

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeRulePattern(value: string) {
  return stripDiacritics(String(value || "")).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b\d{4,}\b/g, " ").replace(/\s+/g, " ").trim();
}

function stripEdgeNoise(normalized: string) {
  let output = ` ${normalized} `;
  const stripped: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const phrase of EDGE_NOISE_PHRASES) {
      const token = ` ${normalizeRulePattern(phrase)} `;
      if (output.startsWith(token)) {
        output = ` ${output.slice(token.length).trim()} `;
        stripped.push(phrase);
        changed = true;
      }
      if (output.endsWith(token)) {
        output = ` ${output.slice(0, -token.length).trim()} `;
        stripped.push(phrase);
        changed = true;
      }
    }
  }
  return {normalized: output.replace(/\s+/g, " ").trim(), stripped_noise: [...new Set(stripped)]};
}

export function normalizeBankDescription(input: string, _context: Record<string, unknown> = {}) {
  const normalized = normalizeRulePattern(input);
  return stripEdgeNoise(normalized);
}

function isGenericRulePattern(pattern: string) {
  const tokens = normalizeRulePattern(pattern).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => token.length < 3 || STRONG_NOISE_TOKENS.has(token));
}

function parseAliases(entry: MerchantDictionaryEntry) {
  const aliases = [...(entry.aliases || []), entry.display_name || "", entry.merchant_key || ""];
  if (entry.aliases_json) {
    try {
      const parsed = JSON.parse(entry.aliases_json);
      if (Array.isArray(parsed)) aliases.push(...parsed.filter((item) => typeof item === "string"));
    } catch {}
  }
  return aliases.map(normalizeRulePattern).filter(Boolean);
}

function containsPhrase(text: string, phrase: string) {
  if (phrase.length === 0) return false;
  return ` ${text} `.includes(` ${phrase} `) || text.includes(phrase);
}

function significantTokens(value: string) {
  return normalizeRulePattern(value).split(" ").filter((token) => token.length >= 3 && STRONG_NOISE_TOKENS.has(token) === false && /^\d+$/.test(token) === false);
}

export function extractMerchant(normalizedDescription: string, dictionary: MerchantDictionaryEntry[] = []) {
  const normalized = normalizeBankDescription(normalizedDescription).normalized;
  if (normalized.length === 0) return {merchant_key: null as string | null, confidence: 0, method: "empty"};
  for (const entry of dictionary) {
    const aliases = parseAliases(entry);
    if (aliases.some((alias) => containsPhrase(normalized, alias))) {
      return {merchant_key: normalizeRulePattern(entry.merchant_key), confidence: 0.98, method: "dictionary"};
    }
  }
  const tokens = significantTokens(normalized);
  if (tokens.length === 0) return {merchant_key: null as string | null, confidence: 0, method: "noise_only"};
  const token = tokens[0];
  if (token && token.length >= 3) return {merchant_key: token, confidence: tokens.length >= 2 ? 0.72 : 0.68, method: "token"};
  return {merchant_key: null as string | null, confidence: 0, method: "noise_only"};
}

export function deriveRuleIdentity(descBanco: string, context: {accountId?: string | null; currency?: string | null; direction?: "expense" | "income" | "any" | null} = {}, dictionary: MerchantDictionaryEntry[] = []) {
  const normalized = normalizeBankDescription(descBanco).normalized;
  const merchant = extractMerchant(normalized, dictionary);
  if (merchant.merchant_key === null || isGenericRulePattern(merchant.merchant_key)) {
    return {skipped: true, skippedReason: "generic_or_empty_merchant", normalized_pattern: normalized, merchant_key: null as string | null, merchant_scope: "", account_scope: context.accountId || "", currency_scope: context.currency || "", direction: context.direction || "any", confidence: merchant.confidence};
  }
  return {skipped: false, skippedReason: null as string | null, normalized_pattern: merchant.merchant_key, merchant_key: merchant.merchant_key, merchant_scope: merchant.merchant_key, account_scope: context.accountId || "", currency_scope: context.currency || "", direction: context.direction || "any", confidence: merchant.confidence};
}

export function getRuleScopes(rule: Partial<RuleCandidate>) {
  const normalizedPattern = normalizeRulePattern(String(rule.normalized_pattern || rule.pattern || ""));
  const merchantKey = normalizeRulePattern(String(rule.merchant_key || rule.merchant_scope || normalizedPattern || ""));
  return {merchant_scope: normalizeRulePattern(String(rule.merchant_scope || merchantKey || normalizedPattern)), account_scope: String(rule.account_id || ""), currency_scope: String(rule.currency || ""), direction: (rule.direction || "any") as CategorizationDirection};
}

function directionForAmount(amount?: number | null) {
  if (Number(amount || 0) >= 0) return "income";
  return "expense";
}

function recencyFactor(value?: string | null) {
  if (value === null || value === undefined || value.length === 0) return 1;
  const time = Date.parse(value);
  if (Number.isFinite(time) === false) return 1;
  const days = Math.max(0, (Date.now() - time) / 86400000);
  return Math.max(0.72, 1 - days / 3650);
}

function scopeBonus(rule: RuleCandidate, tx: TransactionForCategorization) {
  let bonus = 0;
  if (rule.account_id && tx.account_id && rule.account_id === tx.account_id) bonus += 0.08;
  if (rule.currency && tx.moneda && rule.currency === tx.moneda) bonus += 0.05;
  const direction = rule.direction || "any";
  if (direction !== "any" && direction === directionForAmount(tx.monto)) bonus += 0.05;
  return bonus;
}

export function scoreRuleMatch(tx: TransactionForCategorization, rule: RuleCandidate, dictionary: MerchantDictionaryEntry[] = []) {
  if ((rule.mode || "suggest") === "disabled") return Number.NEGATIVE_INFINITY;
  const identity = tx.merchant_key ? {merchant_key: tx.merchant_key} : deriveRuleIdentity(tx.desc_banco, {accountId: tx.account_id, currency: tx.moneda, direction: directionForAmount(tx.monto)}, dictionary);
  const txMerchant = normalizeRulePattern(String(identity.merchant_key || ""));
  const ruleMerchant = normalizeRulePattern(String(rule.merchant_key || rule.merchant_scope || ""));
  const normalizedDesc = normalizeBankDescription(tx.desc_banco).normalized;
  const pattern = normalizeRulePattern(String(rule.normalized_pattern || rule.pattern || ""));
  const direction = rule.direction || "any";
  if (rule.account_id && rule.account_id !== (tx.account_id || null)) return Number.NEGATIVE_INFINITY;
  if (rule.currency && rule.currency !== (tx.moneda || null)) return Number.NEGATIVE_INFINITY;
  if (direction !== "any" && direction !== directionForAmount(tx.monto)) return Number.NEGATIVE_INFINITY;
  let base = 0;
  let layer: MatchDecision["layer"] = "fallback";
  if (txMerchant && ruleMerchant && txMerchant === ruleMerchant && pattern === txMerchant) {
    base = 0.9;
    layer = "merchant_exact";
  } else if (pattern && isGenericRulePattern(pattern) === false && normalizedDesc.includes(pattern)) {
    const patternTokens = pattern.split(" ").length;
    base = 0.66 + Math.min(pattern.length / Math.max(normalizedDesc.length, 1), 0.16) + (patternTokens >= 2 ? 0.08 : 0);
    layer = "pattern_substring";
  } else {
    return Number.NEGATIVE_INFINITY;
  }
  const confidence = Math.max(0.01, Math.min(1, Number(rule.confidence ?? 0.72)));
  const matches = Math.min(0.08, Math.log10(Number(rule.match_count || 0) + 1) * 0.05);
  const score = (base * confidence * recencyFactor(rule.last_matched_at)) + matches + scopeBonus(rule, tx);
  return {score: Math.min(0.99, Number(score.toFixed(4))), layer};
}

export function matchRules(tx: TransactionForCategorization, rules: RuleCandidate[] = [], dictionary: MerchantDictionaryEntry[] = []) {
  let best: {rule: RuleCandidate; score: number; layer: MatchDecision["layer"]} | null = null;
  for (const rule of rules) {
    const scored = scoreRuleMatch(tx, rule, dictionary);
    if (typeof scored === "number") continue;
    if (best === null || scored.score > best.score) {
      best = {rule, score: scored.score, layer: scored.layer};
    }
  }
  return best;
}

function threshold(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function classifyTransaction(tx: TransactionForCategorization, rules: RuleCandidate[] = [], ruleRejections: RuleRejection[] = [], settings: CategorizationSettings = {}, dictionary: MerchantDictionaryEntry[] = []): MatchDecision {
  const identity = deriveRuleIdentity(tx.desc_banco, {accountId: tx.account_id, currency: tx.moneda, direction: directionForAmount(tx.monto)}, dictionary);
  const match = matchRules({...tx, merchant_key: identity.merchant_key}, rules, dictionary);
  const autoThreshold = threshold(settings.categorizer_auto_threshold, 0.9);
  const suggestThreshold = threshold(settings.categorizer_suggest_threshold, 0.6);
  if (match === null || match.rule.category_id == null) {
    return {categoryId: null, categorizationStatus: "uncategorized", categorySource: null, categoryConfidence: null, categoryRuleId: null, matchedRule: null, merchantKey: identity.merchant_key, layer: "fallback", reason: identity.skipped ? `Sin merchant confiable: ${identity.skippedReason}` : "Sin regla suficiente"};
  }
  const normalizedDesc = normalizeBankDescription(tx.desc_banco).normalized;
  if (match.rule.id && ruleRejections.length > 0) {
    const rejection = ruleRejections.find((r) => r.rule_id === match.rule.id);
    if (rejection && normalizedDesc.includes(rejection.desc_banco_normalized)) {
      return {categoryId: null, categorizationStatus: "rejected", categorySource: null, categoryConfidence: null, categoryRuleId: null, matchedRule: null, merchantKey: identity.merchant_key, layer: "fallback", reason: "rule_rejected_by_user"};
    }
  }
  const status = (match.rule.mode === "auto" || match.score >= autoThreshold) ? "categorized" : (match.rule.mode === "suggest" || match.score >= suggestThreshold) ? "suggested" : "uncategorized";
  return {categoryId: status === "uncategorized" ? null : Number(match.rule.category_id), categorizationStatus: status, categorySource: status === "uncategorized" ? null : (match.layer === "merchant_exact" ? "merchant_exact" : "rule_suggest"), categoryConfidence: status === "uncategorized" ? null : match.score, categoryRuleId: status === "uncategorized" ? null : Number(match.rule.id || 0) || null, matchedRule: status === "uncategorized" ? null : match.rule, merchantKey: identity.merchant_key, layer: match.layer, reason: `${match.layer}: ${match.rule.pattern}`};
}

export function buildManualRuleUpsert(tx: TransactionForCategorization, categoryId: number, scopePreference: "account" | "global" = tx.account_id ? "account" : "global", dictionary: MerchantDictionaryEntry[] = []) {
  const direction = directionForAmount(tx.monto);
  const identity = deriveRuleIdentity(tx.desc_banco, {accountId: scopePreference === "account" ? tx.account_id : null, currency: tx.moneda, direction}, dictionary);
  if (identity.skipped || identity.merchant_key === null) {
    return {skipped: true, skippedReason: identity.skippedReason || "generic_or_empty_merchant", categoryId, identity};
  }
  return {skipped: false, skippedReason: null, categoryId, pattern: identity.merchant_key.toUpperCase(), normalized_pattern: identity.normalized_pattern, merchant_key: identity.merchant_key, merchant_scope: identity.merchant_scope, account_id: scopePreference === "account" ? (tx.account_id || null) : null, account_scope: scopePreference === "account" ? (tx.account_id || "") : "", currency: tx.moneda || null, currency_scope: tx.moneda || "", direction, confidence: Math.max(0.9, identity.confidence)};
}
