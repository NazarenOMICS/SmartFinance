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
  { slug: "comida", name: "Compras Apto", type: "variable", budget: 20000, color: "#534AB7", sortOrder: 10 },
  { slug: "comer_afuera", name: "Comer Afuera", type: "variable", budget: 8000, color: "#378ADD", sortOrder: 20 },
  { slug: "transporte", name: "Transporte", type: "variable", budget: 6000, color: "#1D9E75", sortOrder: 30 },
  { slug: "servicios", name: "Servicios", type: "fixed", budget: 30000, color: "#BA7517", sortOrder: 40 },
  { slug: "streaming", name: "Streaming", type: "fixed", budget: 5000, color: "#D85A30", sortOrder: 50 },
  { slug: "ocio", name: "Ocio", type: "variable", budget: 10000, color: "#639922", sortOrder: 60 },
  { slug: "otros", name: "Otros", type: "variable", budget: 5000, color: "#888780", sortOrder: 70 }
];

const DEFAULT_RULE_SEED_INPUT: SeedRule[] = [
  { pattern: "PEDIDOSYA", slug: "comer_afuera", mode: "suggest", confidence: 0.93 },
  { pattern: "RAPPI", slug: "comer_afuera", mode: "suggest", confidence: 0.9 },
  { pattern: "UBER EATS", slug: "comer_afuera", mode: "suggest", confidence: 0.9 },
  { pattern: "MCDONALDS", slug: "comer_afuera", mode: "suggest", confidence: 0.9 },
  { pattern: "BURGER KING", slug: "comer_afuera", mode: "suggest", confidence: 0.9 },
  { pattern: "SUBWAY", slug: "comer_afuera", mode: "suggest", confidence: 0.88 },
  { pattern: "CAFE", slug: "comer_afuera", mode: "suggest", confidence: 0.76 },
  { pattern: "CAFETERIA", slug: "comer_afuera", mode: "suggest", confidence: 0.8 },
  { pattern: "CAFE DEL PUERTO", slug: "comer_afuera", mode: "suggest", confidence: 0.82 },
  { pattern: "DISCO", slug: "comida", mode: "suggest", confidence: 0.9 },
  { pattern: "DEVOTO", slug: "comida", mode: "suggest", confidence: 0.9 },
  { pattern: "TA TA", slug: "comida", mode: "suggest", confidence: 0.88 },
  { pattern: "FROG", slug: "comida", mode: "suggest", confidence: 0.88 },
  { pattern: "TIENDA INGLESA", slug: "comida", mode: "suggest", confidence: 0.88 },
  { pattern: "GEANT", slug: "comida", mode: "suggest", confidence: 0.86 },
  { pattern: "UBER", slug: "transporte", mode: "suggest", confidence: 0.9 },
  { pattern: "CUTCSA", slug: "transporte", mode: "suggest", confidence: 0.9 },
  { pattern: "CABIFY", slug: "transporte", mode: "suggest", confidence: 0.88 },
  { pattern: "BOLT", slug: "transporte", mode: "suggest", confidence: 0.88 },
  { pattern: "TAXI", slug: "transporte", mode: "suggest", confidence: 0.84 },
  { pattern: "PEAJE", slug: "transporte", mode: "suggest", confidence: 0.84 },
  { pattern: "NETFLIX", slug: "streaming", mode: "suggest", confidence: 0.95 },
  { pattern: "SPOTIFY", slug: "streaming", mode: "suggest", confidence: 0.95 },
  { pattern: "YOUTUBE", slug: "streaming", mode: "suggest", confidence: 0.93 },
  { pattern: "OPENAI", slug: "streaming", mode: "suggest", confidence: 0.93 },
  { pattern: "CHATGPT", slug: "streaming", mode: "suggest", confidence: 0.93 },
  { pattern: "CLAUDE", slug: "streaming", mode: "suggest", confidence: 0.9 },
  { pattern: "UTE", slug: "servicios", mode: "suggest", confidence: 0.87 },
  { pattern: "OSE", slug: "servicios", mode: "suggest", confidence: 0.87 },
  { pattern: "ANTEL", slug: "servicios", mode: "suggest", confidence: 0.88 },
  { pattern: "LUZ", slug: "servicios", mode: "suggest", confidence: 0.82 },
  { pattern: "INTERNET", slug: "servicios", mode: "suggest", confidence: 0.82 },
  { pattern: "GAS", slug: "servicios", mode: "suggest", confidence: 0.8 },
  { pattern: "ALQUILER", slug: "servicios", mode: "suggest", confidence: 0.9 },
  { pattern: "FARMASHOP", slug: "servicios", mode: "suggest", confidence: 0.78 },
  { pattern: "CINE", slug: "ocio", mode: "suggest", confidence: 0.9 },
  { pattern: "MOVIE", slug: "ocio", mode: "suggest", confidence: 0.86 },
  { pattern: "TEATRO", slug: "ocio", mode: "suggest", confidence: 0.86 },
  { pattern: "UNIVERSIDAD", slug: "ocio", mode: "suggest", confidence: 0.72 },
  { pattern: "GYM", slug: "ocio", mode: "suggest", confidence: 0.72 },
];

export const DEFAULT_RULE_SEEDS: Array<SeedRule & { normalized_pattern: string }> = DEFAULT_RULE_SEED_INPUT.map((rule) => ({
  ...rule,
  normalized_pattern: normalizeRulePattern(rule.pattern),
}));
