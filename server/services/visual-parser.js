const SUMMARY_KEYWORDS = [
  "grafico", "gráfico", "pie chart", "resumen", "estadistica", "estadística",
  "presupuesto", "categorias", "categorías", "balance", "patrimonio",
];

const PAYMENT_KEYWORDS = [
  "total", "importe", "monto", "pagaste", "pagado", "pago", "compra",
  "transferencia", "enviado", "recibido", "a pagar", "mercado pago",
  "mercadopago", "visa", "mastercard", "debito", "débito", "credito", "crédito",
];

const MERCHANT_STOPWORDS = [
  "total", "importe", "monto", "fecha", "hora", "rut", "cuit", "iva", "telefono",
  "teléfono", "direccion", "dirección", "factura", "boleta", "ticket", "comprobante",
  "mercado pago", "mercadopago", "operacion", "operación", "detalle", "pago",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(raw) {
  const cleaned = String(raw || "").replace(/[^\d,.-]/g, "").trim();
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const comma = cleaned.lastIndexOf(",");
  const dot = cleaned.lastIndexOf(".");
  let normalized = cleaned;
  if (comma > -1 && dot > -1) {
    normalized = comma > dot ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, "");
  } else if (comma > -1) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (dot > -1 && cleaned.length - dot > 3) {
    normalized = cleaned.replace(/\./g, "");
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDate(raw, period) {
  const value = String(raw || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
  if (!match) return null;
  const [, day, month, yearRaw] = match;
  const year = yearRaw ? (yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : String(period || "").slice(0, 4);
  if (!year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function detectCurrency(text, fallback = "UYU") {
  const normalized = normalizeText(text);
  if (/\busd\b|u\$s|us\$/.test(normalized)) return "USD";
  if (/\bars\b|ar\$/.test(normalized)) return "ARS";
  if (/\buyu\b|uyu|\$u/.test(normalized)) return "UYU";
  return fallback || "UYU";
}

function isLikelyNoiseLine(line) {
  const normalized = normalizeText(line);
  if (!normalized || normalized.length < 3) return true;
  if (/^\d+([.,]\d+)?%$/.test(normalized)) return true;
  if (/^\d{1,2}[\/.-]\d{1,2}/.test(normalized)) return true;
  if (MERCHANT_STOPWORDS.some((word) => normalized === word || normalized.startsWith(`${word} `))) return true;
  if (/(rut|cuit|iva|telefono|tel\.|direccion|factura|ticket|comprobante)/.test(normalized)) return true;
  if (/[#$]?\s*\d/.test(normalized) && normalized.length < 16) return true;
  return false;
}

function extractMerchant(lines, sourceKind) {
  if (sourceKind === "mercado_pago") {
    const targetLine = lines.find((line) => /\b(a|para)\s+.+/i.test(line) && !/[#$]\s*\d/.test(line));
    if (targetLine) return targetLine.replace(/^(pago\s+|pagaste\s+)?(a|para)\s+/i, "").trim();
  }
  const useful = lines.find((line) => !isLikelyNoiseLine(line));
  return useful ? useful.slice(0, 80).trim() : "";
}

function extractAmounts(lines) {
  const candidates = [];
  lines.forEach((line, index) => {
    const normalized = normalizeText(line);
    const hasTotalCue = /(total|importe|monto|pagaste|a pagar|enviado|transferido|compra)/.test(normalized);
    const hasNoiseCue = /(rut|cuit|telefono|tel|operacion|operación|codigo|código|cuotas?)/.test(normalized);
    if (/\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?/.test(normalized) && !hasTotalCue) return;
    if (/%/.test(line) && !/(\$|uyu|usd|ars|total|importe|monto)/i.test(line)) return;
    if (hasNoiseCue && !hasTotalCue) return;
    const matches = String(line).match(/(?:US\$|AR\$|\$U|\$|UYU|USD|ARS)?\s*-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|(?:US\$|AR\$|\$U|\$|UYU|USD|ARS)?\s*-?\d+(?:[.,]\d{2})?/gi) || [];
    for (const match of matches) {
      const amount = parseAmount(match);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (amount < 1) continue;
      candidates.push({
        raw: match.trim(),
        amount,
        line,
        index,
        score: (hasTotalCue ? 4 : 0) + (hasNoiseCue ? -2 : 0) + Math.min(2, amount / 10000),
      });
    }
  });
  return candidates.sort((a, b) => b.score - a.score || b.index - a.index);
}

function detectSourceKind(text) {
  const normalized = normalizeText(text);
  if (/mercado\s*pago|mercadopago|mp\s/.test(normalized)) return "mercado_pago";
  if (/transferencia|enviado|recibido|cvu|alias|cbu/.test(normalized)) return "transfer";
  if (/total|rut|iva|ticket|boleta|factura|comprobante/.test(normalized)) return "receipt";
  if (/visa|mastercard|debito|credito|pos\b/.test(normalized)) return "card_payment";
  if (SUMMARY_KEYWORDS.some((word) => normalized.includes(normalizeText(word)))) return "summary_or_chart";
  return "unknown";
}

function classifyVisualImport(ocrResult) {
  const rawText = String(ocrResult?.raw_text || "");
  const normalized = normalizeText(rawText);
  const sourceKind = detectSourceKind(rawText);
  const hasPaymentCue = PAYMENT_KEYWORDS.some((word) => normalized.includes(normalizeText(word)));
  const hasSummaryCue = SUMMARY_KEYWORDS.some((word) => normalized.includes(normalizeText(word)));
  const amountCount = extractAmounts(rawText.split(/\r?\n/)).length;

  if (sourceKind === "summary_or_chart" && !hasPaymentCue) return "visual_summary_or_chart";
  if (hasSummaryCue && amountCount > 2 && !/(pagaste|total|importe|transferencia|compra)/.test(normalized)) {
    return "visual_summary_or_chart";
  }
  if (hasPaymentCue || amountCount > 0) return "visual_single_transaction";
  return "unknown";
}

function extractVisualCandidate(ocrResult, context = {}) {
  const rawText = String(ocrResult?.raw_text || "");
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const importKind = classifyVisualImport(ocrResult);
  const sourceKind = detectSourceKind(rawText);
  const currency = detectCurrency(rawText, context.accountCurrency || context.currency || "UYU");
  const dateLine = lines.find((line) => parseDate(line, context.period));
  const date = dateLine ? parseDate(dateLine, context.period) : null;
  const amounts = extractAmounts(lines);
  const bestAmount = amounts[0] || null;
  const merchantName = extractMerchant(lines, sourceKind);
  const hasMerchant = merchantName.length >= 3;
  const hasDate = Boolean(date);
  const hasTotal = Boolean(bestAmount);
  const confidence = Math.min(0.98,
    (ocrResult?.confidence || 0) * 0.35 +
    (hasMerchant ? 0.22 : 0) +
    (hasDate ? 0.15 : 0.06) +
    (hasTotal ? 0.28 : 0) +
    (sourceKind !== "unknown" ? 0.08 : 0)
  );

  return {
    import_kind: importKind,
    source_kind: sourceKind,
    merchant_name: merchantName,
    date: date || (context.period ? `${context.period}-01` : null),
    date_was_fallback: !hasDate,
    total: bestAmount?.amount ?? null,
    total_raw: bestAmount?.raw || null,
    currency,
    operation_type: sourceKind === "transfer" ? "transfer" : "expense",
    confidence: Number(confidence.toFixed(4)),
    parse_quality: hasMerchant && hasDate && hasTotal ? "clean" : (hasTotal ? "partial" : "failed"),
    amount_candidates: amounts.slice(0, 5),
    raw_text: rawText,
  };
}

function buildTransactionFromVisualCandidate(candidate) {
  if (!candidate || !Number.isFinite(Number(candidate.total)) || !candidate.date) return null;
  const prefix = candidate.source_kind === "mercado_pago" ? "Mercado Pago" : "";
  const desc = [prefix, candidate.merchant_name || candidate.source_kind || "Comprobante"].filter(Boolean).join(" - ");
  return {
    fecha: candidate.date,
    desc_banco: desc.slice(0, 180),
    monto: -Math.abs(Number(candidate.total)),
    moneda: candidate.currency || "UYU",
    parse_quality: candidate.parse_quality || "partial",
  };
}

module.exports = {
  classifyVisualImport,
  extractVisualCandidate,
  buildTransactionFromVisualCandidate,
  parseAmount,
};
