/**
 * ColumnMapper — universal CSV column mapping UI.
 *
 * Shows when SmartFinance cannot auto-detect the format of an uploaded CSV.
 * The user assigns roles (Fecha / Descripción / Monto / Débito / Crédito) to
 * each column, sees a live preview of the parsed transactions, and optionally
 * saves the mapping so future uploads from the same bank are automatic.
 *
 * Props:
 *   columns     string[]   — raw header row from the CSV
 *   sample      string[][] — first 5–6 rows (incl. header) for the preview table
 *   formatKey   string     — fingerprint of the header row (for saving)
 *   accountId   string     — account_id to attach transactions to
 *   month       string     — YYYY-MM period
 *   onSuccess   fn({created,duplicates,errors}) — called after successful import
 *   onCancel    fn()       — called when user dismisses the modal
 */

import { useState, useMemo } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";

// ─── Client-side CSV helpers (mirrors server-side logic) ─────────────────────

function splitCSVLine(line) {
  const fields = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) { fields.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  fields.push(cur.trim());
  return fields;
}

function toISO(s) {
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
  let n;
  if (commaPos > dotPos)      n = parseFloat(clean.replace(/\./g, "").replace(",", "."));
  else if (dotPos > commaPos) n = parseFloat(clean.replace(/,/g, ""));
  else                        n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

// ─── Auto-detect column roles from header names ───────────────────────────────

function normH(h) {
  return (h || "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\ufffd/g, "").trim();
}

function autoDetectRoles(headers) {
  const roles = {};
  headers.forEach((h, i) => {
    const n = normH(h);
    if (roles.fecha  === undefined && /fecha|date|datum|dato/.test(n))                                             roles.fecha  = i;
    else if (roles.desc === undefined && /concepto|descripcion|desc|detalle|text|verwendung|narration/.test(n))   roles.desc   = i;
    else if (roles.debit === undefined && /dbito|debito|cargo|egreso|debe|withdrawal/.test(n))                     roles.debit  = i;
    else if (roles.credit === undefined && /crdito|credito|abono|ingreso|haber|deposit/.test(n))                   roles.credit = i;
    else if (roles.monto === undefined && /^monto$|^importe$|^amount$|^betrag$|^valor$/.test(n))                   roles.monto  = i;
  });
  return roles;
}

// ─── Role metadata ────────────────────────────────────────────────────────────

const ROLES = [
  { id: "fecha",  label: "Fecha",       color: "text-finance-teal font-medium" },
  { id: "desc",   label: "Descripción", color: "font-medium text-finance-ink dark:text-neutral-200" },
  { id: "monto",  label: "Monto (±)",   color: "text-finance-purple font-medium" },
  { id: "debit",  label: "Débito (−)",  color: "text-finance-red font-medium" },
  { id: "credit", label: "Crédito (+)", color: "text-finance-teal font-medium" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function ColumnMapper({
  columns,  // string[]   — header row
  sample,   // string[][] — [header, ...data rows]
  formatKey,
  accountId,
  month,
  onSuccess,
  onCancel,
}) {
  const { addToast } = useToast();

  const [roles, setRoles] = useState(() => autoDetectRoles(columns));
  const [remember, setRemember]     = useState(true);
  const [bankName, setBankName]     = useState("");
  const [importing, setImporting]   = useState(false);

  // Data rows (skip the header row that's index 0 in sample)
  const dataRows = sample.slice(1);

  // ── Build preview transactions from current role assignments ────────────────
  const transactions = useMemo(() => {
    return dataRows
      .map(row => {
        const fecha = roles.fecha !== undefined ? toISO(row[roles.fecha]) : null;
        const desc  = roles.desc  !== undefined ? (row[roles.desc] || "").trim() : "";
        if (!fecha || !desc) return null;

        let monto = null;
        if (roles.monto !== undefined) {
          monto = parseAmt(row[roles.monto]);
        } else if (roles.debit !== undefined || roles.credit !== undefined) {
          const d = roles.debit  !== undefined ? parseAmt(row[roles.debit])  : null;
          const c = roles.credit !== undefined ? parseAmt(row[roles.credit]) : null;
          if (d !== null && d !== 0) monto = d;
          else if (c !== null)       monto = Math.abs(c);
        }
        if (monto === null) return null;
        return { fecha, desc_banco: desc, monto };
      })
      .filter(Boolean);
  }, [roles, dataRows]);

  // ── Validation ──────────────────────────────────────────────────────────────
  const hasFecha  = roles.fecha  !== undefined;
  const hasDesc   = roles.desc   !== undefined;
  const hasAmount = roles.monto !== undefined || roles.debit !== undefined || roles.credit !== undefined;
  const canImport = hasFecha && hasDesc && hasAmount && transactions.length > 0;

  // ── Handlers ────────────────────────────────────────────────────────────────

  function assignRole(colIdx, role) {
    const next = { ...roles };
    // Remove existing assignment of this column
    Object.keys(next).forEach(k => { if (next[k] === colIdx) delete next[k]; });
    // Remove existing assignment of this role (each role can only be assigned once)
    if (role !== "ignorar") {
      Object.keys(next).forEach(k => { if (k === role) delete next[k]; });
      next[role] = colIdx;
    }
    setRoles(next);
  }

  function roleOfCol(idx) {
    return Object.entries(roles).find(([, v]) => v === idx)?.[0] ?? "ignorar";
  }

  async function handleImport() {
    if (!canImport) return;
    setImporting(true);
    try {
      // Optionally save the mapping for future uploads
      if (remember) {
        await api.saveBankFormat({
          format_key: formatKey,
          bank_name:  bankName.trim() || null,
          col_fecha:  roles.fecha  ?? -1,
          col_desc:   roles.desc   ?? -1,
          col_debit:  roles.debit  ?? -1,
          col_credit: roles.credit ?? -1,
          col_monto:  roles.monto  ?? -1,
        }).catch(() => {}); // non-fatal: don't block import if save fails
      }

      // Import via batch endpoint
      const txsWithAccount = transactions.map(tx => ({ ...tx, account_id: accountId }));
      const result = await api.batchCreateTransactions({
        transactions: txsWithAccount,
        account_id:   accountId,
        period:       month,
      });

      onSuccess?.(result);
    } catch (e) {
      addToast("error", e.message);
    } finally {
      setImporting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const cellColor = (role) => {
    const r = ROLES.find(x => x.id === role);
    return r ? r.color : "text-neutral-400";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-panel dark:border-white/10 dark:bg-neutral-900">

        {/* Header */}
        <div className="flex items-start justify-between border-b border-neutral-100 px-6 py-5 dark:border-neutral-800">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Formato desconocido</p>
            <h2 className="mt-0.5 font-display text-2xl text-finance-ink dark:text-neutral-100">
              Mapeá las columnas
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              No reconocimos el formato de este banco. Asigná cada columna y SmartFinance lo recordará.
            </p>
          </div>
          <button
            onClick={onCancel}
            className="ml-4 mt-0.5 rounded-full p-2 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800"
            aria-label="Cerrar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Role legend */}
          <div className="flex flex-wrap gap-2">
            {ROLES.map(r => (
              <span key={r.id} className={`inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50 px-3 py-1 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800/60 ${r.color}`}>
                {r.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50 px-3 py-1 text-xs text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/60">
              Ignorar
            </span>
          </div>

          {/* Column mapping table */}
          <div className="overflow-x-auto rounded-2xl border border-neutral-100 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/40">
                  {columns.map((col, i) => (
                    <th key={i} className="px-4 py-2 text-left">
                      <div className="space-y-1.5">
                        <p className={`font-semibold ${cellColor(roleOfCol(i))}`}>{col || `Col ${i + 1}`}</p>
                        <select
                          value={roleOfCol(i)}
                          onChange={e => assignRole(i, e.target.value)}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        >
                          <option value="ignorar">Ignorar</option>
                          <option value="fecha">Fecha</option>
                          <option value="desc">Descripción</option>
                          <option value="monto">Monto (±)</option>
                          <option value="debit">Débito (−)</option>
                          <option value="credit">Crédito (+)</option>
                        </select>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 4).map((row, ri) => (
                  <tr key={ri} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/50">
                    {columns.map((_, ci) => (
                      <td key={ci} className={`px-4 py-2 text-xs ${cellColor(roleOfCol(ci))}`}>
                        {row[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Validation warnings */}
          {!hasFecha && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Asigná la columna <strong>Fecha</strong> para continuar.
            </p>
          )}
          {!hasAmount && hasFecha && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Asigná al menos una columna de monto: <strong>Monto</strong>, <strong>Débito</strong> o <strong>Crédito</strong>.
            </p>
          )}

          {/* Live preview */}
          {transactions.length > 0 && (
            <div className="rounded-2xl bg-finance-tealSoft/50 px-5 py-4 dark:bg-teal-900/20">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-finance-teal dark:text-teal-300">
                Vista previa — {transactions.length} transacciones detectadas
              </p>
              <div className="space-y-1.5">
                {transactions.slice(0, 5).map((tx, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 dark:text-neutral-400">{tx.fecha}</span>
                    <span className="mx-3 flex-1 truncate text-finance-ink dark:text-neutral-200">{tx.desc_banco}</span>
                    <span className={`font-semibold tabular-nums ${tx.monto >= 0 ? "text-finance-teal" : "text-finance-red"}`}>
                      {fmtMoney(tx.monto)}
                    </span>
                  </div>
                ))}
                {transactions.length > 5 && (
                  <p className="text-xs text-neutral-400">…y {transactions.length - 5} más</p>
                )}
              </div>
            </div>
          )}

          {/* Remember format */}
          <div className="rounded-2xl border border-neutral-100 bg-neutral-50 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-800/30">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={e => setRemember(e.target.checked)}
                className="mt-0.5 rounded accent-finance-purple"
              />
              <div>
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-200">
                  Recordar este formato
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  La próxima vez que subas un archivo de este banco, las columnas se detectarán automáticamente.
                </p>
              </div>
            </label>
            {remember && (
              <input
                type="text"
                value={bankName}
                onChange={e => setBankName(e.target.value)}
                placeholder="Nombre del banco (ej: Itaú, Santander…)"
                className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-neutral-100 px-6 py-4 dark:border-neutral-800">
          <button
            onClick={onCancel}
            className="rounded-full border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-finance-ink transition hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancelar
          </button>
          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            className="rounded-full bg-finance-teal px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            {importing
              ? "Importando…"
              : `Importar ${transactions.length} transacciones`}
          </button>
        </div>
      </div>
    </div>
  );
}
