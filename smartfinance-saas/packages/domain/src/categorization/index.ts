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
  transaction_id?: number | null;
};

export type MerchantExtraction = {
  merchant_key: string | null;
  display_guess: string | null;
  confidence: number;
  method: "empty" | "dictionary" | "known_brand" | "ngram" | "token" | "noise_only";
  stripped_noise: string[];
  skipped_reason: string | null;
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
  explanation: string;
};

const EDGE_NOISE_PHRASES = ["debito a confirmar banred compra", "extorno compra con visa debito dev", "compra con tarjeta debito", "compra con tarjeta", "compra tarjeta", "compra con debito", "compra con credito", "compra internacional", "debito automatico", "debito aut", "credito por operacion", "debito operacion", "operacion en supernet o sms", "operacion en supernet", "en supernet o sms", "en supernet", "pago con tarjeta", "pago tarjeta", "pago con toke", "visa pos", "mastercard pos", "pos", "web", "online", "dlo"];

const GENERIC_TOKENS = new Set(["a", "al", "con", "de", "del", "el", "en", "la", "los", "las", "o", "por", "para", "tarjeta", "tarj", "compra", "compras", "debito", "deb", "credito", "cred", "visa", "master", "mastercard", "pago", "pagos", "cuota", "cuotas", "consumo", "local", "comercio", "pos", "web", "online", "internacional", "internac", "nacional", "uy", "uru", "cta", "caja", "ahorro", "movimiento", "compraweb", "punto", "venta", "servicio", "tc", "titular", "operacion", "supernet", "sms", "confirmar", "banred", "dev", "fecha", "toke"]);

const STRONG_NOISE_TOKENS = new Set([...GENERIC_TOKENS, "comision", "mercado", "trip", "one", "viaje", "transferencia", "transf", "trf", "instantanea", "enviada", "recibida", "nrr", "id", "brou", "itau", "santander", "bbva", "scotia", "hsbc", "montevideo", "colonia", "punta", "est", "este"]);

