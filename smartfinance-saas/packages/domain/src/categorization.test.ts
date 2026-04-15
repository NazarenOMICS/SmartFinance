import { describe, expect, it } from "vitest";
import {
  buildManualRuleUpsert,
  classifyTransaction,
  deriveRuleIdentity,
  extractMerchant,
  normalizeBankDescription,
} from "./categorization";

describe("categorization pipeline", () => {
  it("strips banking edge noise without deleting merchant signal", () => {
    expect(normalizeBankDescription("COMPRA CON TARJETA PEDIDOSYA *7732").normalized).toBe("pedidosya");
    expect(normalizeBankDescription("COMISION POR TRANSF").normalized).toBe("comision por transf");
  });

  it("extracts merchant by dictionary before heuristics", () => {
    const merchant = extractMerchant("compra uber trip 4812", [
      { merchant_key: "uber", display_name: "Uber", aliases: ["uber trip"] },
    ]);
    expect(merchant.merchant_key).toBe("uber");
    expect(merchant.confidence).toBeGreaterThan(0.9);
  });

  it("rejects pure bank-noise merchant identities", () => {
    const identity = deriveRuleIdentity("COMPRA CON TARJETA", { currency: "UYU", direction: "expense" });
    expect(identity.skipped).toBe(true);
    expect(identity.merchant_key).toBeNull();
  });

  it("manual upsert identity scopes by merchant/account/currency/direction", () => {
    const upsert = buildManualRuleUpsert({
      desc_banco: "COMPRA CON TARJETA PEDIDOSYA *7732",
      monto: -1230,
      moneda: "UYU",
      account_id: "visa_uyu",
    }, 12, "account");

    expect(upsert.skipped).toBe(false);
    expect(upsert.merchant_scope).toBe("pedidosya");
    expect(upsert.account_scope).toBe("visa_uyu");
    expect(upsert.currency_scope).toBe("UYU");
    expect(upsert.direction).toBe("expense");
  });

  it("matches merchant before substring pattern", () => {
    const decision = classifyTransaction(
      { desc_banco: "COMPRA CON TARJETA UBER TRIP", monto: -500, moneda: "UYU", account_id: "visa" },
      [
        { id: 1, pattern: "tarjeta", normalized_pattern: "tarjeta", category_id: 99, mode: "auto", confidence: 0.99 },
        { id: 2, pattern: "UBER", normalized_pattern: "uber", merchant_key: "uber", merchant_scope: "uber", category_id: 7, mode: "auto", confidence: 0.95 },
      ],
      [],
      { categorizer_auto_threshold: 0.85 },
    );

    expect(decision.categoryId).toBe(7);
    expect(decision.layer).toBe("merchant_exact");
    expect(decision.categorizationStatus).toBe("categorized");
  });
});
