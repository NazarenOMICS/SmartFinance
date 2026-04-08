import { describe, expect, it } from "vitest";
import {
  calculateLearnedRuleConfidence,
  deriveRulePattern,
  isGenericRulePattern,
  matchesRulePattern,
  normalizeRulePattern,
  selectBestRuleMatch,
} from "./rules";

describe("rule helpers", () => {
  it("normalizes merchant patterns consistently", () => {
    expect(normalizeRulePattern("  PEDIDOSYA *7732  ")).toBe("pedidosya 7732");
    expect(normalizeRulePattern("Farmácia/Salúd")).toBe("farmacia salud");
  });

  it("derives a stable pattern from noisy bank descriptions", () => {
    expect(deriveRulePattern("PEDIDOSYA *7732 MONTEVIDEO")).toBe("PEDIDOSYA");
    expect(deriveRulePattern("Compra NETFLIX.COM 001")).toBe("NETFLIX");
    expect(deriveRulePattern("1234 5678")).toBeNull();
  });

  it("matches descriptions case-insensitively after normalization", () => {
    expect(matchesRulePattern("Pago PedidosYa 7732", "pedidosya")).toBe(true);
    expect(matchesRulePattern("Transferencia BROU ahorro", "farmashop")).toBe(false);
  });

  it("filters generic patterns and ranks the most specific rule", () => {
    expect(isGenericRulePattern("compra web")).toBe(true);
    const best = selectBestRuleMatch(
      [
        { id: 1, pattern: "PEDIDOSYA", confidence: 0.72, match_count: 3, mode: "suggest" },
        { id: 2, pattern: "PEDIDOSYA MONTEVIDEO", confidence: 0.84, match_count: 8, mode: "auto", account_id: "visa" },
      ],
      { description: "Compra PEDIDOSYA MONTEVIDEO 1234", accountId: "visa", direction: "expense", currency: "UYU" },
    );

    expect(best?.id).toBe(2);
  });

  it("increases learned confidence as confirmations accumulate", () => {
    expect(calculateLearnedRuleConfidence(0)).toBe(0.82);
    expect(calculateLearnedRuleConfidence(5)).toBeGreaterThan(0.82);
  });
});
