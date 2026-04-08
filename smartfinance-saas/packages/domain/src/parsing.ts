const DEFAULT_PATTERNS = [
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s+[\d.,]+\s*$`,
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
  String.raw`^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
];

type ExtractedTransaction = {
  fecha: string;
  desc_banco: string;
  monto: number;
  moneda?: "UYU" | "USD" | "EUR" | "ARS";
};

type ExtractedPreview = {
  transactions: ExtractedTransaction[];
  unmatched: string[];
};

function isValidISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseDateForPeriod(raw: string, period: string) {
  if (!raw) return null;
  const clean = String(raw).trim();
  const [periodYear] = period.split("-").map(Number);

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return isValidISODate(clean) ? clean : null;
  }

  const parts = clean.replace(/-/g, "/").split("/");
  if (parts.length < 2) return null;

  const day = Number(parts[0]);
  const month = Number(parts[1]);
  let year = parts[2] ? Number(parts[2]) : periodYear;
  if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
  if (year < 100) year += 2000;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

export function parseLocalizedAmount(raw: string) {
  const cleaned = String(raw || "").replace(/[^\d,.-]/g, "").trim();
  if (!cleaned) return NaN;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma > -1 && lastDot > -1) {
    normalized = lastComma > lastDot
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  } else if (lastComma > -1) {
    normalized = cleaned.replace(",", ".");
  } else if (lastDot > -1 && cleaned.length - lastDot > 3) {
    normalized = cleaned.replace(/\./g, "");
  }

  return Number.parseFloat(normalized);
}

function inferCsvDelimiter(content: string) {
  const sample = content.split(/\r?\n/).find((line) => line.trim()) || "";
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = 0;

  for (const candidate of candidates) {
    const score = sample.split(candidate).length;
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function parseCsvLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeader(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getHeaderIndex(headers: string[], aliases: string[]) {
  return headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
}

export function extractTransactionsFromCsv(content: string, period: string): ExtractedPreview {
  const delimiter = inferCsvDelimiter(content);
  const lines = String(content || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) {
    return { transactions: [], unmatched: [] };
  }

  const firstRow = parseCsvLine(lines[0], delimiter);
  const hasHeader = firstRow.some((cell) =>
    ["fecha", "date", "descripcion", "description", "desc_banco", "monto", "amount"].includes(normalizeHeader(cell)),
  );
  const headers = hasHeader ? firstRow : [];
  const startIndex = hasHeader ? 1 : 0;

  const fechaIndex = hasHeader ? getHeaderIndex(headers, ["fecha", "date"]) : 0;
  const descIndex = hasHeader ? getHeaderIndex(headers, ["descripcion", "description", "desc_banco", "detalle"]) : 1;
  const amountIndex = hasHeader ? getHeaderIndex(headers, ["monto", "amount", "importe"]) : 2;
  const currencyIndex = hasHeader ? getHeaderIndex(headers, ["moneda", "currency"]) : -1;

  const transactions: ExtractedTransaction[] = [];
  const unmatched: string[] = [];

  for (let index = startIndex; index < lines.length; index += 1) {
    const row = parseCsvLine(lines[index], delimiter);
    const fecha = parseDateForPeriod(row[fechaIndex] || "", period);
    const desc = String(row[descIndex] || "").trim();
    const monto = parseLocalizedAmount(row[amountIndex] || "");
    const moneda = (row[currencyIndex] || "UYU").trim().toUpperCase();

    if (!fecha || !desc || !Number.isFinite(monto)) {
      unmatched.push(lines[index]);
      continue;
    }

    transactions.push({
      fecha,
      desc_banco: desc,
      monto,
      moneda: (["UYU", "USD", "EUR", "ARS"].includes(moneda) ? moneda : "UYU") as "UYU" | "USD" | "EUR" | "ARS",
    });
  }

  return { transactions, unmatched };
}

export function extractTransactionsFromText(
  text: string,
  period: string,
  patterns: string[] = DEFAULT_PATTERNS,
): ExtractedPreview {
  const activePatterns = patterns.map((pattern) => new RegExp(pattern));
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions: ExtractedTransaction[] = [];
  const unmatched: string[] = [];

  for (const line of lines) {
    const match = activePatterns
      .map((regex) => line.match(regex))
      .find(Boolean);

    if (!match) {
      unmatched.push(line);
      continue;
    }

    const [, rawDate, description, rawAmount] = match;
    const fecha = parseDateForPeriod(rawDate, period);
    const monto = parseLocalizedAmount(rawAmount);
    if (!fecha || !description || !Number.isFinite(monto)) {
      unmatched.push(line);
      continue;
    }

    transactions.push({
      fecha,
      desc_banco: description.trim(),
      monto,
      moneda: "UYU",
    });
  }

  return { transactions, unmatched };
}
