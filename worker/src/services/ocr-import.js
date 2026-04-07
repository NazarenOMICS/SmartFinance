function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${path}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fallbackDate(period = "") {
  return /^\d{4}-\d{2}$/.test(String(period || "")) ? `${period}-01` : null;
}

function parseImageDate(value, period) {
  const raw = String(value || "").trim();
  if (!raw) return fallbackDate(period);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);
  if (!match) return fallbackDate(period);
  const [, day, month, yearRaw] = match;
  const year = yearRaw ? (yearRaw.length === 2 ? `20${yearRaw}` : yearRaw) : String(period || "").slice(0, 4);
  if (!year || !month || !day) return fallbackDate(period);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseImageAmount(value) {
  const raw = String(value || "").replace(/[^\d,.-]/g, "").trim();
  if (!raw) return null;
  const commaPos = raw.lastIndexOf(",");
  const dotPos = raw.lastIndexOf(".");
  let normalized = raw;
  if (commaPos > dotPos) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (dotPos > commaPos) normalized = raw.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function extractTransactionsFromOcrWithOllama(settings, payload) {
  const enabled = String(settings.categorizer_ollama_enabled || "0") === "1";
  const baseUrl = String(settings.categorizer_ollama_url || "").trim();
  const model = String(settings.categorizer_ollama_model || "").trim();

  if (!enabled || !baseUrl || !model) {
    return { transactions: [], reason: "ollama_disabled" };
  }

  const prompt = [
    "Extrae movimientos financieros estructurados desde OCR de capturas, tickets o pantallas de e-commerce.",
    "Devuelve SOLO JSON con la forma: {\"transactions\":[{\"fecha\":\"YYYY-MM-DD\",\"desc_banco\":\"...\",\"monto\":-123.45,\"moneda\":\"ARS\"}],\"reason\":\"...\"}.",
    "Usa monto negativo para gastos y positivo para ingresos.",
    "Si no hay fecha exacta pero el periodo es conocido, usa el primer dia del periodo.",
    "Si el texto no representa un movimiento financiero claro, devuelve transactions vacio.",
    `Periodo de referencia: ${payload.period || "desconocido"}`,
    `Moneda esperada de la cuenta: ${payload.moneda || "UYU"}`,
    "Texto OCR:",
    String(payload.text || "").slice(0, 8000),
  ].join("\n");

  try {
    const response = await fetch(joinUrl(baseUrl, "/api/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
      }),
    });
    if (!response.ok) return { transactions: [], reason: "ollama_http_error" };
    const data = await response.json();
    const parsed = safeJsonParse(data?.response || "");
    const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : [];
    return {
      transactions: transactions
        .map((tx) => ({
          fecha: parseImageDate(tx?.fecha, payload.period),
          desc_banco: String(tx?.desc_banco || "").trim(),
          monto: parseImageAmount(tx?.monto),
          moneda: String(tx?.moneda || payload.moneda || "UYU").toUpperCase(),
        }))
        .filter((tx) => tx.fecha && tx.desc_banco && Number.isFinite(tx.monto)),
      reason: parsed?.reason ? String(parsed.reason) : "",
    };
  } catch {
    return { transactions: [], reason: "ollama_error" };
  }
}
