import { describe, expect, it } from "vitest";
import { extractTransactionsFromCsv, extractTransactionsFromText, parseLocalizedAmount } from "./parsing";

describe("parsing helpers", () => {
  it("parses localized amounts with comma and dot separators", () => {
    expect(parseLocalizedAmount("$1.234,56")).toBe(1234.56);
    expect(parseLocalizedAmount("1,234.56")).toBe(1234.56);
    expect(parseLocalizedAmount("-890")).toBe(-890);
  });

  it("extracts transactions from csv content", () => {
    const result = extractTransactionsFromCsv(
      "fecha,descripcion,monto,moneda\n2026-04-05,PEDIDOSYA,-890,UYU\n2026-04-06,NETFLIX,-429,UYU",
      "2026-04",
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.desc_banco).toBe("PEDIDOSYA");
    expect(result.unmatched).toHaveLength(0);
  });

  it("extracts transactions from free text using regex patterns", () => {
    const result = extractTransactionsFromText(
      "05/04 PEDIDOSYA MONTEVIDEO -890\n06/04 NETFLIX -429",
      "2026-04",
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[1]?.fecha).toBe("2026-04-06");
  });
});
