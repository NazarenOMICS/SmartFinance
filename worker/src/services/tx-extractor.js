const DEFAULT_PATTERNS = [
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([\-]?\$?\s?[\d.,]+(?:\.\d{2})?)\s*$`
];

function parseDate(raw, period) {
  const [periodYear] = period.split("-").map(Number);
  const parts = raw.replace(/-/g, "/").split("/");
  const day = Number(parts[0]);
  const month = Number(parts[1]);
  let year = parts[2] ? Number(parts[2]) : periodYear;
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(raw) {
  const cleaned = raw.replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return 0;
  const commaCount = (cleaned.match(/,/g) || []).length;
  const dotCount = (cleaned.match(/\./g) || []).length;
  let normalized = cleaned;
  if (commaCount > 0) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const lastDot = cleaned.lastIndexOf(".");
    if (lastDot > -1 && cleaned.length - lastDot > 3) {
      normalized = cleaned.replace(/\./g, "");
    }
  }
  return Number.parseFloat(normalized);
}

export function extractTransactions(text, patterns, period) {
  const activePatterns = (patterns && patterns.length ? patterns : DEFAULT_PATTERNS).map((p) => new RegExp(p));
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const transactions = [];
  const unmatched = [];

  lines.forEach((line) => {
    const match = activePatterns.map((re) => line.match(re)).find(Boolean);
    if (!match) { unmatched.push(line); return; }
    const [, rawDate, description, rawAmount] = match;
    const amount = parseAmount(rawAmount);
    if (!Number.isFinite(amount)) { unmatched.push(line); return; }
    transactions.push({ fecha: parseDate(rawDate, period), desc_banco: description.trim(), monto: amount });
  });

  return { transactions, unmatched };
}
