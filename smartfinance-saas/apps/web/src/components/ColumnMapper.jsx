import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";

function toISO(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return isValidISODate(raw) ? raw : null;
  }
  const match = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (!match) return null;

  const [, day, month, yearValue] = match;
  const year = yearValue.length === 2 ? `20${yearValue}` : yearValue;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidISODate(iso) ? iso : null;
}

function parseAmount(value) {
  if (!value || !String(value).trim()) return null;
  const clean = String(value).replace(/[^\d,.-]/g, "").trim();
  if (!clean) return null;

  const commaPos = clean.lastIndexOf(",");
  const dotPos = clean.lastIndexOf(".");
  let parsed;
  if (commaPos > dotPos) parsed = Number.parseFloat(clean.replace(/\./g, "").replace(",", "."));
  else if (dotPos > commaPos) parsed = Number.parseFloat(clean.replace(/,/g, ""));
  else parsed = Number.parseFloat(clean);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\ufffd/g, "")
    .trim();
}

function autoDetectRoles(headers) {
  const roles = {};
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (roles.fecha === undefined && /fecha|date|datum|dato/.test(normalized)) roles.fecha = index;
    else if (roles.desc === undefined && /concepto|descripcion|desc|detalle|text|verwendung|narration/.test(normalized)) roles.desc = index;
    else if (roles.debit === undefined && /dbito|debito|cargo|egreso|debe|withdrawal/.test(normalized)) roles.debit = index;
    else if (roles.credit === undefined && /crdito|credito|abono|ingreso|haber|deposit/.test(normalized)) roles.credit = index;
    else if (
      roles.monto === undefined &&
      (/^monto$|^importe$|^amount$|^betrag$|^valor$/.test(normalized) || /caja de ahorro|cuenta corriente/.test(normalized))
    ) {
      roles.monto = index;
    }
  });
  return roles;
}

const ROLES = [
  { id: "fecha", label: "Fecha", color: "text-finance-teal font-medium" },
  { id: "desc", label: "Descripcion", color: "font-medium text-finance-ink dark:text-neutral-200" },
  { id: "monto", label: "Monto (+/-)", color: "text-finance-purple font-medium" },
  { id: "debit", label: "Debito (-)", color: "text-finance-red font-medium" },
  { id: "credit", label: "Credito (+)", color: "text-finance-teal font-medium" },
];

function rolesFromSuggestion(suggestion) {
  const next = {};
  if (Number.isInteger(suggestion?.col_fecha) && suggestion.col_fecha >= 0) next.fecha = suggestion.col_fecha;
  if (Number.isInteger(suggestion?.col_desc) && suggestion.col_desc >= 0) next.desc = suggestion.col_desc;
  if (Number.isInteger(suggestion?.col_debit) && suggestion.col_debit >= 0) next.debit = suggestion.col_debit;
  if (Number.isInteger(suggestion?.col_credit) && suggestion.col_credit >= 0) next.credit = suggestion.col_credit;
  if (Number.isInteger(suggestion?.col_monto) && suggestion.col_monto >= 0) next.monto = suggestion.col_monto;
  return next;
}

