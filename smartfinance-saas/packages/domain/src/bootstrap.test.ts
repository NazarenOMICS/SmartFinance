import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_SEEDS, DEFAULT_RULE_SEEDS } from "./bootstrap";

describe("bootstrap categorization seeds", () => {
  it("keeps the visible taxonomy intentionally compact", () => {
    const slugs = new Set(DEFAULT_CATEGORY_SEEDS.map((category) => category.slug));

    expect(DEFAULT_CATEGORY_SEEDS.map((category) => category.slug)).toEqual([
      "comida",
      "transporte",
      "servicios",
      "streaming",
      "ocio",
    ]);
    expect(slugs.has("supermercado")).toBe(false);
    expect(slugs.has("restaurantes")).toBe(false);
    expect(slugs.has("delivery")).toBe(false);
    expect(slugs.has("suscripciones")).toBe(false);
    expect(slugs.has("cine")).toBe(false);
  });

  it("maps concrete merchants into broad user-facing categories", () => {
    const byPattern = new Map(DEFAULT_RULE_SEEDS.map((rule) => [rule.pattern, rule.slug]));

    expect(byPattern.get("DISCO")).toBe("comida");
    expect(byPattern.get("PEDIDOSYA")).toBe("comida");
    expect(byPattern.get("UBER")).toBe("transporte");
    expect(byPattern.get("LUZ")).toBe("servicios");
    expect(byPattern.get("NETFLIX")).toBe("streaming");
    expect(byPattern.get("CINE")).toBe("ocio");
  });

  it("keeps seed rules as suggestions until the user teaches personal categories", () => {
    expect(DEFAULT_RULE_SEEDS.every((rule) => rule.mode === "suggest")).toBe(true);
  });
});