const KNOWN_BRAND_ALIASES: Array<{merchant_key: string; aliases: string[]}> = [
  {merchant_key: "uber", aliases: ["uber", "uber trip", "uber rides", "dlo uber rides"]},
  {merchant_key: "pedidosya", aliases: ["pedidosya", "pedido ya", "pedidos ya"]},
  {merchant_key: "rappi", aliases: ["rappi"]},
  {merchant_key: "mcdonalds", aliases: ["mcdonalds", "mcdonald", "mc donald"]},
  {merchant_key: "burger king", aliases: ["burger king"]},
  {merchant_key: "subway", aliases: ["subway"]},
  {merchant_key: "disco", aliases: ["disco"]},
  {merchant_key: "frog", aliases: ["frog"]},
  {merchant_key: "devoto", aliases: ["devoto"]},
  {merchant_key: "tienda inglesa", aliases: ["tienda inglesa"]},
  {merchant_key: "mercadopago", aliases: ["mercadopago", "mercado pago"]},
  {merchant_key: "mercadolibre", aliases: ["mercadolibre", "mercado libre"]},
  {merchant_key: "spotify", aliases: ["spotify"]},
  {merchant_key: "netflix", aliases: ["netflix"]},
  {merchant_key: "openai", aliases: ["openai", "chatgpt"]},
  {merchant_key: "anthropic", aliases: ["anthropic", "claude"]},
  {merchant_key: "iberpark", aliases: ["iberpark"]},
  {merchant_key: "cafeteria infinito", aliases: ["cafeteria infinito"]},
  {merchant_key: "cafe del puerto", aliases: ["cafe del puerto", "rest cafe del puerto"]},
  {merchant_key: "cines life", aliases: ["cines life"]},
  {merchant_key: "cot", aliases: ["cot trpacot", "cot"]},
];

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function removeBankArtifacts(value: string) {
  return stripDiacritics(String(value || ""))
    .replace(/#+\d*/g, " ")
    .replace(/\btarj(?:eta)?\s*:?\s*[\d#-]+/gi, " ")
    .replace(/\bfecha\s*:?\s*\d{6,}/gi, " ")
    .replace(/\bnrr\s*:?\s*\d+/gi, " ")
    .replace(/\bid\s*:?\s*\d+/gi, " ")
    .replace(/\bvis\d+\b/gi, " ")
    .replace(/\b(?=[\p{L}\p{N}]*\d)[\p{L}\p{N}]{4,}\b/gu, " ");
}

function normalizeRulePattern(value: string) {
  return removeBankArtifacts(value).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b\d{3,}\b/g, " ").replace(/\s+/g, " ").trim();
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

function titleCase(value: string) {
  return value.split(" ").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function ngrams(tokens: string[], size: number) {
  const output: string[] = [];
  for (let index = 0; index + size <= tokens.length; index += 1) {
    output.push(tokens.slice(index, index + size).join(" "));
  }
  return output;
}

function scoreMerchantPhrase(phrase: string) {
  const tokens = phrase.split(" ").filter(Boolean);
  const lengthScore = Math.min(0.18, phrase.length / 80);
  const tokenScore = Math.min(0.12, tokens.length * 0.04);
  const genericPenalty = tokens.some((token) => GENERIC_TOKENS.has(token)) ? 0.18 : 0;
  return 0.68 + lengthScore + tokenScore - genericPenalty;
}

function bestSignificantPhrase(tokens: string[]) {
  const candidates = [
    ...ngrams(tokens, 3),
    ...ngrams(tokens, 2),
    ...ngrams(tokens, 1),
  ].filter((candidate) => isGenericRulePattern(candidate) === false);
  return candidates
    .map((phrase) => ({phrase, score: scoreMerchantPhrase(phrase), index: tokens.join(" ").indexOf(phrase)}))
    .sort((left, right) => right.score - left.score || left.index - right.index || right.phrase.length - left.phrase.length)[0] || null;
}

function isChannelOnlyDescription(normalized: string) {
  return /(^|\s)(comision|transf|transferencia)\s/.test(normalized) || normalized.includes("operacion en supernet") || normalized.startsWith("credito por operacion");
}

function strippedChannelNoise(strippedNoise: string[]) {
  return strippedNoise.some((phrase) => phrase.includes("operacion") || phrase.includes("supernet") || phrase.includes("credito por operacion"));
}

export function extractMerchant(normalizedDescription: string, dictionary: MerchantDictionaryEntry[] = []): MerchantExtraction {
  const normalizedResult = normalizeBankDescription(normalizedDescription);
  const normalized = normalizedResult.normalized;
  if (normalized.length === 0) return {merchant_key: null, display_guess: null, confidence: 0, method: "empty", stripped_noise: normalizedResult.stripped_noise, skipped_reason: "empty_description"};

  const dictionaryEntries = [...dictionary].sort((left, right) => {
    const leftLength = Math.max(...parseAliases(left).map((alias) => alias.length), 0);
    const rightLength = Math.max(...parseAliases(right).map((alias) => alias.length), 0);
    return rightLength - leftLength;
  });

  for (const entry of dictionaryEntries) {
    const aliases = parseAliases(entry);
    if (aliases.some((alias) => containsPhrase(normalized, alias))) {
      const merchantKey = normalizeRulePattern(entry.merchant_key);
      return {merchant_key: merchantKey, display_guess: entry.display_name || titleCase(merchantKey), confidence: 0.98, method: "dictionary", stripped_noise: normalizedResult.stripped_noise, skipped_reason: null};
    }
  }

  for (const brand of KNOWN_BRAND_ALIASES) {
    const aliases = brand.aliases.map(normalizeRulePattern).sort((left, right) => right.length - left.length);
    if (aliases.some((alias) => containsPhrase(normalized, alias))) {
      return {merchant_key: normalizeRulePattern(brand.merchant_key), display_guess: titleCase(brand.merchant_key), confidence: 0.9, method: "known_brand", stripped_noise: normalizedResult.stripped_noise, skipped_reason: null};
    }
  }

  if (isChannelOnlyDescription(normalized) || strippedChannelNoise(normalizedResult.stripped_noise)) return {merchant_key: null, display_guess: null, confidence: 0, method: "noise_only", stripped_noise: normalizedResult.stripped_noise, skipped_reason: "channel_or_transfer"};

  const tokens = significantTokens(normalized);
  if (tokens.length === 0) return {merchant_key: null, display_guess: null, confidence: 0, method: "noise_only", stripped_noise: normalizedResult.stripped_noise, skipped_reason: "noise_only"};

  const phrase = bestSignificantPhrase(tokens);
  if (phrase && phrase.phrase.includes(" ")) {
    return {merchant_key: phrase.phrase, display_guess: titleCase(phrase.phrase), confidence: Math.min(0.86, Number(phrase.score.toFixed(2))), method: "ngram", stripped_noise: normalizedResult.stripped_noise, skipped_reason: null};
  }

  const token = tokens.sort((left, right) => right.length - left.length)[0];
  if (token && token.length >= 3) return {merchant_key: token, display_guess: titleCase(token), confidence: 0.68, method: "token", stripped_noise: normalizedResult.stripped_noise, skipped_reason: null};
  return {merchant_key: null, display_guess: null, confidence: 0, method: "noise_only", stripped_noise: normalizedResult.stripped_noise, skipped_reason: "noise_only"};
}

export function deriveRuleIdentity(descBanco: string, context: {accountId?: string | null; currency?: string | null; direction?: "expense" | "income" | "any" | null} = {}, dictionary: MerchantDictionaryEntry[] = []) {
  const normalized = normalizeBankDescription(descBanco).normalized;
  const merchant = extractMerchant(normalized, dictionary);
  if (merchant.merchant_key === null || isGenericRulePattern(merchant.merchant_key)) {
    return {skipped: true, skippedReason: merchant.skipped_reason || "generic_or_empty_merchant", normalized_pattern: normalized, merchant_key: null as string | null, merchant_scope: "", account_scope: context.accountId || "", currency_scope: context.currency || "", direction: context.direction || "any", confidence: merchant.confidence, merchant};
  }
  return {skipped: false, skippedReason: null as string | null, normalized_pattern: merchant.merchant_key, merchant_key: merchant.merchant_key, merchant_scope: merchant.merchant_key, account_scope: context.accountId || "", currency_scope: context.currency || "", direction: context.direction || "any", confidence: merchant.confidence, merchant};
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
  if (days > 90) return Math.max(0.72, 1 - (days - 90) / 3650);
  return 1;
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
  const safeModePenalty = rule.mode === "auto" ? 0 : 0.04;
  const score = (base * confidence * recencyFactor(rule.last_matched_at)) + matches + scopeBonus(rule, tx) - safeModePenalty;
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
  const autoThreshold = threshold(settings.categorizer_auto_threshold, 0.92);
  const suggestThreshold = threshold(settings.categorizer_suggest_threshold, 0.65);
  if (match === null || match.rule.category_id == null) {
    const reason = identity.skipped ? `Sin merchant confiable: ${identity.skippedReason}` : "Sin regla suficiente";
    return {categoryId: null, categorizationStatus: "uncategorized", categorySource: null, categoryConfidence: null, categoryRuleId: null, matchedRule: null, merchantKey: identity.merchant_key, layer: "fallback", reason, explanation: reason};
  }
  const normalizedDesc = normalizeBankDescription(tx.desc_banco).normalized;
  if (match.rule.id && ruleRejections.length > 0) {
    const rejection = ruleRejections.find((r) => r.rule_id === match.rule.id && (r.transaction_id == null || tx.merchant_key == null || normalizedDesc.includes(r.desc_banco_normalized)));
    if (rejection && normalizedDesc.includes(rejection.desc_banco_normalized)) {
      return {categoryId: null, categorizationStatus: "rejected", categorySource: null, categoryConfidence: null, categoryRuleId: null, matchedRule: null, merchantKey: identity.merchant_key, layer: "fallback", reason: "rule_rejected_by_user", explanation: `Regla rechazada por usuario: ${match.rule.pattern}`};
    }
  }
  const status = match.score >= autoThreshold ? "categorized" : match.score >= suggestThreshold ? "suggested" : "uncategorized";
  const explanation = explainCategorization({
    categorizationStatus: status,
    categoryConfidence: status === "uncategorized" ? null : match.score,
    matchedRule: status === "uncategorized" ? null : match.rule,
    merchantKey: identity.merchant_key,
    layer: match.layer,
    reason: `${match.layer}: ${match.rule.pattern}`,
  });
  return {categoryId: status === "uncategorized" ? null : Number(match.rule.category_id), categorizationStatus: status, categorySource: status === "uncategorized" ? null : (match.layer === "merchant_exact" ? "merchant_exact" : "rule_suggest"), categoryConfidence: status === "uncategorized" ? null : match.score, categoryRuleId: status === "uncategorized" ? null : Number(match.rule.id || 0) || null, matchedRule: status === "uncategorized" ? null : match.rule, merchantKey: identity.merchant_key, layer: match.layer, reason: `${match.layer}: ${match.rule.pattern}`, explanation};
}

export function explainCategorization(decision: Pick<MatchDecision, "categorizationStatus" | "layer" | "merchantKey" | "matchedRule" | "categoryConfidence" | "reason">) {
  const percent = decision.categoryConfidence == null ? null : `${Math.round(decision.categoryConfidence * 100)}%`;
  if (decision.categorizationStatus === "categorized" && decision.layer === "merchant_exact") {
    return `Merchant exacto: ${decision.merchantKey || decision.matchedRule?.merchant_key || decision.matchedRule?.pattern}${percent ? ` (${percent})` : ""}`;
  }
  if (decision.categorizationStatus === "suggested") {
    return `Sugerido por ${decision.layer === "pattern_substring" ? "patron" : "merchant"}: ${decision.matchedRule?.pattern || decision.merchantKey || "regla"}${percent ? ` (${percent})` : ""}`;
  }
  if (decision.categorizationStatus === "rejected" || decision.categorizationStatus === "rule_rejected") {
    return "Regla rechazada por usuario";
  }
  return decision.reason || "Sin regla suficiente";
}

export function buildManualRuleUpsert(tx: TransactionForCategorization, categoryId: number, scopePreference: "account" | "global" = tx.account_id ? "account" : "global", dictionary: MerchantDictionaryEntry[] = []) {
  const direction = directionForAmount(tx.monto);
  const identity = deriveRuleIdentity(tx.desc_banco, {accountId: scopePreference === "account" ? tx.account_id : null, currency: tx.moneda, direction}, dictionary);
  if (identity.skipped || identity.merchant_key === null) {
    return {skipped: true, skippedReason: identity.skippedReason || "generic_or_empty_merchant", categoryId, identity};
  }
  return {skipped: false, skippedReason: null, categoryId, pattern: identity.merchant_key.toUpperCase(), normalized_pattern: identity.normalized_pattern, merchant_key: identity.merchant_key, merchant_scope: identity.merchant_scope, account_id: scopePreference === "account" ? (tx.account_id || null) : null, account_scope: scopePreference === "account" ? (tx.account_id || "") : "", currency: tx.moneda || null, currency_scope: tx.moneda || "", direction, confidence: Math.max(0.9, identity.confidence)};
}
