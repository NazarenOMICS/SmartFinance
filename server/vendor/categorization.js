// Vendorized domain categorization logic — translated from smartfinance-saas TypeScript
// Canonical source: /tmp/cat-test/categorization.ts

const EDGE_NOISE_PHRASES = [
  "compra con tarjeta", "compra tarjeta", "compra con debito", "compra con credito",
  "compra internacional", "debito automatico", "debito aut", "credito por operacion",
  "debito operacion", "operacion en supernet", "pago con tarjeta", "pago tarjeta",
  "visa pos", "mastercard pos", "pos", "web", "online", "dlo"
];

const GENERIC_TOKENS = new Set([
  "a", "al", "con", "de", "del", "el", "en", "la", "por", "para", "tarjeta",
  "compra", "compras", "debito", "deb", "credito", "cred", "visa", "master",
  "mastercard", "pago", "pagos", "cuota", "cuotas", "consumo", "local",
  "comercio", "pos", "web", "online", "internacional", "internac", "nacional",
  "uy", "uru", "cta", "caja", "ahorro", "movimiento", "compraweb", "punto",
  "venta", "servicio", "tc", "titular", "operacion", "supernet", "sms"
]);

const STRONG_NOISE_TOKENS = new Set([
  ...GENERIC_TOKENS,
  "comision", "mercado", "trip", "one", "viaje", "transferencia", "transf",
  "trf", "brou", "itau", "santander", "bbva", "scotia", "hsbc"
]);

