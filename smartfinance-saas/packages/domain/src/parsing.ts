export const DEFAULT_PATTERNS = [
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s+[\d.,]+\s*$`,
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
  String.raw`^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
];

export type ExtractedTransaction = {
  fecha: string;
  desc_banco: string;
  monto: number;
  moneda?: "UYU" | "USD" | "EUR" | "ARS";
};

export type ExtractedPreview = {
  transactions: ExtractedTransaction[];
  unmatched: string[];
  detectedFormat?: string | null;
};

type CsvColumns = {
  fecha: number;
  desc: number;
  monto: number;
  debit: number;
  credit: number;
  currency: number;
};

const SANTANDER_AR_STOP_MARKERS = [
  "mostrar mas movimientos",
  "consultas y operaciones",
  "movimientos en pesos",
  "movimientos en dolares",
  "datos de cuenta",
  "online banking santander",
];

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

  const parts = clean.replace(/[-.]/g, "/").split("/");
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

function normalizeLooseText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCsvDelimiterFromLine(line: string) {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestScore = -1;

  for (const candidate of candidates) {
    let score = 0;
    let inQuotes = false;
    for (const char of line) {
      if (char === "\"") inQuotes = !inQuotes;
      else if (!inQuotes && char === candidate) score += 1;
    }
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
    .replace(/\ufffd/g, "")
    .trim();
}

function getHeaderIndex(headers: string[], aliases: Array<string | RegExp>) {
  return headers.findIndex((header) => {
    const normalized = normalizeHeader(header);
    return aliases.some((alias) => typeof alias === "string" ? normalized === alias : alias.test(normalized));
  });
}

function parseCsvRows(content: string) {
  const lines = String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n");

  let headerLineIndex = -1;
  let delimiter = ",";

  for (let index = 0; index < Math.min(40, lines.length); index += 1) {
    const candidateDelimiter = inferCsvDelimiterFromLine(lines[index] || "");
    const cells = parseCsvLine(lines[index] || "", candidateDelimiter).map(normalizeHeader);
    const hasDate = cells.some((cell) => cell === "fecha" || cell === "date" || /fecha/.test(cell));
    const hasAmount = cells.some((cell) =>
      /monto|importe|amount|valor|debito|dbito|credito|crdito|cargo|abono|haber|debe|withdrawal|deposit|caja de ahorro|cuenta corriente/.test(cell),
    );
    if (hasDate && hasAmount && cells.length >= 3) {
      headerLineIndex = index;
      delimiter = candidateDelimiter;
      break;
    }
  }

  if (headerLineIndex === -1) {
    const firstNonEmpty = lines.find((line) => line.trim()) || "";
    delimiter = inferCsvDelimiterFromLine(firstNonEmpty);
    headerLineIndex = 0;
  }

  const rows = lines
    .slice(headerLineIndex)
    .map((line) => parseCsvLine(line, delimiter))
    .filter((row) => row.some((cell) => String(cell || "").trim()));

  const metadataLines = lines.slice(0, Math.max(headerLineIndex, 0));
  const statementCurrency = inferStatementCurrency(metadataLines);

  return {
    rows,
    delimiter,
    skippedMetadata: headerLineIndex > 0,
    statementCurrency,
  };
}

function normalizeCurrency(value: string) {
  const currency = String(value || "").trim().toUpperCase();
  return ["UYU", "USD", "EUR", "ARS"].includes(currency)
    ? currency as "UYU" | "USD" | "EUR" | "ARS"
    : null;
}

function inferStatementCurrency(metadataLines: string[]) {
  for (const line of metadataLines) {
    const delimiter = inferCsvDelimiterFromLine(line || "");
    const cells = parseCsvLine(line || "", delimiter);
    for (let index = 0; index < cells.length; index += 1) {
      if (normalizeHeader(cells[index]) !== "moneda" && normalizeHeader(cells[index]) !== "currency") {
        continue;
      }
      const nextCurrency = normalizeCurrency(cells[index + 1] || "");
      if (nextCurrency) return nextCurrency;
    }

    const inline = line.match(/\b(?:moneda|currency)\b\s*[,;:\t]\s*(UYU|USD|EUR|ARS)\b/i);
    const inlineCurrency = inline ? normalizeCurrency(inline[1]) : null;
    if (inlineCurrency) return inlineCurrency;
  }

  return null;
}

function detectCsvColumns(headers: string[]): CsvColumns {
  return {
    fecha: getHeaderIndex(headers, ["fecha", "date", /^f\.?\s*valor$/, /^fecha/]),
    desc: getHeaderIndex(headers, [
      "descripcion",
      "description",
      "desc_banco",
      "detalle",
      "concepto",
      /concepto|descripcion|desc|detalle|movimiento|operacion|narration|particulars|text|comercio|establecimiento/,
    ]),
    monto: getHeaderIndex(headers, ["monto", "amount", "importe", "valor", /caja de ahorro|cuenta corriente|^importe$|^monto$|^amount$|^valor$/]),
    debit: getHeaderIndex(headers, ["debito", "dbito", "debe", "cargo", "egreso", "withdrawal", /^debito$|^dbito$|^cargo$|^debe$/]),
    credit: getHeaderIndex(headers, ["credito", "crdito", "haber", "abono", "ingreso", "deposit", /^credito$|^crdito$|^abono$|^haber$/]),
    currency: getHeaderIndex(headers, ["moneda", "currency", "divisa"]),
  };
}

function detectCsvFormat(headers: string[], skippedMetadata: boolean) {
  const normalized = headers.map(normalizeHeader);
  if (normalized.some((header) => /dbito|debito/.test(header)) && normalized.some((header) => /crdito|credito/.test(header))) {
    return skippedMetadata ? "brou_csv_with_metadata" : "brou_csv";
  }
  if (
    normalized.some((header) => /caja de ahorro|cuenta corriente/.test(header))
    && normalized.some((header) => /^saldo$/.test(header))
  ) {
    return "santander_ar_csv";
  }
  if (normalized.some((header) => /comercio|establecimiento/.test(header))) return "card_csv";
  return skippedMetadata ? "generic_csv_with_metadata" : "generic_csv";
}

export function extractTransactionsFromCsv(content: string, period: string): ExtractedPreview {
  const { rows, skippedMetadata, statementCurrency } = parseCsvRows(content);
  if (rows.length === 0) {
    return { transactions: [], unmatched: [], detectedFormat: null };
  }

  const firstRow = rows[0] || [];
  const hasHeader = firstRow.some((cell) =>
    ["fecha", "date", "descripcion", "description", "desc_banco", "monto", "amount", "importe"].includes(normalizeHeader(cell))
      || /fecha|concepto|descripcion|monto|importe|amount|debito|dbito|credito|crdito/.test(normalizeHeader(cell)),
  );
  const headers = hasHeader ? firstRow : [];
  const columns = hasHeader
    ? detectCsvColumns(headers)
    : { fecha: 0, desc: 1, monto: 2, debit: -1, credit: -1, currency: -1 };
  const startIndex = hasHeader ? 1 : 0;
  const detectedFormat = hasHeader ? detectCsvFormat(headers, skippedMetadata) : "generic_csv_no_header";

  const transactions: ExtractedTransaction[] = [];
  const unmatched: string[] = [];

  for (let index = startIndex; index < rows.length; index += 1) {
    const row = rows[index] || [];
    const fecha = parseDateForPeriod(row[columns.fecha] || "", period);
    const desc = columns.desc >= 0 ? String(row[columns.desc] || "").trim() : "";
    let monto: number | null = null;
    if (columns.monto >= 0) {
      const parsed = parseLocalizedAmount(row[columns.monto] || "");
      if (Number.isFinite(parsed)) monto = parsed;
    } else {
      const debit = columns.debit >= 0 ? parseLocalizedAmount(row[columns.debit] || "") : NaN;
      const credit = columns.credit >= 0 ? parseLocalizedAmount(row[columns.credit] || "") : NaN;
      if (Number.isFinite(debit) && debit !== 0) monto = -Math.abs(debit);
      else if (Number.isFinite(credit) && credit !== 0) monto = Math.abs(credit);
    }
    const moneda = normalizeCurrency(columns.currency >= 0 ? row[columns.currency] : "")
      || statementCurrency
      || "UYU";

    if (!fecha || !desc || monto === null || !Number.isFinite(monto)) {
      unmatched.push(row.join(","));
      continue;
    }

    transactions.push({
      fecha,
      desc_banco: desc,
      monto,
      moneda,
    });
  }

  return { transactions, unmatched, detectedFormat };
}

function isSantanderArgentinaStatement(text: string) {
  const normalized = normalizeLooseText(text);
  return (
    normalized.includes("online banking santander")
    || normalized.includes("mostrar mas movimientos")
    || (
      normalized.includes("consultar detalle")
      && /(transferencia inmediata|transferencia realizada|transf recibida|compra con tarjeta de debito|debito debin)/.test(normalized)
    )
  );
}

function isSantanderAmountLine(line: string) {
  return /^\s*[+-]?\s*\$?\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s*$|^\s*[+-]?\s*\$?\s*\d+(?:[.,]\d{2})?\s*$/.test(String(line || ""));
}

function extractSantanderAmount(line: string) {
  const matches = String(line || "").match(/[+-]?\s*\$?\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})?|[+-]?\s*\$?\s*\d+(?:[.,]\d{2})?/g);
  return matches?.[0] || null;
}