export default function ColumnMapper({
  columns,
  sample,
  formatKey,
  accountId,
  accountCurrency = "UYU",
  month,
  onSuccess,
  onCancel,
}) {
  const { addToast } = useToast();
  const [roles, setRoles] = useState(() => autoDetectRoles(columns));
  const [remember, setRemember] = useState(true);
  const [bankName, setBankName] = useState("");
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMeta, setSuggestionMeta] = useState(null);
  const [userEdited, setUserEdited] = useState(false);

  const dataRows = sample.slice(1);

  const transactions = useMemo(() => (
    dataRows
      .map((row) => {
        const fecha = roles.fecha !== undefined ? toISO(row[roles.fecha]) : null;
        const desc = roles.desc !== undefined ? String(row[roles.desc] || "").trim() : "";
        if (!fecha || !desc) return null;

        let monto = null;
        if (roles.monto !== undefined) {
          monto = parseAmount(row[roles.monto]);
        } else if (roles.debit !== undefined || roles.credit !== undefined) {
          const debit = roles.debit !== undefined ? parseAmount(row[roles.debit]) : null;
          const credit = roles.credit !== undefined ? parseAmount(row[roles.credit]) : null;
          if (debit !== null && debit !== 0) monto = -Math.abs(debit);
          else if (credit !== null) monto = Math.abs(credit);
        }

        if (monto === null) return null;
        return { fecha, desc_banco: desc, monto, moneda: accountCurrency };
      })
      .filter(Boolean)
  ), [accountCurrency, dataRows, roles]);

  const hasFecha = roles.fecha !== undefined;
  const hasDesc = roles.desc !== undefined;
  const hasAmount = roles.monto !== undefined || roles.debit !== undefined || roles.credit !== undefined;
  const canImport = hasFecha && hasDesc && hasAmount && transactions.length > 0;

  useEffect(() => {
    let cancelled = false;

    async function loadSuggestion() {
      if (!columns?.length) return;
      setSuggesting(true);
      try {
        const suggestion = await api.suggestBankFormat({
          format_key: formatKey,
          columns,
          sample_rows: sample,
          account_currency: accountCurrency,
        });
        if (cancelled) return;

        const nextRoles = rolesFromSuggestion(suggestion);
        if (!userEdited && Object.keys(nextRoles).length > 0) {
          setRoles((current) => {
            const currentCount = Object.keys(current || {}).length;
            return Object.keys(nextRoles).length >= currentCount ? nextRoles : current;
          });
        }
        if (!bankName && suggestion?.bank_name) {
          setBankName(suggestion.bank_name);
        }
        setSuggestionMeta(suggestion);
      } catch {
        if (!cancelled) setSuggestionMeta(null);
      } finally {
        if (!cancelled) setSuggesting(false);
      }
    }

    loadSuggestion();
    return () => {
      cancelled = true;
    };
  }, [accountCurrency, columns, formatKey, sample, userEdited]);

  function assignRole(colIdx, role) {
    setUserEdited(true);
    const next = { ...roles };
    Object.keys(next).forEach((key) => {
      if (next[key] === colIdx) delete next[key];
    });
    if (role !== "ignorar") {
      Object.keys(next).forEach((key) => {
        if (key === role) delete next[key];
      });
      next[role] = colIdx;
    }
    setRoles(next);
  }

  function roleOfCol(idx) {
    return Object.entries(roles).find(([, value]) => value === idx)?.[0] ?? "ignorar";
  }

  async function handleImport() {
    if (!canImport) return;
    setImporting(true);
    try {
      if (remember) {
        await api.saveBankFormat({
          format_key: formatKey,
          bank_name: bankName.trim() || null,
          col_fecha: roles.fecha ?? -1,
          col_desc: roles.desc ?? -1,
          col_debit: roles.debit ?? -1,
          col_credit: roles.credit ?? -1,
          col_monto: roles.monto ?? -1,
        }).catch(() => {});
      }

      const txsWithAccount = transactions.map((tx) => ({ ...tx, account_id: accountId }));
      const result = await api.batchCreateTransactions({
        transactions: txsWithAccount,
        account_id: accountId,
        period: month,
      });
      onSuccess?.(result);
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setImporting(false);
    }
  }

  function cellColor(role) {
    const match = ROLES.find((item) => item.id === role);
    return match ? match.color : "text-neutral-400";
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-panel dark:border-white/10 dark:bg-neutral-900">
        <div className="flex items-start justify-between border-b border-neutral-100 px-6 py-5 dark:border-neutral-800">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Formato desconocido</p>
            <h2 className="mt-0.5 font-display text-2xl text-finance-ink dark:text-neutral-100">
              Mapea las columnas
            </h2>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              No reconocimos el formato de este banco. Asigna cada columna y SmartFinance lo recordara.
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

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {ROLES.map((role) => (
              <span
                key={role.id}
                className={`inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50 px-3 py-1 text-xs font-semibold dark:border-neutral-800 dark:bg-neutral-800/60 ${role.color}`}
              >
                {role.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-100 bg-neutral-50 px-3 py-1 text-xs text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800/60">
              Ignorar
            </span>
          </div>

          {(suggesting || suggestionMeta) && (
            <div className="rounded-2xl border border-neutral-100 bg-neutral-50 px-4 py-3 text-xs dark:border-neutral-800 dark:bg-neutral-800/40">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-finance-ink dark:text-neutral-200">
                  {suggesting ? "Analizando columnas..." : "Sugerencia lista"}
                </span>
                {suggestionMeta && (
                  <>
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-300">
                      {suggestionMeta.provider === "cloudflare-ai" ? "AI assist" : "Deteccion automatica"}
                    </span>
                    {suggestionMeta.bank_name && (
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-300">
                        {suggestionMeta.bank_name}
                      </span>
                    )}
                    <span className="rounded-full bg-white px-2 py-1 text-[11px] text-neutral-500 dark:bg-neutral-900 dark:text-neutral-300">
                      Confianza {Math.round(Number(suggestionMeta.confidence || 0) * 100)}%
                    </span>
                  </>
                )}
              </div>
              {suggestionMeta?.notes?.length > 0 && (
                <p className="mt-2 text-neutral-500 dark:text-neutral-400">
                  {suggestionMeta.notes[0]}
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-neutral-100 dark:border-neutral-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/40">
                  {columns.map((col, index) => (
                    <th key={index} className="px-4 py-2 text-left">
                      <div className="space-y-1.5">
                        <p className={`font-semibold ${cellColor(roleOfCol(index))}`}>{col || `Col ${index + 1}`}</p>
                        <select
                          value={roleOfCol(index)}
                          onChange={(event) => assignRole(index, event.target.value)}
                          className="w-full rounded-xl border border-neutral-200 bg-white px-2 py-1 text-xs text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        >
                          <option value="ignorar">Ignorar</option>
                          <option value="fecha">Fecha</option>
                          <option value="desc">Descripcion</option>
                          <option value="monto">Monto (+/-)</option>
                          <option value="debit">Debito (-)</option>
                          <option value="credit">Credito (+)</option>
                        </select>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 4).map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-neutral-50 last:border-0 dark:border-neutral-800/50">
                    {columns.map((_, colIndex) => (
                      <td key={colIndex} className={`px-4 py-2 text-xs ${cellColor(roleOfCol(colIndex))}`}>
                        {row[colIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!hasFecha && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Asigna la columna <strong>Fecha</strong> para continuar.
            </p>
          )}
          {!hasAmount && hasFecha && (
            <p className="rounded-xl bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
              Asigna al menos una columna de monto: <strong>Monto</strong>, <strong>Debito</strong> o <strong>Credito</strong>.
            </p>
          )}

          {transactions.length > 0 && (
            <div className="rounded-2xl bg-finance-tealSoft/50 px-5 py-4 dark:bg-teal-900/20">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-finance-teal dark:text-teal-300">
                Vista previa - {transactions.length} transacciones detectadas
              </p>
              <div className="space-y-1.5">
                {transactions.slice(0, 5).map((tx, index) => (
                  <div key={index} className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 dark:text-neutral-400">{tx.fecha}</span>
                    <span className="mx-3 flex-1 truncate text-finance-ink dark:text-neutral-200">{tx.desc_banco}</span>
                    <span className={`font-semibold tabular-nums ${tx.monto >= 0 ? "text-finance-teal" : "text-finance-red"}`}>
                      {fmtMoney(tx.monto, tx.moneda)}
                    </span>
                  </div>
                ))}
                {transactions.length > 5 && (
                  <p className="text-xs text-neutral-400">...y {transactions.length - 5} mas</p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-neutral-100 bg-neutral-50 px-5 py-4 dark:border-neutral-800 dark:bg-neutral-800/30">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="mt-0.5 rounded accent-finance-purple"
              />
              <div>
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-200">
                  Recordar este formato
                </p>
                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                  La proxima vez que subas un archivo de este banco, las columnas se detectaran automaticamente.
                </p>
              </div>
            </label>
            {remember && (
              <input
                type="text"
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                placeholder="Nombre del banco (ej: Itau, Santander...)"
                className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            )}
          </div>
        </div>

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
            {importing ? "Importando..." : `Importar ${transactions.length} transacciones`}
          </button>
        </div>
      </div>
    </div>
  );
}
