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
  { slug: "alquiler", name: "Alquiler", type: "fixed", budget: 18000, color: "#639922", sortOrder: 10 },
  { slug: "supermercado", name: "Supermercado", type: "variable", budget: 12000, color: "#534AB7", sortOrder: 20 },
  { slug: "transporte", name: "Transporte", type: "variable", budget: 6000, color: "#1D9E75", sortOrder: 30 },
  { slug: "suscripciones", name: "Suscripciones", type: "fixed", budget: 5000, color: "#D85A30", sortOrder: 40 },
  { slug: "restaurantes", name: "Restaurantes", type: "variable", budget: 8000, color: "#378ADD", sortOrder: 50 },
  { slug: "servicios", name: "Servicios", type: "fixed", budget: 7000, color: "#BA7517", sortOrder: 60 },
  { slug: "salud", name: "Salud", type: "variable", budget: 4000, color: "#E24B4A", sortOrder: 70 },
  { slug: "educacion", name: "Educacion", type: "variable", budget: 0, color: "#378ADD", sortOrder: 75 },
  { slug: "delivery", name: "Delivery", type: "variable", budget: 0, color: "#D85A30", sortOrder: 76 },
  { slug: "otros", name: "Otros", type: "variable", budget: 5000, color: "#888780", sortOrder: 80 },
  { slug: "transferencia", name: "Transferencia", type: "variable", budget: 0, color: "#888780", sortOrder: 88 },
  { slug: "reintegro", name: "Reintegro", type: "variable", budget: 0, color: "#1D9E75", sortOrder: 89 },
  { slug: "ingreso", name: "Ingreso", type: "fixed", budget: 0, color: "#639922", sortOrder: 90 }
];

const DEFAULT_RULE_SEED_INPUT: SeedRule[] = [
  { pattern: "DEVOLUCION", slug: "ingreso", mode: "suggest", confidence: 0.74 },
  { pattern: "REINTEGRO", slug: "reintegro", mode: "suggest", confidence: 0.82 },
  { pattern: "PEDIDOSYA", slug: "restaurantes", mode: "auto", confidence: 0.93 },
  { pattern: "RAPPI", slug: "delivery", mode: "auto", confidence: 0.9 },
  { pattern: "UBER", slug: "transporte", mode: "auto", confidence: 0.9 },
  { pattern: "CUTCSA", slug: "transporte", mode: "auto", confidence: 0.9 },
  { pattern: "DISCO", slug: "supermercado", mode: "auto", confidence: 0.9 },
  { pattern: "DEVOTO", slug: "supermercado", mode: "auto", confidence: 0.9 },
  { pattern: "TA TA", slug: "supermercado", mode: "auto", confidence: 0.88 },
  { pattern: "NETFLIX", slug: "suscripciones", mode: "auto", confidence: 0.95 },
  { pattern: "SPOTIFY", slug: "suscripciones", mode: "auto", confidence: 0.95 },
  { pattern: "UTE", slug: "servicios", mode: "auto", confidence: 0.87 },
  { pattern: "OSE", slug: "servicios", mode: "auto", confidence: 0.87 },
  { pattern: "ANTEL", slug: "servicios", mode: "auto", confidence: 0.88 },
  { pattern: "FARMASHOP", slug: "salud", mode: "suggest", confidence: 0.8 },
  { pattern: "EMERGENCIA", slug: "salud", mode: "suggest", confidence: 0.78 },
  { pattern: "TRANSFERENCIA INTERNA", slug: "transferencia", mode: "suggest", confidence: 0.84 },
  { pattern: "COMPRA DOLARES", slug: "transferencia", mode: "suggest", confidence: 0.84 },
  { pattern: "VENTA DOLARES", slug: "transferencia", mode: "suggest", confidence: 0.84 },
  { pattern: "UNIVERSIDAD", slug: "educacion", mode: "suggest", confidence: 0.84 },
];

export const DEFAULT_RULE_SEEDS: Array<SeedRule & { normalized_pattern: string }> = DEFAULT_RULE_SEED_INPUT.map((rule) => ({
  ...rule,
  normalized_pattern: normalizeRulePattern(rule.pattern),
}));
