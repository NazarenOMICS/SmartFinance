const { DEFAULT_PATTERNS } = require("../db");

const SANTANDER_AR_STOP_MARKERS = [
  "mostrar mas movimientos",
  "consultas y operaciones",
  "movimientos en pesos",
  "movimientos en dolares",
  "datos de cuenta",
  "online banking santander",
];

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSantanderArgentinaStatement(text) {
  const normalized = normalizeLooseText(text);
  return (
    normalized.includes("online banking santander") ||
    normalized.includes("mostrar mas movimientos") ||
    (
      normalized.includes("consultar detalle") &&
      /(transferencia inmediata|transferencia realizada|transf recibida|compra con tarjeta de debito|debito debin)/.test(normalized)
    )
  );
}

function isSantanderAmountLine(line) {
  return /[+-]?\$?\d/.test(String(line || ""));
}

function extractSantanderAmount(line) {
  const matches = String(line || "").match(/[+-]?\$?\d{1,3}(?:\.\d{3})*(?:,\d{2})?|[+-]?\$?\d+(?:[.,]\d{2})?/g);
  return matches?.[0] || null;
}

function sanitizeSantanderDescription(type, descriptionLines) {
  const normalizedType = normalizeLooseText(type);
  let description = descriptionLines.join(" ").replace(/\s+/g, " ").trim();

  description = description
    .replace(/\s*-\s*tarj nro\.?\s*[\d*#-]+/gi, "")
    .replace(/\btarj\.?\s*nro\.?\s*[\d*#-]+/gi, "")
    .replace(/\s*\/\s*varios\s*-\s*var\s*\/\s*\d+\b/gi, "")
    .replace(/\s*\/\s*\d{8,}\b/g, "")
    .replace(/\bcuit\s*\d+\b/gi, "")
    .replace(/\bid debin\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedType.includes("debito debin")) {
    return "Debito debin";
  }

  if (!description) {
    return String(type || "").trim();
  }

  return `${String(type || "").trim()} ${description}`.replace(/\s+/g, " ").trim();
}

function extractSantanderArgentinaTransactions(text, period) {
  const rawLines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines = [];
  for (const line of rawLines) {
    const normalized = normalizeLooseText(line);
    if (!normalized) continue;
    if (SANTANDER_AR_STOP_MARKERS.some((marker) => normalized.includes(marker))) break;
    if (
      normalized === "consultar" ||
      normalized === "detalle" ||
      normalized === "cuentas" ||
      normalized === "resumen de cuenta" ||
      normalized === "buscar movimientos" ||
      normalized.startsWith("https://")
    ) {
      continue;
    }
    lines.push(line);
  }

  const transactions = [];
  const unmatched = [];

  for (let i = 0; i < lines.length; i++) {
    const rawDate = lines[i];
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(rawDate)) continue;

    const block = [];
    let j = i + 1;
    while (j < lines.length && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(lines[j])) {
      block.push(lines[j]);
      j += 1;
    }
    i = j - 1;

    const filtered = block.filter((line) => {
      const normalized = normalizeLooseText(line);
      return normalized && normalized !== "consultar" && normalized !== "detalle";
    });
    if (filtered.length < 2) {
      unmatched.push([rawDate, ...block].join(" "));
      continue;
    }

    const movementType = filtered[0];
    const amountIndex = filtered.findIndex((line) => isSantanderAmountLine(line));
    if (amountIndex === -1) {
      unmatched.push([rawDate, ...filtered].join(" "));
      continue;
    }

    const amountToken = extractSantanderAmount(filtered[amountIndex]);
    const fecha = parseDate(rawDate, period);
    const amount = amountToken ? parseAmount(amountToken) : NaN;
    const descBanco = sanitizeSantanderDescription(movementType, filtered.slice(1, amountIndex));

    if (!fecha || !Number.isFinite(amount) || !descBanco) {
      unmatched.push([rawDate, ...filtered].join(" "));
      continue;
    }

    transactions.push({
      fecha,
      desc_banco: descBanco,
      monto: amount
    });
  }

  return { transactions, unmatched };
}

function parseDate(raw, period) {
  if (!raw) return null;
  const [periodYear] = period.split("-").map(Number);
  const clean = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return isValidISODate(clean) ? clean : null;
  }
  const date = clean.replace(/-/g, "/").split("/");
  const day = Number(date[0]);
  const month = Number(date[1]);
  let year = date[2] ? Number(date[2]) : periodYear;

  if (year < 100) {
    year += 2000;
  }

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
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
  if (isSantanderArgentinaStatement(text)) {
    const santanderParsed = extractSantanderArgentinaTransactions(text, period);
    if (santanderParsed.transactions.length > 0) {
      return santanderParsed;
    }
  }

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
    const fecha = parseDate(rawDate, period);
    const amount = parseAmount(rawAmount);

    if (!fecha || !Number.isFinite(amount)) {
      unmatched.push(line);
      return;
    }

    transactions.push({
      fecha,
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

function isValidISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

