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
  "web",
  "app",
]);

const GENERIC_PATTERN_TOKENS = new Set([
  "con",
  "tarjeta",
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

  while (tokens.length > 0 && GENERIC_PREFIXES.has(tokens[0])) {
    tokens.shift();
  }

  if (tokens.length === 0) return null;
  if (tokens[0].length >= 4 || tokens.length === 1) {
    return tokens[0].toUpperCase();
  }

  return tokens.slice(0, 2).join(" ").toUpperCase();
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
