const GENERIC_PREFIXES = new Set([
  "compra",
  "consumo",
  "debito",
  "credito",
  "pago",
  "transferencia",
  "visa",
  "master",
  "pos",
  "rest",
  "web",
  "app",
]);

const COUNTERPARTY_NOISE_TOKENS = new Set([
  ...GENERIC_PREFIXES,
  "a",
  "al",
  "de",
  "del",
  "la",
  "el",
  "para",
  "por",
  "en",
  "desde",
  "hacia",
  "inmediata",
  "realizada",
  "enviada",
  "recibida",
  "plaza",
  "brou",
  "itau",
  "ita",
  "santander",
  "bbva",
  "scotia",
  "hsbc",
  "operacion",
  "supernet",
  "cuenta",
  "caja",
  "ahorro",
  "debito",
  "credito",
  "transferencia",
  "transf",
  "trf",
]);

const GENERIC_PATTERN_TOKENS = new Set([
  "con",
  "tarjeta",
  "tarj",
  "compra",
  "debito",
  "deb",
  "credito",
  "visa",
  "master",
  "mastercard",
  "pago",
  "cuota",
  "cuotas",
  "consumo",
  "local",
  "comercio",
  "pos",
  "web",
  "online",
  "internacional",
  "internac",
  "nacional",
  "uy",
  "uru",
  "cta",
  "caja",
  "ahorro",
  "movimiento",
  "compraweb",
  "punto",
  "venta",
  "servicio",
  "tc",
  "titular",
  "operacion",
  "supernet",
  "sms",
  "comision",
  "rest",
]);

export type RuleMatchCandidate = {
  id?: number;
  pattern: string;
  normalized_pattern?: string;
  category_id?: number | null;
  mode?: "auto" | "suggest" | "disabled";
  confidence?: number;
  account_id?: string | null;
  currency?: string | null;
  direction?: "any" | "expense" | "income";
  match_count?: number;
};

export type RuleMatchingContext = {
  description: string;
  accountId?: string | null;
  currency?: string | null;
  direction?: "expense" | "income";
};

function stripDiacritics(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeRulePattern(value: string) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGenericRulePattern(pattern: string) {
  const tokens = normalizeRulePattern(pattern).split(" ").filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => token.length < 3 || GENERIC_PATTERN_TOKENS.has(token));
}

export function deriveRulePattern(description: string) {
  const normalized = normalizeRulePattern(description);
  if (!normalized) return null;

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 2 && !/\d/.test(token));

  while (tokens.length > 0 && (GENERIC_PREFIXES.has(tokens[0]) || GENERIC_PATTERN_TOKENS.has(tokens[0]))) {
    tokens.shift();
  }

  if (tokens.length === 0) return null;
  if (tokens.length === 1 && isGenericRulePattern(tokens[0])) return null;
  if (tokens[0].length >= 4 || tokens.length === 1) {
    return tokens[0].toUpperCase();
  }

  const pattern = tokens.slice(0, 2).join(" ");
  return isGenericRulePattern(pattern) ? null : pattern.toUpperCase();
}

export function deriveCounterpartyKey(description: string) {
  const normalized = normalizeRulePattern(description);
  if (!normalized) return null;

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token))
    .filter((token) => !COUNTERPARTY_NOISE_TOKENS.has(token));

  if (tokens.length === 0) return null;
  if (tokens.length === 1 && tokens[0].length < 4) return null;

  return tokens.slice(0, 4).join(" ");
}

export function getAmountToleranceFloor(currency?: string | null) {
  switch (currency) {
    case "USD":
    case "EUR":
      return 10;
    case "ARS":
      return 5000;
    case "UYU":
    default:
      return 300;
  }
}

export function calculateAmountSimilarity(
  amount: number,
  median: number,
  currency?: string | null,
) {
  const current = Math.abs(Number(amount || 0));
  const historical = Math.abs(Number(median || 0));
  if (!Number.isFinite(current) || !Number.isFinite(historical) || historical <= 0) {
    return 0;
  }

  const delta = Math.abs(current - historical);
  const floor = getAmountToleranceFloor(currency);
  const strongRange = Math.max(historical * 0.12, floor);
  const weakRange = Math.max(historical * 0.25, floor * 2);

  if (delta <= strongRange) {
    return Number(Math.max(0.82, 1 - delta / Math.max(strongRange * 4, 1)).toFixed(3));
  }
  if (delta <= weakRange) {
    const weakScore = 0.74 - ((delta - strongRange) / Math.max(weakRange - strongRange, 1)) * 0.22;
    return Number(Math.max(0.52, weakScore).toFixed(3));
  }

  return 0;
}

export function matchesRulePattern(description: string, pattern: string) {
  const normalizedDescription = normalizeRulePattern(description);
  const normalizedPattern = normalizeRulePattern(pattern);
  return normalizedPattern.length > 0 && !isGenericRulePattern(normalizedPattern) && normalizedDescription.includes(normalizedPattern);
}

export function calculateLearnedRuleConfidence(matchCount: number, baseConfidence = 0.82) {
  const safeMatchCount = Math.max(0, matchCount);
  return Math.min(0.98, Number((baseConfidence + Math.log10(safeMatchCount + 1) * 0.08).toFixed(2)));
}

export function scoreRuleMatch(rule: RuleMatchCandidate, context: RuleMatchingContext) {
  const normalizedPattern = rule.normalized_pattern || normalizeRulePattern(rule.pattern);
  const normalizedDescription = normalizeRulePattern(context.description);
  const mode = rule.mode || "suggest";
  const direction = rule.direction || "any";

  if (mode === "disabled") return Number.NEGATIVE_INFINITY;
  if (!normalizedPattern || isGenericRulePattern(normalizedPattern)) return Number.NEGATIVE_INFINITY;
  if (!normalizedDescription.includes(normalizedPattern)) return Number.NEGATIVE_INFINITY;
  if (rule.account_id && rule.account_id !== (context.accountId || null)) return Number.NEGATIVE_INFINITY;
  if (rule.currency && rule.currency !== (context.currency || null)) return Number.NEGATIVE_INFINITY;
  if (direction !== "any" && direction !== (context.direction || "expense")) return Number.NEGATIVE_INFINITY;

  let score = normalizedPattern.length * 10;
  score += Math.round((rule.confidence ?? 0.72) * 100);
  score += Math.min(30, rule.match_count ?? 0);
  if (mode === "auto") score += 20;
  if (rule.account_id) score += 15;
  if (rule.currency) score += 10;
  if (direction !== "any") score += 6;

  return score;
}

export function selectBestRuleMatch<T extends RuleMatchCandidate>(rules: T[], context: RuleMatchingContext) {
  let best: { rule: T; score: number } | null = null;

  for (const rule of rules) {
    const score = scoreRuleMatch(rule, context);
    if (!Number.isFinite(score)) continue;
    if (!best || score > best.score) {
      best = { rule, score };
    }
  }

  return best?.rule ?? null;
}
