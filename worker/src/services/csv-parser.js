/**
 * CSV parser for BROU (Banco República Uruguay) bank statement exports.
 * Also handles generic CSV with Fecha/Monto or Débito/Crédito columns.
 *
 * BROU CSV structure:
 *   Lines 1–5  : metadata (Cliente, Cuenta, Número, Moneda, Sucursal)
 *   Line 6     : blank
 *   Line 7     : "Movimientos,"
 *   Line 8     : date-range row
 *   Line 9     : blank
 *   Line 10    : header → Fecha,Referencia,Concepto,Descripción,Débito,Crédito,Saldos,
 *   Lines 11+  : transaction rows
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** RFC-4180-compatible CSV line splitter (handles quoted fields with commas). */
function splitCSVLine(line) {
  const fields = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; } // escaped ""
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      fields.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

/** Remove diacritics and lowercase (for header comparison).
 * Also strips U+FFFD replacement characters that appear when a Latin-1 file
 * (e.g. BROU CSV) is decoded as UTF-8 — "Débito" → "D\uFFFDbito" → "dbito". */
function normHeader(h) {
  return (h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritics
    .replace(/\ufffd/g, "")          // strip UTF-8 replacement chars (Latin-1 upload)
    .trim();
}

/** Convert DD/MM/YYYY (or YYYY-MM-DD) → YYYY-MM-DD ISO string. */
function toISO(str) {
  if (!str) return null;
  const s = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Parse a money string → number (handles negative sign, ignores currency symbols). */
function toNumber(str) {
  if (!str || str.trim() === "") return null;
  // Remove everything except digits, dot, comma, minus sign
  const cleaned = str.replace(/[^\d.,-]/g, "").trim();
  if (!cleaned) return null;
  // Handle comma-as-thousands-separator (no decimals) vs comma-as-decimal
  // BROU uses period as decimal: "1220.00", "-2.02"
  const n = parseFloat(cleaned.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Parse a CSV (or TSV) bank statement into transactions.
 *
 * Supports:
 *   • BROU-style CSVs with metadata rows + Débito/Crédito split columns
 *   • Generic CSVs with a single amount column
 *
 * Returns { transactions: [{fecha, desc_banco, monto}], unmatched: [string] }
 */
export function parseCSV(text) {
  const lines = text.split(/\r?\n/);

  // ── Step 1: find the header row ──────────────────────────────────────────
  let headerIdx = -1;
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const norm = normHeader(lines[i]);
    // Must contain "fecha" (or "date") AND at least one amount-related word
    const hasFecha  = norm.includes("fecha") || norm === "date" || /\bfec\b/.test(norm);
    const hasAmount = norm.includes("debito") || norm.includes("credito") ||
                      norm.includes("monto")  || norm.includes("importe") ||
                      norm.includes("amount") || norm.includes("cargo")   ||
                      norm.includes("abono");
    if (hasFecha && hasAmount) { headerIdx = i; break; }
  }

  // If still not found, try the first row that has ≥3 fields and a date-like header
  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const fields = splitCSVLine(lines[i]);
      if (fields.length >= 3 && fields.some(f => /^fecha$|^date$/i.test(normHeader(f)))) {
        headerIdx = i; break;
      }
    }
  }

  if (headerIdx === -1) {
    return { transactions: [], unmatched: lines.filter(Boolean) };
  }

  // ── Step 2: map column names → indices ───────────────────────────────────
  const rawHeaders = splitCSVLine(lines[headerIdx]);
  const headers    = rawHeaders.map(normHeader);

  const col = (tests) => headers.findIndex(h => tests.some(t =>
    typeof t === "string" ? h === t : t.test(h)
  ));

  const idxFecha   = col(["fecha", "date", /^f$/]);
  const idxConcept = col([/concepto/, /descripcion/, /desc/, /detalle/, /text/, /glosa/]);
  // /dbito/ and /crdito/ match the garbled form that appears when BROU's Latin-1
  // CSV ("Débito"/"Crédito") is uploaded and decoded as UTF-8: the accented byte
  // becomes U+FFFD which normHeader strips, leaving "dbito" / "crdito".
  const idxDebito  = col([/debito/, /dbito/, /^debe$/, /cargo/, /egreso/]);
  const idxCredito = col([/credito/, /crdito/, /^haber$/, /abono/, /ingreso/]);
  const idxMonto   = col([/^monto$/, /^importe$/, /^amount$/, /^valor$/, /^impt/]);

  if (idxFecha === -1) {
    return { transactions: [], unmatched: lines.filter(Boolean) };
  }

  // ── BROU positional fallback ──────────────────────────────────────────────
  // When BROU CSV is uploaded as Latin-1 and decoded as UTF-8, the normHeader
  // fix above handles it. But as a final safety net: if Fecha is at col 0 and
  // we still have no debit/credit/monto columns AND there are 6+ columns,
  // assume BROU layout (Fecha=0, Ref=1, Concepto=2, Desc=3, Débito=4, Crédito=5, Saldo=6).
  let resolvedDebit  = idxDebito;
  let resolvedCredit = idxCredito;
  let resolvedConcept = idxConcept;
  if (idxFecha === 0 && idxMonto === -1 && idxDebito === -1 && idxCredito === -1 && rawHeaders.length >= 6) {
    resolvedDebit   = 4;
    resolvedCredit  = 5;
    if (idxConcept === -1) resolvedConcept = 2;
  }

  // ── Step 3: parse data rows ───────────────────────────────────────────────
  const transactions = [];
  const unmatched    = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const fields = splitCSVLine(line);

    // Date
    const fecha = toISO(fields[idxFecha]);
    if (!fecha) { unmatched.push(line); continue; }

    // Description — use resolved concept index, fallback to second column
    const descIdx    = resolvedConcept !== -1 ? resolvedConcept : (idxFecha === 0 ? 1 : 0);
    const desc_banco = (fields[descIdx] || "").trim();
    if (!desc_banco) { unmatched.push(line); continue; }

    // Amount
    let monto = null;

    if (idxMonto !== -1) {
      // Single-amount column
      monto = toNumber(fields[idxMonto]);
    } else {
      // BROU-style split: Débito (expenses, already negative) + Crédito (income, positive)
      if (resolvedDebit !== -1) {
        const d = toNumber(fields[resolvedDebit]);
        if (d !== null) monto = d;           // BROU already includes the minus sign
      }
      if (monto === null && resolvedCredit !== -1) {
        const c = toNumber(fields[resolvedCredit]);
        if (c !== null) monto = Math.abs(c); // credits are always positive
      }
    }

    if (monto === null) { unmatched.push(line); continue; }

    transactions.push({ fecha, desc_banco, monto });
  }

  return { transactions, unmatched };
}
