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

  it("keeps compound merchants when no known alias exists", () => {
    const merchant = extractMerchant("COMPRA CON TARJETA LIBRERIA CENTRAL 0042");
    expect(merchant.merchant_key).toBe("libreria central");
    expect(merchant.method).toBe("ngram");
  });

  it("recognizes known brands without keeping payment processor noise", () => {
    const merchant = extractMerchant("DLO.UBER.RIDES 88321");
    expect(merchant.merchant_key).toBe("uber");
    expect(merchant.method).toBe("known_brand");
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
    expect(decision.explanation).toContain("Merchant exacto");
  });

  it("keeps safe-first defaults by suggesting medium confidence matches", () => {
    const decision = classifyTransaction(
      { desc_banco: "CAFETERIA INFINITO", monto: -500, moneda: "UYU" },
      [
        { id: 3, pattern: "CAFETERIA INFINITO", normalized_pattern: "cafeteria infinito", merchant_key: "cafeteria infinito", merchant_scope: "cafeteria infinito", category_id: 11, mode: "auto", confidence: 0.8 },
      ],
    );

    expect(decision.categorizationStatus).toBe("suggested");
    expect(decision.categoryId).toBe(11);
  });

  it("keeps UYU import merchants stable for review clustering", () => {
    const cases = [
      ["DLO.UBER.RIDES 2204", "uber"],
      ["COMPRA CON TARJETA DISCO 18", "disco"],
      ["FROG MONTEVIDEO TARJ 44", "frog"],
      ["SUBWAY MONTEVIDEO TARJ", "subway"],
      ["MCDONALD'S 8 DE OCTUBRE", "mcdonalds"],
      ["BURGER KING TRES CRUCES", "burger king"],
      ["CAFETERIA INFINITO", "cafeteria infinito"],
      ["COMPRA CON TARJETA DEBITO IBERPARK TRES CRUCES, MONTEVIDEO TARJ: ############1372", "iberpark"],
      ["COMPRA CON TARJETA DEBITO REST CAFE DEL PUERTO, COLONIA TARJ: ############1372", "cafe del puerto"],
      ["DEBITO OPERACION EN SUPERNET O SMS COT TRPACOT", "cot"],
    ];

    for (const [description, expectedMerchant] of cases) {
      expect(extractMerchant(description).merchant_key).toBe(expectedMerchant);
    }
  });

  it("does not learn noisy transfer and Supernet channel descriptions as merchants", () => {
    const cases = [
      "COMISION TRANSF INSTANTANEA 578741LE NRR:194942182 MARIA DELACROIX",
      "TRANSF INSTANTANEA ENVIADA 578740LE NRR:194942182 MARIA DELACROIX",
      "DEBITO OPERACION EN SUPERNET O SMS 658284TT55104841 TRF. PLAZA- MARIA DELACROIX",
      "CREDITO POR OPERACION EN SUPERNET P--/CABRERA NAZARENO IVAN",
    ];

    for (const description of cases) {
      const merchant = extractMerchant(description);
      expect(merchant.merchant_key).toBeNull();
      expect(merchant.skipped_reason).toBe("channel_or_transfer");
    }
  });

  it("does not autoapply MercadoPago ambiguity without learned rule", () => {
    const decision = classifyTransaction(
      { desc_banco: "MERPAGO.MERCADOLIBRE UY", monto: -1300, moneda: "UYU" },
      [],
    );

    expect(decision.categorizationStatus).toBe("uncategorized");
    expect(decision.merchantKey).toBe("mercadolibre");
  });
});
