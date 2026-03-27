const { DEFAULT_PATTERNS } = require("../db");

function parseDate(raw, period) {
  const [periodYear] = period.split("-").map(Number);
  const date = raw.replace(/-/g, "/").split("/");
  const day = Number(date[0]);
  const month = Number(date[1]);
  let year = date[2] ? Number(date[2]) : periodYear;

  if (year < 100) {
    year += 2000;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseAmount(raw) {
  const cleaned = raw.replace(/[^\d,.-]/g, "").trim();

  if (!cleaned) {
    return 0;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot   = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > -1 && lastDot > -1) {
    // Both separators present — whichever comes last is the decimal separator
    if (lastComma > lastDot) {
      // European format: 1.234,56 → dot=thousands, comma=decimal
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US/BROU format: 1,234.56 → comma=thousands, dot=decimal
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (lastComma > -1) {
    // Only comma — treat as decimal separator (e.g. "1234,56")
    normalized = cleaned.replace(",", ".");
  } else if (lastDot > -1 && cleaned.length - lastDot > 3) {
    // Only dot and more than 3 digits after it → thousands separator, not decimal
    normalized = cleaned.replace(/\./g, "");
  }
  // else: only dot with ≤3 digits after → decimal separator, keep as-is

  return Number.parseFloat(normalized);
}

function extractTransactions(text, patterns, period) {
  const activePatterns = (patterns && patterns.length ? patterns : DEFAULT_PATTERNS).map((pattern) => new RegExp(pattern));
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions = [];
  const unmatched = [];

  lines.forEach((line) => {
    const match = activePatterns
      .map((regex) => line.match(regex))
      .find((result) => Boolean(result));

    if (!match) {
      unmatched.push(line);
      return;
    }

    const [, rawDate, description, rawAmount] = match;
    const amount = parseAmount(rawAmount);

    if (!Number.isFinite(amount)) {
      unmatched.push(line);
      return;
    }

    transactions.push({
      fecha: parseDate(rawDate, period),
      desc_banco: description.trim(),
      monto: amount
    });
  });

  return { transactions, unmatched };
}

module.exports = {
  extractTransactions,
  parseAmount
};