function stripDiacritics(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeRulePattern(value) {
  return stripDiacritics(String(value || ""))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEdgeNoise(normalized) {
  let output = ` ${normalized} `;
  const stripped = [];
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
  return {
    normalized: output.replace(/\s+/g, " ").trim(),
    stripped_noise: [...new Set(stripped)]
  };
}

function normalizeBankDescription(input, _context = {}) {
  const normalized = normalizeRulePattern(input);
  return stripEdgeNoise(normalized);
}

function isGenericRulePattern(pattern) {
  const tokens = normalizeRulePattern(pattern).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => token.length < 3 || STRONG_NOISE_TOKENS.has(token));
}

function parseAliases(entry) {
  const aliases = [...(entry.aliases || []), entry.display_name || "", entry.merchant_key || ""];
  if (entry.aliases_json) {
    try {
      const parsed = JSON.parse(entry.aliases_json);
      if (Array.isArray(parsed)) aliases.push(...parsed.filter((item) => typeof item === "string"));
    } catch {}
  }
  return aliases.map(normalizeRulePattern).filter(Boolean);
}

function containsPhrase(text, phrase) {
  if (phrase.length === 0) return false;
  return ` ${text} `.includes(` ${phrase} `) || text.includes(phrase);
}

function significantTokens(value) {
  return normalizeRulePattern(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !STRONG_NOISE_TOKENS.has(token) && !/^\d+$/.test(token));
}

function extractMerchant(normalizedDescription, dictionary = []) {
  const normalized = normalizeBankDescription(normalizedDescription).normalized;
  if (normalized.length === 0) {
    return { merchant_key: null, confidence: 0, method: "empty" };
  }
  for (const entry of dictionary) {
    const aliases = parseAliases(entry);
    if (aliases.some((alias) => containsPhrase(normalized, alias))) {
      return {
        merchant_key: normalizeRulePattern(entry.merchant_key),
        confidence: 0.98,
        method: "dictionary"
      };
    }
  }
  const tokens = significantTokens(normalized);
  if (tokens.length === 0) {
    return { merchant_key: null, confidence: 0, method: "noise_only" };
  }
  const token = tokens[0];
  if (token && token.length >= 3) {
    return {
      merchant_key: token,
      confidence: tokens.length >= 2 ? 0.72 : 0.68,
      method: "token"
    };
  }
  return { merchant_key: null, confidence: 0, method: "noise_only" };
}

function deriveRuleIdentity(descBanco, context = {}, dictionary = []) {
  const normalized = normalizeBankDescription(descBanco).normalized;
  const merchant = extractMerchant(normalized, dictionary);
  if (merchant.merchant_key === null || isGenericRulePattern(merchant.merchant_key)) {
    return {
      skipped: true,
      skippedReason: "generic_or_empty_merchant",
      normalized_pattern: normalized,
      merchant_key: null,
      merchant_scope: "",
      account_scope: context.accountId || "",
      currency_scope: context.currency || "",
      direction: context.direction || "any",
      confidence: merchant.confidence
    };
  }
  return {
    skipped: false,
    skippedReason: null,
    normalized_pattern: merchant.merchant_key,
    merchant_key: merchant.merchant_key,
    merchant_scope: merchant.merchant_key,
    account_scope: context.accountId || "",
    currency_scope: context.currency || "",
    direction: context.direction || "any",
    confidence: merchant.confidence
  };
}

function directionForAmount(amount) {
  return Number(amount || 0) >= 0 ? "income" : "expense";
}

function recencyFactor(value) {
  if (value === null || value === undefined || value.length === 0) return 1;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 1;
  const days = Math.max(0, (Date.now() - time) / 86400000);
  return Math.max(0.72, 1 - days / 3650);
}

function scopeBonus(rule, tx) {
  let bonus = 0;
  if (rule.account_id && tx.account_id && rule.account_id === tx.account_id) bonus += 0.08;
  if (rule.currency && tx.moneda && rule.currency === tx.moneda) bonus += 0.05;
  const direction = rule.direction || "any";
  if (direction !== "any" && direction === directionForAmount(tx.monto)) bonus += 0.05;
  return bonus;
}

function scoreRuleMatch(tx, rule, dictionary = []) {
  if ((rule.mode || "suggest") === "disabled") return Number.NEGATIVE_INFINITY;
  const identity = tx.merchant_key
    ? { merchant_key: tx.merchant_key }
    : deriveRuleIdentity(
        tx.desc_banco,
        { accountId: tx.account_id, currency: tx.moneda, direction: directionForAmount(tx.monto) },
        dictionary
      );
  const txMerchant = normalizeRulePattern(String(identity.merchant_key || ""));
  const ruleMerchant = normalizeRulePattern(String(rule.merchant_key || rule.merchant_scope || ""));
  const normalizedDesc = normalizeBankDescription(tx.desc_banco).normalized;
  const pattern = normalizeRulePattern(String(rule.normalized_pattern || rule.pattern || ""));
  const direction = rule.direction || "any";

  if (rule.account_id && rule.account_id !== (tx.account_id || null)) return Number.NEGATIVE_INFINITY;
  if (rule.currency && rule.currency !== (tx.moneda || null)) return Number.NEGATIVE_INFINITY;
  if (direction !== "any" && direction !== directionForAmount(tx.monto)) return Number.NEGATIVE_INFINITY;

  let base = 0;
  let layer = "fallback";

  if (txMerchant && ruleMerchant && txMerchant === ruleMerchant && pattern === txMerchant) {
    base = 0.9;
    layer = "merchant_exact";
  } else if (
    pattern &&
    !isGenericRulePattern(pattern) &&
    normalizedDesc.includes(pattern)
  ) {
    const patternTokens = pattern.split(" ").length;
    base =
      0.66 +
      Math.min(pattern.length / Math.max(normalizedDesc.length, 1), 0.16) +
      (patternTokens >= 2 ? 0.08 : 0);
    layer = "pattern_substring";
  } else {
    return Number.NEGATIVE_INFINITY;
  }

  const confidence = Math.max(0.01, Math.min(1, Number(rule.confidence ?? 0.72)));
  const matches = Math.min(0.08, Math.log10(Number(rule.match_count || 0) + 1) * 0.05);
  const score = base * confidence * recencyFactor(rule.last_matched_at) + matches + scopeBonus(rule, tx);
  return { score: Math.min(0.99, Number(score.toFixed(4))), layer };
}

function matchRules(tx, rules = [], dictionary = []) {
  let best = null;
  for (const rule of rules) {
    const scored = scoreRuleMatch(tx, rule, dictionary);
    if (typeof scored === "number") continue;
    if (best === null || scored.score > best.score) {
      best = { rule, score: scored.score, layer: scored.layer };
    }
  }
  return best;
}

function threshold(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function classifyTransaction(tx, rules = [], ruleRejections = [], settings = {}, dictionary = []) {
  const identity = deriveRuleIdentity(
    tx.desc_banco,
    { accountId: tx.account_id, currency: tx.moneda, direction: directionForAmount(tx.monto) },
    dictionary
  );
  const match = matchRules({ ...tx, merchant_key: identity.merchant_key }, rules, dictionary);
  const autoThreshold = threshold(settings.categorizer_auto_threshold, 0.9);
  const suggestThreshold = threshold(settings.categorizer_suggest_threshold, 0.6);

  if (match === null || match.rule.category_id == null) {
    return {
      categoryId: null,
      categorizationStatus: "uncategorized",
      categorySource: null,
      categoryConfidence: null,
      categoryRuleId: null,
      matchedRule: null,
      merchantKey: identity.merchant_key,
      layer: "fallback",
      reason: identity.skipped
        ? `Sin merchant confiable: ${identity.skippedReason}`
        : "Sin regla suficiente"
    };
  }

  const normalizedDesc = normalizeBankDescription(tx.desc_banco).normalized;
  if (match.rule.id && ruleRejections.length > 0) {
    const rejection = ruleRejections.find((r) => r.rule_id === match.rule.id);
    if (rejection && normalizedDesc.includes(rejection.desc_banco_normalized)) {
      return {
        categoryId: null,
        categorizationStatus: "rejected",
        categorySource: null,
        categoryConfidence: null,
        categoryRuleId: null,
        matchedRule: null,
        merchantKey: identity.merchant_key,
        layer: "fallback",
        reason: "rule_rejected_by_user"
      };
    }
  }

  const status =
    match.rule.mode === "auto" || match.score >= autoThreshold
      ? "categorized"
      : match.rule.mode === "suggest" || match.score >= suggestThreshold
      ? "suggested"
      : "uncategorized";

  return {
    categoryId: status === "uncategorized" ? null : Number(match.rule.category_id),
    categorizationStatus: status,
    categorySource:
      status === "uncategorized"
        ? null
        : match.layer === "merchant_exact"
        ? "merchant_exact"
        : "rule_suggest",
    categoryConfidence: status === "uncategorized" ? null : match.score,
    categoryRuleId:
      status === "uncategorized" ? null : Number(match.rule.id || 0) || null,
    matchedRule: status === "uncategorized" ? null : match.rule,
    merchantKey: identity.merchant_key,
    layer: match.layer,
    reason: `${match.layer}: ${match.rule.pattern}`
  };
}

function buildManualRuleUpsert(tx, categoryId, scopePreference = tx.account_id ? "account" : "global", dictionary = []) {
  const direction = directionForAmount(tx.monto);
  const identity = deriveRuleIdentity(
    tx.desc_banco,
    { accountId: scopePreference === "account" ? tx.account_id : null, currency: tx.moneda, direction },
    dictionary
  );

  if (identity.skipped || identity.merchant_key === null) {
    return {
      skipped: true,
      skippedReason: identity.skippedReason || "generic_or_empty_merchant",
      categoryId,
      identity
    };
  }

  return {
    skipped: false,
    skippedReason: null,
    categoryId,
    pattern: identity.merchant_key.toUpperCase(),
    normalized_pattern: identity.normalized_pattern,
    merchant_key: identity.merchant_key,
    merchant_scope: identity.merchant_scope,
    account_id: scopePreference === "account" ? (tx.account_id || null) : null,
    account_scope: scopePreference === "account" ? (tx.account_id || "") : "",
    currency: tx.moneda || null,
    currency_scope: tx.moneda || "",
    direction,
    confidence: Math.max(0.9, identity.confidence)
  };
}

module.exports = {
  normalizeBankDescription,
  extractMerchant,
  deriveRuleIdentity,
  classifyTransaction,
  buildManualRuleUpsert
};
