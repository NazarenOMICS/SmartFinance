import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_SEEDS, DEFAULT_RULE_SEEDS } from "./bootstrap";

describe("bootstrap categorization seeds", () => {
  it("includes legacy QoL categories needed by automatic review", () => {
    const slugs = new Set(DEFAULT_CATEGORY_SEEDS.map((category) => category.slug));

    expect(slugs.has("transferencia")).toBe(true);
    expect(slugs.has("reintegro")).toBe(true);
    expect(slugs.has("educacion")).toBe(true);
    expect(slugs.has("delivery")).toBe(true);
  });

  it("includes rules for refunds, FX/internal transfers and education hints", () => {
    const patterns = new Set(DEFAULT_RULE_SEEDS.map((rule) => rule.pattern));

    expect(patterns.has("REINTEGRO")).toBe(true);
    expect(patterns.has("COMPRA DOLARES")).toBe(true);
    expect(patterns.has("VENTA DOLARES")).toBe(true);
    expect(patterns.has("UNIVERSIDAD")).toBe(true);
  });
});
