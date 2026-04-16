import { normalizeRulePattern } from "./rules";

export type SeedCategory = {
  slug: string;
  name: string;
  type: "fixed" | "variable";
  budget: number;
  color: string;
  sortOrder: number;
};

export type SeedRule = {
  pattern: string;
  slug: string;
  mode: "auto" | "suggest";
  confidence: number;
  direction?: "any" | "expense" | "income";
};

export const DEFAULT_CATEGORY_SEEDS: SeedCategory[] = [
  { slug: "comida", name: "Comida", type: "variable", budget: 20000, color: "#534AB7", sortOrder: 10 },
  { slug: "transporte", name: "Transporte", type: "variable", budget: 6000, color: "#1D9E75", sortOrder: 20 },
  { slug: "servicios", name: "Servicios", type: "fixed", budget: 30000, color: "#BA7517", sortOrder: 30 },
  { slug: "streaming", name: "Streaming", type: "fixed", budget: 5000, color: "#D85A30", sortOrder: 40 },
  { slug: "ocio", name: "Ocio", type: "variable", budget: 10000, color: "#378ADD", sortOrder: 50 }
];

const DEFAULT_RULE_SEED_INPUT: SeedRule[] = [
  { pattern: "PEDIDOSYA", slug: "comida", mode: "auto", confidence: 0.93 },
  { pattern: "RAPPI", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "UBER EATS", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "MCDONALD", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "BURGER KING", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "SUBWAY", slug: "comida", mode: "auto", confidence: 0.88 },
  { pattern: "CAFE", slug: "comida", mode: "suggest", confidence: 0.76 },
  { pattern: "DISCO", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "DEVOTO", slug: "comida", mode: "auto", confidence: 0.9 },
  { pattern: "TA TA", slug: "comida", mode: "auto", confidence: 0.88 },
  { pattern: "FROG", slug: "comida", mode: "auto", confidence: 0.88 },
  { pattern: "UBER", slug: "transporte", mode: "auto", confidence: 0.9 },
  { pattern: "CUTCSA", slug: "transporte", mode: "auto", confidence: 0.9 },
  { pattern: "CABIFY", slug: "transporte", mode: "auto", confidence: 0.88 },
  { pattern: "BOLT", slug: "transporte", mode: "auto", confidence: 0.88 },
  { pattern: "TAXI", slug: "transporte", mode: "auto", confidence: 0.84 },
  { pattern: "PEAJE", slug: "transporte", mode: "auto", confidence: 0.84 },
  { pattern: "NETFLIX", slug: "streaming", mode: "auto", confidence: 0.95 },
  { pattern: "SPOTIFY", slug: "streaming", mode: "auto", confidence: 0.95 },
  { pattern: "YOUTUBE", slug: "streaming", mode: "auto", confidence: 0.93 },
  { pattern: "OPENAI", slug: "streaming", mode: "auto", confidence: 0.93 },
  { pattern: "CHATGPT", slug: "streaming", mode: "auto", confidence: 0.93 },
  { pattern: "CLAUDE", slug: "streaming", mode: "auto", confidence: 0.9 },
  { pattern: "UTE", slug: "servicios", mode: "auto", confidence: 0.87 },
  { pattern: "OSE", slug: "servicios", mode: "auto", confidence: 0.87 },
  { pattern: "ANTEL", slug: "servicios", mode: "auto", confidence: 0.88 },
  { pattern: "LUZ", slug: "servicios", mode: "suggest", confidence: 0.82 },
  { pattern: "INTERNET", slug: "servicios", mode: "suggest", confidence: 0.82 },
  { pattern: "GAS", slug: "servicios", mode: "suggest", confidence: 0.8 },
  { pattern: "ALQUILER", slug: "servicios", mode: "auto", confidence: 0.9 },
  { pattern: "FARMASHOP", slug: "servicios", mode: "suggest", confidence: 0.78 },
  { pattern: "CINE", slug: "ocio", mode: "auto", confidence: 0.9 },
  { pattern: "MOVIE", slug: "ocio", mode: "auto", confidence: 0.86 },
  { pattern: "TEATRO", slug: "ocio", mode: "auto", confidence: 0.86 },
  { pattern: "UNIVERSIDAD", slug: "ocio", mode: "suggest", confidence: 0.72 },
  { pattern: "GYM", slug: "ocio", mode: "suggest", confidence: 0.72 },
];

export const DEFAULT_RULE_SEEDS: Array<SeedRule & { normalized_pattern: string }> = DEFAULT_RULE_SEED_INPUT.map((rule) => ({
  ...rule,
  normalized_pattern: normalizeRulePattern(rule.pattern),
}));
