/**
 * Multi-bank CSV format detector.
 *
 * Identifies which bank a CSV file came from by inspecting its headers,
 * then returns the column index mapping so the parser can extract transactions
 * without any hardcoded assumptions about column order.
 *
 * Adding a new bank = adding one entry to KNOWN_FORMATS below.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip diacritics + U+FFFD (from Latin-1→UTF-8 conversion) + lowercase. */
export function normH(h) {
  return (h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é→e, á→a, ó→o …
    .replace(/\ufffd/g, "")          // Latin-1 upload artefact: D?bito → dbito
    .trim();
}

// ─── Bank format library ──────────────────────────────────────────────────────
//
// Each entry:
//   id      — unique slug
//   name    — human-readable label shown in UI
//   detect  — fn(normalizedHeaders[]) → boolean  (is this our bank?)
//   map     — fn(normalizedHeaders[]) → ColumnMap  (which col is what)
//
// ColumnMap: { fecha, desc, debit, credit, monto }  — 0-based indices, -1 = absent

export const KNOWN_FORMATS = [

  // ── Uruguay ─────────────────────────────────────────────────────────────────

  {
    id: "brou_uy",
    name: "BROU Uruguay",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /dbito|debito/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /concepto|descripcion/.test(h)),
      debit:  nh.findIndex(h => /dbito|debito/.test(h)),
      credit: nh.findIndex(h => /crdito|credito/.test(h)),
      monto:  -1,
    }),
  },

  {
    id: "santander_uy",
    name: "Santander Uruguay",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /movimiento|operacion/.test(h)) &&
      !nh.some(h => /dbito|debito/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /movimiento|operacion|descripcion|concepto/.test(h)),
      debit:  nh.findIndex(h => /^debito$|^cargo$|^debe$/.test(h)),
      credit: nh.findIndex(h => /^credito$|^haber$|^abono$/.test(h)),
      monto:  nh.findIndex(h => /^importe$|^monto$|^valor$/.test(h)),
    }),
  },

  {
    id: "itau_uy",
    name: "Itaú Uruguay",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /descripcion|detalle/.test(h)) &&
      nh.some(h => /^importe$|^monto$/.test(h)) &&
      !nh.some(h => /dbito|debito/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /descripcion|detalle|concepto/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /^importe$|^monto$/.test(h)),
    }),
  },

  {
    id: "oca_uy",
    name: "OCA Uruguay",
    detect: (nh) =>
      nh.some(h => /fecha/.test(h)) &&
      nh.some(h => /comercio|establecimiento/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /fecha/.test(h)),
      desc:   nh.findIndex(h => /comercio|establecimiento|descripcion/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /importe|monto|total/.test(h)),
    }),
  },

  {
    id: "bbva_uy",
    name: "BBVA Uruguay",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /concepto/.test(h)) &&
      nh.some(h => /^cargo$|^abono$/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /concepto|descripcion/.test(h)),
      debit:  nh.findIndex(h => /^cargo$/.test(h)),
      credit: nh.findIndex(h => /^abono$/.test(h)),
      monto:  -1,
    }),
  },

  {
    id: "scotiabank_uy",
    name: "Scotiabank Uruguay",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /transaccion|transacci/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /transaccion|descripcion|concepto/.test(h)),
      debit:  nh.findIndex(h => /debito|cargo/.test(h)),
      credit: nh.findIndex(h => /credito|abono/.test(h)),
      monto:  nh.findIndex(h => /monto|importe/.test(h)),
    }),
  },

  // ── Spain ───────────────────────────────────────────────────────────────────

  {
    id: "bbva_es",
    name: "BBVA España",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /^concepto$/.test(h)) &&
      nh.some(h => /^importe$/.test(h)) &&
      nh.some(h => /^saldo$/.test(h)) &&
      !nh.some(h => /dbito|debito/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /^concepto$/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /^importe$/.test(h)),
    }),
  },

  {
    id: "santander_es",
    name: "Santander España",
    detect: (nh) =>
      nh.some(h => /^fecha$/.test(h)) &&
      nh.some(h => /concepto|descripcion/.test(h)) &&
      nh.some(h => /^importe$/.test(h)) &&
      !nh.some(h => /dbito|debito|movimiento/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /^fecha$/.test(h)),
      desc:   nh.findIndex(h => /concepto|descripcion/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /^importe$/.test(h)),
    }),
  },

  {
    id: "caixabank_es",
    name: "CaixaBank",
    detect: (nh) =>
      nh.some(h => /^f\.?\s*valor$|^fecha valor$|^fecha operacion$/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /^fecha/.test(h)),
      desc:   nh.findIndex(h => /concepto|descripcion|movimiento/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /importe|monto/.test(h)),
    }),
  },

  // ── Germany / Austria / Switzerland ─────────────────────────────────────────

  {
    id: "german_de",
    name: "Banca alemana (Deutsche / Sparkasse / DKB)",
    detect: (nh) =>
      nh.some(h => /buchungstag|buchungsdatum|wertstellung/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /buchungstag|buchungsdatum|wertstellung/.test(h)),
      desc:   nh.findIndex(h => /verwendungszweck|begunstigter|beguenstigt|glaubiger|zahlungsempf/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /^betrag$|^umsatz$|betrag\s*eur/.test(h)),
    }),
  },

  // ── USA / International English ──────────────────────────────────────────────

  {
    id: "chase_us",
    name: "Chase Bank (US)",
    detect: (nh) =>
      nh.some(h => /^transaction date$/.test(h)) &&
      nh.some(h => /^description$/.test(h)) &&
      nh.some(h => /^amount$/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /^transaction date$|^post date$/.test(h)),
      desc:   nh.findIndex(h => /^description$/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /^amount$/.test(h)),
    }),
  },

  {
    id: "generic_en",
    name: "Formato genérico (inglés)",
    detect: (nh) =>
      nh.some(h => /^date$|^trans.*date$/.test(h)) &&
      nh.some(h => /^description$|^narration$|^particulars$|^details$/.test(h)) &&
      nh.some(h => /^amount$|^debit$|^credit$|^withdrawal$|^deposit$/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => /^date$|^trans.*date$/.test(h)),
      desc:   nh.findIndex(h => /^description$|^narration$|^particulars$|^details$/.test(h)),
      debit:  nh.findIndex(h => /^debit$|^withdrawal$/.test(h)),
      credit: nh.findIndex(h => /^credit$|^deposit$/.test(h)),
      monto:  nh.findIndex(h => /^amount$/.test(h)),
    }),
  },
];

