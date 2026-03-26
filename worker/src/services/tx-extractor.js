// ─── Patterns ─────────────────────────────────────────────────────────────────
//
// Pattern 1 — BROU raw PDF (two numbers at end: amount  running-balance)
//   The LAST number is the running balance and is ignored.
//   The SECOND-TO-LAST is the transaction amount.
//   Example: "24/03/2026 COMISION... -2.02 1.89"
//
// Pattern 2 — BROU column-aware output / generic single-amount
//   Produced by the enhanced extractBROUPdfRows() in the client, or by any
//   bank statement where each line already has exactly one amount.
//   Example: "23/03/2026 COMPRA CON TARJETA DEBITO REST CAFE -4.4"
//
// Pattern 3 — ISO date format (YYYY-MM-DD)
//   Safety net for pre-processed or manually-constructed text.
//   Example: "2026-03-23 Supermercado -1240"
//
// Patterns are tried in order; the first match wins.

const DEFAULT_PATTERNS = [
  // 1. Two trailing numbers: date + description + amount + balance-to-ignore
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s+[\d.,]+\s*$`,
  // 2. Single trailing number: date + description + amount
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
  // 3. ISO date: YYYY-MM-DD + description + amount
  String.raw`^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-]?[\d.,]+)\s*$`,
];

// ─── Date parser ──────────────────────────────────────────────────────────────

/**
 * Parse a raw date string (DD/MM/YYYY, DD-MM-YYYY, or YYYY-MM-DD) into
 * ISO format (YYYY-MM-DD). Uses `period` (YYYY-MM) to fill in the year when
 * the raw string has no year component.
 *
 * Returns null for invalid dates so callers can skip the transaction.
 */
function parseDate(raw, period) {
  if (!raw) return null;
  const clean = raw.trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  const [periodYear] = period.split("-").map(Number);
  const parts = clean.replace(/-/g, "/").split("/");
  if (parts.length < 2) return null;

  const day   = Number(parts[0]);
  const month = Number(parts[1]);
  let   year  = parts[2] ? Number(parts[2]) : periodYear;
  if (year < 100) year += 2000;

  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 2100) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Amount parser ────────────────────────────────────────────────────────────

/**
 * Parse a raw amount string into a signed float.
 *
 * Handles:
 *   BROU/US format  → period as decimal separator:  "1220.00", "-4.40", "4082.20"
 *   European format → comma as decimal separator:   "1.220,00", "-4,40"
 *   No separator    → integer amounts:              "1220", "-200"
 *
 * Heuristic: whichever separator appears LAST is the decimal separator.
 */
function parseAmount(raw) {
  const s = String(raw || "").replace(/[^\d,.-]/g, "").trim();
  if (!s || s === "-") return 0;

  const commaPos = s.lastIndexOf(",");
  const dotPos   = s.lastIndexOf(".");

  let normalized;
  if (commaPos > dotPos) {
    // European: "1.234,56" — comma is the decimal point
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (dotPos > commaPos) {
    // BROU/US: "1,234.56" or "1220.00" — dot is the decimal point
    normalized = s.replace(/,/g, "");
  } else {
    // No separators (integer) or ambiguous
    normalized = s;
  }

  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Extract transactions from plain text (PDF output or text file).
 *
 * @param {string} text      - The raw text to parse (one potential transaction per line).
 * @param {string[]} patterns - Custom regex patterns (overrides DEFAULT_PATTERNS if non-empty).
 * @param {string} period    - YYYY-MM period used to infer the year when absent from date strings.
 *
 * @returns {{ transactions: Array<{fecha,desc_banco,monto}>, unmatched: string[] }}
 */
export function extractTransactions(text, patterns, period) {
  // Compile patterns; skip any invalid regexes and fall back to defaults
  let compiled = [];
  if (patterns && patterns.length) {
    compiled = patterns
      .map(p => { try { return new RegExp(p); } catch (_) { return null; } })
      .filter(Boolean);
  }
  if (!compiled.length) {
    compiled = DEFAULT_PATTERNS.map(p => new RegExp(p));
  }

  const lines        = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const transactions = [];
  const unmatched    = [];

  for (const line of lines) {
    const match = compiled.map(re => line.match(re)).find(Boolean);
    if (!match) { unmatched.push(line); continue; }

    const [, rawDate, description, rawAmount] = match;

    const fecha = parseDate(rawDate, period);
    if (!fecha) { unmatched.push(line); continue; }

    const monto = parseAmount(rawAmount);
    if (!Number.isFinite(monto)) { unmatched.push(line); continue; }

    transactions.push({ fecha, desc_banco: description.trim(), monto });
  }

  return { transactions, unmatched };
}
