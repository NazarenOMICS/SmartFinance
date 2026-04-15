import { useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";

// ─── CSV parsing helpers ──────────────────────────────────────────────────────

/** RFC-4180 CSV line split (handles quoted fields with commas inside). */
function splitCSVLine(line, delim = ",") {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === delim && !inQ) {
      fields.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  return Object.entries(counts).sort((a,b) => b[1]-a[1])[0][0];
}

function normH(h) {
  return (h || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\ufffd/g, "").trim();
}

/**
 * Parse text into rows, automatically skipping BROU/bank metadata lines
 * (any lines before the first row that contains a "Fecha" header).
 * Returns { rows, delim, headerIdx }.
 */
function parseRows(text) {
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n");

  // Find the header row (the one that has "fecha" + at least 2 more fields)
  let headerLineIdx = -1;
  let delim = ",";
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const d = detectDelimiter(lines[i]);
    const fields = splitCSVLine(lines[i], d).map(normH);
    if (fields.some(f => f === "fecha" || f === "date") && fields.length >= 3) {
      headerLineIdx = i;
      delim = d;
      break;
    }
  }

  // Fall back: detect delimiter from the first non-empty line
  if (headerLineIdx === -1) {
    const firstNonEmpty = lines.find(l => l.trim());
    delim = firstNonEmpty ? detectDelimiter(firstNonEmpty) : ",";
  }

  const startIdx = headerLineIdx >= 0 ? headerLineIdx : 0;
  const rows = lines
    .slice(startIdx)
    .map(l => splitCSVLine(l, delim))
    .filter(r => r.some(c => c.length > 0));

  return { rows, delim, skippedMetadata: headerLineIdx > 0 };
}

