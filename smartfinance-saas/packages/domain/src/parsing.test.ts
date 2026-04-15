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

  it("extracts BROU-style csv rows with metadata and debit/credit columns", () => {
    const result = extractTransactionsFromCsv(
      [
        "Banco Republica Oriental del Uruguay",
        "Movimientos de cuenta",
        "Fecha;Referencia;Concepto;Debito;Credito;Saldo",
        "05/04/2026;123;DISCO FRESH MARKET;1.250,00;;48.000,00",
        "06/04/2026;124;SUELDO EMPRESA;;50.000,00;98.000,00",
      ].join("\n"),
      "2026-04",
    );

    expect(result.detectedFormat).toBe("brou_csv_with_metadata");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.monto).toBe(-1250);
    expect(result.transactions[1]?.monto).toBe(50000);
  });

  it("inherits statement currency from csv metadata when rows have no currency column", () => {
    const result = extractTransactionsFromCsv(
      [
        "Cliente,Persona Test,",
        "Cuenta,Ca Universitaria Basica,",
        "Moneda,USD,",
        "",
        "Movimientos,",
        "Fecha,Referencia,Concepto,Descripcion,Debito,Credito,Saldos,",
        "26/03/2026,550069,DEBITO OPERACION EN SUPERNET,,800.00,,1.89,",
        "26/03/2026,4115,DEPOSITO POR BUZONERA,,,800.00,801.89,",
      ].join("\n"),
      "2026-03",
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions.every((transaction) => transaction.moneda === "USD")).toBe(true);
    expect(result.transactions[0]?.monto).toBe(-800);
    expect(result.transactions[1]?.monto).toBe(800);
  });

  it("keeps UYU metadata for peso statements", () => {
    const result = extractTransactionsFromCsv(
      [
        "Moneda,UYU,",
        "Fecha,Referencia,Concepto,Descripcion,Debito,Credito,Saldos,",
        "26/03/2026,551460,ORT EDUCUNIVERSIDA,,20215.00,,11613.35,",
      ].join("\n"),
      "2026-03",
    );

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.moneda).toBe("UYU");
    expect(result.transactions[0]?.monto).toBe(-20215);
  });

  it("extracts Santander Argentina block-style text", () => {
    const result = extractTransactionsFromText(
      [
        "Resumen de cuenta",
        "Consultar detalle",
        "05/04/2026",
        "Transferencia inmediata",
        "A TESITORE FERNANDEZ",
        "-$ 2.340,00",
        "06/04/2026",
        "Compra con tarjeta de debito",
        "DISCO 1234 - tarj nro. ****1234",
        "-$ 1.250,00",
      ].join("\n"),
      "2026-04",
    );

    expect(result.detectedFormat).toBe("santander_ar_text");
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]?.desc_banco).toContain("Transferencia inmediata");
    expect(result.transactions[0]?.monto).toBe(-2340);
    expect(result.transactions[1]?.desc_banco).toBe("Compra con tarjeta de debito DISCO 1234");
  });

  it("keeps ambiguous text lines as unmatched", () => {
    const result = extractTransactionsFromText("Saldo anterior 20.000\nLinea sin monto", "2026-04");

    expect(result.transactions).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
  });
});