function sanitizeSantanderDescription(type: string, descriptionLines: string[]) {
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

function extractSantanderArgentinaTransactions(text: string, period: string): ExtractedPreview {
  const rawLines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: string[] = [];
  for (const line of rawLines) {
    const normalized = normalizeLooseText(line);
    if (!normalized) continue;
    if (SANTANDER_AR_STOP_MARKERS.some((marker) => normalized.includes(marker))) break;
    if (
      normalized === "consultar"
      || normalized === "detalle"
      || normalized === "cuentas"
      || normalized === "resumen de cuenta"
      || normalized === "buscar movimientos"
      || normalized.startsWith("https://")
    ) {
      continue;
    }
    lines.push(line);
  }

  const transactions: ExtractedTransaction[] = [];
  const unmatched: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawDate = lines[index];
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(rawDate)) continue;

    const block: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(lines[cursor])) {
      block.push(lines[cursor]);
      cursor += 1;
    }
    index = cursor - 1;

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
    const fecha = parseDateForPeriod(rawDate, period);
    const amount = amountToken ? parseLocalizedAmount(amountToken) : NaN;
    const descBanco = sanitizeSantanderDescription(movementType, filtered.slice(1, amountIndex));

    if (!fecha || !Number.isFinite(amount) || !descBanco) {
      unmatched.push([rawDate, ...filtered].join(" "));
      continue;
    }

    transactions.push({
      fecha,
      desc_banco: descBanco,
      monto: amount,
      moneda: "UYU",
    });
  }

  return { transactions, unmatched, detectedFormat: "santander_ar_text" };
}

export function extractTransactionsFromText(
  text: string,
  period: string,
  patterns: string[] = DEFAULT_PATTERNS,
): ExtractedPreview {
  if (isSantanderArgentinaStatement(text)) {
    const santander = extractSantanderArgentinaTransactions(text, period);
    if (santander.transactions.length > 0) return santander;
  }

  const activePatterns = patterns
    .map((pattern) => {
      try {
        return new RegExp(pattern);
      } catch {
        return null;
      }
    })
    .filter((regex): regex is RegExp => Boolean(regex));
  const compiledPatterns = activePatterns.length > 0
    ? activePatterns
    : DEFAULT_PATTERNS.map((pattern) => new RegExp(pattern));
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const transactions: ExtractedTransaction[] = [];
  const unmatched: string[] = [];

  for (const line of lines) {
    const match = compiledPatterns
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

  return { transactions, unmatched, detectedFormat: "generic_text" };
}
