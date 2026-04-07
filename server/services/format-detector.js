/**
 * Multi-bank CSV format detector.
 * CommonJS port of worker/src/services/format-detector.js — keep in sync.
 */

function normH(h) {
  return (h || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\ufffd/g, "")
    .trim();
}

const KNOWN_FORMATS = [
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
    id: "santander_ar",
    name: "Santander Argentina",
    detect: (nh) =>
      nh.some(h => h === "fecha") &&
      nh.some(h => /descripcion/.test(h)) &&
      nh.some(h => /caja de ahorro|cuenta corriente/.test(h)) &&
      nh.some(h => /^saldo$/.test(h)),
    map: (nh) => ({
      fecha:  nh.findIndex(h => h === "fecha"),
      desc:   nh.findIndex(h => /descripcion|detalle|concepto/.test(h)),
      debit:  -1,
      credit: -1,
      monto:  nh.findIndex(h => /caja de ahorro|cuenta corriente|importe|monto|valor/.test(h)),
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

function computeFormatKey(rawHeaders) {
  const normalized = rawHeaders.slice(0, 8).map(normH).filter(Boolean).join("|");
  let hash = 5381;
  for (const ch of normalized) {
    hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function detectFormat(rawHeaders) {
  const nh  = rawHeaders.map(normH);
  const key = computeFormatKey(rawHeaders);

  for (const fmt of KNOWN_FORMATS) {
    if (!fmt.detect(nh)) continue;
    const cols = fmt.map(nh);
    if (cols.fecha >= 0 && (cols.monto >= 0 || cols.debit >= 0 || cols.credit >= 0)) {
      return { id: fmt.id, name: fmt.name, columns: cols, formatKey: key };
    }
  }

  const fi = nh.findIndex(h => /fecha|date|datum|dato/.test(h));
  const di = nh.findIndex(h => /concepto|descripcion|desc|detalle|text|verwendung|narration|particulars/.test(h));
  const mi = nh.findIndex(h => /monto|importe|amount|betrag|valor|caja de ahorro|cuenta corriente/.test(h));
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

  return null;
}

function applyColumnMap(rows, columns, period) {
  const { fecha: fi, desc: di, debit: bi, credit: ci, monto: mi } = columns;
  const transactions = [];
  const unmatched    = [];

  for (const row of rows) {
    if (!row.length) continue;

    const rawDate = row[fi] || "";
    const fecha = toISODate(rawDate.trim());
    if (!fecha) { unmatched.push(row.join(",")); continue; }

    const desc_banco = di >= 0 ? (row[di] || "").trim() : "";
    if (!desc_banco) { unmatched.push(row.join(",")); continue; }

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

function toISODate(s) {
  if (!s) return null;
  const raw = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return isValidISODate(raw) ? raw : null;
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
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

module.exports = { normH, KNOWN_FORMATS, computeFormatKey, detectFormat, applyColumnMap };