function parseDate(str) {
  if (!str) return null;
  const raw = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isValidISODate(raw) ? raw : null;
  }
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const iso = `${y.length===2?`20${y}`:y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;
    return isValidISODate(iso) ? iso : null;
  }
  return null;
}

function parseAmount(str) {
  if (!str) return null;
  const clean = str.replace(/[^\d,.-]/g, "").trim();
  if (!clean) return null;
  const commaPos = clean.lastIndexOf(",");
  const dotPos   = clean.lastIndexOf(".");
  let normalized;
  if (commaPos > dotPos)      normalized = clean.replace(/\./g, "").replace(",", ".");  // European: 1.234,56
  else if (dotPos > commaPos) normalized = clean.replace(/,/g, "");                     // US/BROU: 1,234.56
  else                        normalized = clean;                                        // no separator
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
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

function guessColumnRoles(headers) {
  const roles = {};
  headers.forEach((h, i) => {
    const n = normH(h);
    if (roles.fecha === undefined && (n === "fecha" || n === "date" || n === "f")) roles.fecha = i;
    else if (roles.desc === undefined && (n.includes("concepto") || n.includes("descripcion") || n.includes("desc") || n.includes("detalle") || n.includes("text"))) roles.desc = i;
    // BROU split columns: Débito / Crédito
    else if (roles.debit === undefined && (n.includes("debito") || n === "debe" || n.includes("cargo") || n.includes("egreso"))) roles.debit = i;
    else if (roles.credit === undefined && (n.includes("credito") || n === "haber" || n.includes("abono") || n.includes("ingreso"))) roles.credit = i;
    // Generic single amount column
    else if (roles.monto === undefined && (n === "monto" || n === "importe" || n === "amount" || n === "valor")) roles.monto = i;
  });
  return roles;
}

function detectColumnsFromData(rows) {
  const roles = {};
  rows[0].forEach((cell, i) => {
    if (roles.fecha === undefined && parseDate(cell)) roles.fecha = i;
    else if (roles.monto === undefined && parseAmount(cell) !== null) roles.monto = i;
  });
  if (roles.fecha === undefined || roles.monto === undefined) return null;
  const descs = rows[0].map((_,i)=>i).filter(i=>i!==roles.fecha&&i!==roles.monto).sort((a,b)=>rows[0][b].length-rows[0][a].length);
  if (descs.length > 0) roles.desc = descs[0];
  return roles;
}

function derivePendingCount(result) {
  return Number(result?.remaining_transaction_ids?.length || 0);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CsvImportPanel({ selectedAccount, selectedCurrency = "UYU", month, onImported }) {
  const { addToast } = useToast();
  const [text, setText]                 = useState("");
  const [rows, setRows]                 = useState(null);
  const [hasHeader, setHasHeader]       = useState(true);
  const [colRoles, setColRoles]         = useState({});
  const [skippedMeta, setSkippedMeta]   = useState(false);
  const [importing, setImporting]       = useState(false);
  const [step, setStep]                 = useState("paste");
  const [result, setResult]             = useState(null);

  // Roles available for column mapping (debit/credit are BROU-specific)
  const COLS = ["fecha", "desc", "monto", "debit", "credit", "ignorar"];
  const ROLE_LABELS = { fecha: "Fecha", desc: "Descripción", monto: "Monto", debit: "Débito (−)", credit: "Crédito (+)", ignorar: "Ignorar" };

  function handleParse() {
    if (!text.trim()) { addToast("warning", "Pegá datos antes de continuar."); return; }
    const { rows: parsed, skippedMetadata } = parseRows(text);
    if (parsed.length < 2) { addToast("warning", "Necesitás al menos 2 filas."); return; }
    setRows(parsed);
    setSkippedMeta(skippedMetadata);

    const header = parsed[0];
    const guessed = guessColumnRoles(header);
    if (Object.keys(guessed).length >= 2) {
      setColRoles(guessed);
      setHasHeader(true);
    } else {
      const fromData = detectColumnsFromData(parsed);
      if (fromData) { setColRoles(fromData); setHasHeader(false); }
      else { setColRoles({}); setHasHeader(true); }
    }
    setStep("map");
  }

  function dataRows() {
    if (!rows) return [];
    return hasHeader ? rows.slice(1) : rows;
  }

  function headerRow() {
    if (!rows) return [];
    return hasHeader ? rows[0] : rows[0].map((_, i) => `Columna ${i + 1}`);
  }

  function buildTransactions() {
    return dataRows()
      .map((row) => {
        const fecha = colRoles.fecha !== undefined ? parseDate(row[colRoles.fecha]) : null;
        const desc  = colRoles.desc  !== undefined ? row[colRoles.desc] : "";

        let monto = null;
        if (colRoles.monto !== undefined) {
          monto = parseAmount(row[colRoles.monto]);
        } else if (colRoles.debit !== undefined || colRoles.credit !== undefined) {
          // BROU-style split: debit column already has minus sign, credit is positive
          const d = colRoles.debit  !== undefined ? parseAmount(row[colRoles.debit])  : null;
          const c = colRoles.credit !== undefined ? parseAmount(row[colRoles.credit]) : null;
          if (d !== null && d !== 0) monto = -Math.abs(d);
          else if (c !== null && c !== 0) monto = Math.abs(c); // force positive
        }

        if (!fecha || !desc || monto === null) return null;
        return { fecha, desc_banco: desc, monto, moneda: selectedCurrency };
      })
      .filter(Boolean);
  }

  const preview = buildTransactions().slice(0, 5);
  const total   = buildTransactions().length;

  async function handleImport() {
    const txs = buildTransactions();
    if (txs.length === 0) { addToast("warning", "No se pudo parsear ninguna transacción válida."); return; }
    if (!selectedAccount) { addToast("warning", "Primero elegí una cuenta."); return; }
    setImporting(true);
    try {
      const res = await api.batchCreateTransactions({ transactions: txs, account_id: selectedAccount, period: month });
      setResult(res);
      setStep("done");
      if (res.created > 0) {
        addToast("success", `${res.created} transacciones importadas correctamente.`);
        onImported?.(res);
      } else if (res.duplicates > 0) {
        addToast("info", `Todas las transacciones ya existían (${res.duplicates} duplicados).`);
      }
    } catch (e) {
      addToast("error", e.message);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setText(""); setRows(null); setColRoles({}); setSkippedMeta(false); setStep("paste"); setResult(null);
  }

  return (
    <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 2c — Importar desde planilla</p>
      <h2 className="font-display text-3xl text-finance-ink">Pegar CSV / texto</h2>
      <p className="mt-1 text-sm text-neutral-500">Copiá filas de Excel, Google Sheets o cualquier CSV y pegá acá. SmartFinance detecta columnas automáticamente.</p>

      {step === "paste" && (
        <div className="mt-5 space-y-4">
          <textarea
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"fecha\tdescripcion\tmonto\n2026-03-01\tSuperOCA\t-1240\n2026-03-02\tNetflix\t-299"}
            className="w-full rounded-2xl border border-neutral-200 bg-finance-cream/50 px-4 py-3 font-mono text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <button
            onClick={handleParse}
            disabled={!text.trim()}
            className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Analizar datos →
          </button>
        </div>
      )}

      {step === "map" && rows && (
        <div className="mt-5 space-y-4">
          {/* BROU metadata notice */}
          {skippedMeta && (
            <div className="rounded-2xl bg-finance-tealSoft/60 px-4 py-2 text-xs text-finance-teal dark:bg-teal-900/20 dark:text-teal-300">
              Formato BROU detectado — las filas de encabezado del banco fueron salteadas automáticamente.
            </div>
          )}

          {/* Header toggle */}
          <label className="flex items-center gap-2 text-sm text-finance-ink">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} className="rounded" />
            La primera fila es el encabezado
          </label>

          {/* Column mapping */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  {headerRow().map((h, i) => (
                    <th key={i} className="py-2 pr-4 text-left">
                      <div className="space-y-1">
                        <p className="font-semibold text-finance-ink dark:text-neutral-200">{h}</p>
                        <select
                          value={Object.entries(colRoles).find(([, v]) => v === i)?.[0] || "ignorar"}
                          onChange={(e) => {
                            const newRoles = { ...colRoles };
                            // Remove previous assignment of this index
                            Object.keys(newRoles).forEach((k) => { if (newRoles[k] === i) delete newRoles[k]; });
                            if (e.target.value !== "ignorar") newRoles[e.target.value] = i;
                            setColRoles(newRoles);
                          }}
                          className="rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        >
                          <option value="ignorar">Ignorar</option>
                          <option value="fecha">Fecha</option>
                          <option value="desc">Descripción</option>
                          <option value="monto">Monto</option>
                          <option value="debit">Débito (−)</option>
                          <option value="credit">Crédito (+)</option>
                        </select>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows().slice(0, 4).map((row, ri) => (
                  <tr key={ri} className="border-b border-neutral-50 dark:border-neutral-800/50">
                    {row.map((cell, ci) => {
                      const role = Object.entries(colRoles).find(([, v]) => v === ci)?.[0];
                      return (
                        <td key={ci} className={`py-2 pr-4 text-xs ${role === "fecha" ? "text-finance-teal font-medium" : (role === "monto" || role === "debit" || role === "credit") ? "text-finance-red font-medium" : role === "desc" ? "font-medium text-finance-ink dark:text-neutral-200" : "text-neutral-400"}`}>
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Preview */}
          {preview.length > 0 && (
            <div className="rounded-2xl bg-finance-tealSoft/50 px-4 py-3 dark:bg-teal-900/20">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-finance-teal">Vista previa ({total} transacciones)</p>
              {preview.map((tx, i) => (
                <div key={i} className="flex justify-between text-xs text-finance-ink dark:text-neutral-200">
                  <span>{tx.fecha} · {tx.desc_banco.slice(0, 30)}</span>
                  <span className={tx.monto > 0 ? "text-finance-teal font-semibold" : "text-finance-red font-semibold"}>
                      {fmtMoney(tx.monto, tx.moneda)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={handleImport} disabled={importing || preview.length === 0 || !selectedAccount} className="rounded-full bg-finance-teal px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
              {importing ? "Importando…" : `Importar ${total} transacciones`}
            </button>
            <button onClick={reset} className="rounded-full border border-neutral-200 px-5 py-3 text-sm font-semibold text-finance-ink transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
              Empezar de nuevo
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="mt-5 space-y-3">
          <div className="rounded-2xl bg-finance-tealSoft px-5 py-4 dark:bg-teal-900/30">
            <p className="font-semibold text-finance-teal dark:text-teal-300">✓ Importación completada</p>
            <div className="mt-2 text-sm text-finance-ink dark:text-neutral-200 space-y-1">
              <p>Nuevas: <strong>{result.created}</strong></p>
              <p>Duplicados salteados: {result.duplicates}</p>
              <p>Auto-resueltas: {Math.max(Number(result.created || 0) - derivePendingCount(result), 0)}</p>
              <p>Pendientes de revisar: {derivePendingCount(result)}</p>
              {result.errors > 0 && <p className="text-finance-red">Errores: {result.errors}</p>}
            </div>
          </div>
          <button onClick={reset} className="rounded-full border border-neutral-200 px-5 py-2 text-sm font-semibold text-finance-ink transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300">
            Importar más datos
          </button>
        </div>
      )}
    </div>
  );
}