// ─── Format key ───────────────────────────────────────────────────────────────

/**
 * Compute a stable fingerprint for a CSV's header row.
 * Used as the key when saving/loading custom column mappings.
 * Only uses first 8 columns so minor trailing-column differences don't matter.
 */
export function computeFormatKey(rawHeaders) {
  const normalized = rawHeaders.slice(0, 8).map(normH).filter(Boolean).join("|");
  let hash = 5381;
  for (const ch of normalized) {
    hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ─── Main detector ────────────────────────────────────────────────────────────

/**
 * Auto-detect bank format from CSV headers.
 *
 * Returns:
 *   { id, name, columns: { fecha, desc, debit, credit, monto }, formatKey }
 *   OR null if no format recognized → caller should prompt user to map columns.
 */
export function detectFormat(rawHeaders) {
  const nh  = rawHeaders.map(normH);
  const key = computeFormatKey(rawHeaders);

  // 1. Try known formats
  for (const fmt of KNOWN_FORMATS) {
    if (!fmt.detect(nh)) continue;
    const cols = fmt.map(nh);
    if (cols.fecha >= 0 && (cols.monto >= 0 || cols.debit >= 0 || cols.credit >= 0)) {
      return { id: fmt.id, name: fmt.name, columns: cols, formatKey: key };
    }
  }

  // 2. Generic heuristic fallback (no specific bank detected but pattern matches)
  const fi = nh.findIndex(h => /fecha|date|datum|dato/.test(h));
  const di = nh.findIndex(h => /concepto|descripcion|desc|detalle|text|verwendung|narration|particulars/.test(h));
  const mi = nh.findIndex(h => /monto|importe|amount|betrag|valor/.test(h));
  const bi = nh.findIndex(h => /dbito|debito|cargo|egreso|debe|withdrawal/.test(h));
  const ci = nh.findIndex(h => /crdito|credito|abono|ingreso|haber|deposit/.test(h));

  if (fi >= 0 && (mi >= 0 || bi >= 0 || ci >= 0)) {
    return {
      id: "generic",
      name: "Formato genérico detectado",
      columns: { fecha: fi, desc: di, debit: bi, credit: ci, monto: mi },
      formatKey: key,
    };
  }

  // 3. Completely unknown — no format detected
  return null;
}

/**
 * Apply a column map to a list of CSV rows (strings[]).
 * Returns { transactions: [{fecha,desc_banco,monto}], unmatched: [string] }
 */
export function applyColumnMap(rows, columns, period) {
  const { fecha: fi, desc: di, debit: bi, credit: ci, monto: mi } = columns;
  const transactions = [];
  const unmatched    = [];

  for (const row of rows) {
    if (!row.length) continue;

    // Date
    const rawDate = row[fi] || "";
    const fecha = toISODate(rawDate.trim());
    if (!fecha) { unmatched.push(row.join(",")); continue; }

    // Description
    const desc_banco = di >= 0 ? (row[di] || "").trim() : "";
    if (!desc_banco) { unmatched.push(row.join(",")); continue; }

    // Amount
    let monto = null;
    if (mi >= 0) {
      monto = parseAmt(row[mi]);
    } else {
      if (bi >= 0) { const d = parseAmt(row[bi]); if (d !== null) monto = -Math.abs(d); }
      if (monto === null && ci >= 0) { const c = parseAmt(row[ci]); if (c !== null) monto = Math.abs(c); }
    }
    if (monto === null) { unmatched.push(row.join(",")); continue; }

    transactions.push({ fecha, desc_banco, monto });
  }
  return { transactions, unmatched };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function toISODate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  if (+d < 1 || +d > 31 || +mo < 1 || +mo > 12) return null;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseAmt(s) {
  if (!s || !s.trim()) return null;
  const clean = s.replace(/[^\d,.-]/g, "").trim();
  if (!clean) return null;
  const commaPos = clean.lastIndexOf(",");
  const dotPos   = clean.lastIndexOf(".");
  let normalized;
  if (commaPos > dotPos)       normalized = clean.replace(/\./g, "").replace(",", ".");
  else if (dotPos > commaPos)  normalized = clean.replace(/,/g, "");
  else                         normalized = clean;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}
