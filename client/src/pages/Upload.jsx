import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import CsvImportPanel from "../components/CsvImportPanel";
import ColumnMapper from "../components/ColumnMapper";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).href;

// ─── PDF extraction helpers ───────────────────────────────────────────────────

/** Strip diacritics + lowercase — used to match column header text reliably. */
function normForDetect(t) {
  return (t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // é→e, á→a, ó→o, etc.
    .trim();
}

/**
 * Group PDF text items into visual rows using Y-coordinate proximity.
 * Items whose Y values are within `tol` PDF points of each other are merged
 * into the same row. Each row is sorted left→right by X.
 * Rows are ordered top→bottom (descending PDF Y; PDF Y=0 is the page bottom).
 */
function groupItemsByY(items, tol = 4) {
  const buckets = new Map();
  for (const item of items) {
    let key = null;
    for (const k of buckets.keys()) {
      if (Math.abs(k - item.y) <= tol) { key = k; break; }
    }
    if (key === null) { key = item.y; buckets.set(key, []); }
    buckets.get(key).push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x));
}

/** Detect BROU bank statement by looking for "Movimientos" + "Débito" headers. */
function isBROUPdfRows(rows) {
  const flat = rows.flat().map(it => normForDetect(it.text)).join(" ");
  return flat.includes("movimiento") && flat.includes("bito"); // "d[é]bito"
}

/**
 * Find the BROU table header row and map column names → X positions.
 * BROU columns: Fecha | Referencia | Concepto | Descripción | Débito | Crédito | Saldos
 */
function findBROUHeader(rows) {
  for (let i = 0; i < rows.length; i++) {
    const norms = rows[i].map(it => normForDetect(it.text));
    if (!norms.some(n => n === "fecha" || n === "date")) continue;
    if (!norms.some(n => n.includes("debito") || n.endsWith("bito"))) continue;

    const cols = {};
    for (const it of rows[i]) {
      const n = normForDetect(it.text);
      if      (n === "fecha" || n === "date")                   cols.fecha   = it.x;
      else if (n.includes("referencia") || n === "ref")         cols.ref     = it.x;
      else if (n.includes("concepto"))                          cols.concept = it.x;
      else if (n.includes("descripcion"))                       cols.desc    = it.x;
      else if (n.includes("debito") || n.endsWith("bito"))      cols.debit   = it.x;
      else if (n.includes("credito") || n.endsWith("dito"))     cols.credit  = it.x;
      else if (n.includes("saldo"))                             cols.balance = it.x;
    }
    return { rowIdx: i, cols };
  }
  return null;
}

/**
 * Given column boundaries sorted by X, find the column name an item at
 * position `x` belongs to (nearest column to the item's left).
 */
function colForX(x, boundaries) {
  let best = boundaries[0]?.name ?? "concept";
  for (const b of boundaries) {
    if (x >= b.x - 5) best = b.name;
    else break;
  }
  return best;
}

/**
 * BROU-specific table extractor.
 *
 * For each data row (starts with DD/MM/YYYY):
 *   - Skips: Referencia and Saldos columns.
 *   - Collects: Concepto + Descripción → desc_banco.
 *   - Débito column   → negative amount (expense).
 *   - Crédito column  → positive amount (income).
 *
 * Output: one line per transaction → "DD/MM/YYYY  description  ±amount"
 * (compatible with tx-extractor Pattern 2 on the server).
 */
function extractBROUPdfRows(rows) {
  const header = findBROUHeader(rows);
  const lines  = [];

  let boundaries = null;
  if (header?.cols && Object.keys(header.cols).length >= 3) {
    boundaries = Object.entries(header.cols)
      .map(([name, x]) => ({ name, x }))
      .sort((a, b) => a.x - b.x);
  }

  for (let ri = 0; ri < rows.length; ri++) {
    if (header && ri === header.rowIdx) continue;
    const row = rows[ri];
    if (!row.length) continue;

    // Data rows start with a date like "23/03/2026" as their own text item
    if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(row[0].text)) continue;

    const date         = row[0].text;
    const conceptParts = [];
    let   debitAmt     = null;
    let   creditAmt    = null;
    const floats       = []; // fallback: numeric items when no column map

    for (const it of row.slice(1)) {
      const text = it.text.trim();
      if (!text) continue;
      const isNumeric = /^[-]?[\d,.]+$/.test(text);

      if (boundaries) {
        const col = colForX(it.x, boundaries);
        if (col === "balance" || col === "fecha" || col === "ref") continue;
        if (col === "debit")  { if (isNumeric) debitAmt  = text; continue; }
        if (col === "credit") { if (isNumeric) creditAmt = text; continue; }
        conceptParts.push(text); // concept / desc
      } else {
        if (isNumeric) floats.push(text);
        else           conceptParts.push(text);
      }
    }

    // Determine signed amount from column or position
    let amount = null;
    if (debitAmt !== null) {
      const n = parseFloat(debitAmt.replace(/,/g, ""));
      if (Number.isFinite(n)) amount = n > 0 ? -n : n;  // debit → always negative
    } else if (creditAmt !== null) {
      const n = parseFloat(creditAmt.replace(/,/g, ""));
      if (Number.isFinite(n)) amount = Math.abs(n);       // credit → always positive
    } else if (floats.length >= 2) {
      // Two trailing numbers on the line: [amount, running-balance] — use first
      const n = parseFloat(floats[0].replace(/,/g, ""));
      if (Number.isFinite(n)) amount = n;
    } else if (floats.length === 1) {
      const n = parseFloat(floats[0].replace(/,/g, ""));
      if (Number.isFinite(n)) amount = n;
    }

    if (amount === null) continue;

    const desc = conceptParts.join(" ").trim();
    if (!desc) continue;

    lines.push(`${date} ${desc} ${amount}`);
  }

  return lines.join("\n");
}

/**
 * Generic fallback: concatenate each row's items as plain text.
 * Strips the trailing running-balance number from BROU-like date rows.
 */
function extractGenericPdfText(rows, stripBalance = false) {
  return rows
    .map(row => {
      const line = row.map(it => it.text).join(" ").trim();
      if (stripBalance && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(line)) {
        return line.replace(/\s+[\d.,]+\s*$/, "").trim();
      }
      return line;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Extract text from a PDF file using PDF.js.
 *
 * For BROU statements: uses column-aware extraction so debit/credit signs
 * are resolved from the Débito/Crédito column, not guessed from formatting.
 *
 * For other PDFs: generic Y-row grouping.
 */
async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const allItems = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      const text = it.str.trim();
      if (text) allItems.push({ text, x: it.transform[4], y: it.transform[5], page: p });
    }
  }

  const rows = groupItemsByY(allItems, 4);

  // ── BROU column-aware path ─────────────────────────────────────────────────
  if (isBROUPdfRows(rows)) {
    const structured = extractBROUPdfRows(rows);
    if (structured.trim()) return structured;
    // Column detection produced nothing → generic fallback with balance strip
    return extractGenericPdfText(rows, true);
  }

  // ── Generic fallback (Santander, other banks) ──────────────────────────────
  return extractGenericPdfText(rows, false);
}

// ─── Saved bank formats panel ────────────────────────────────────────────────

function SavedFormats({ onDeleted }) {
  const { addToast } = useToast();
  const [formats, setFormats] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getBankFormats()
      .then(setFormats)
      .catch(() => {}) // table may not exist yet on first load
      .finally(() => setLoading(false));
  }, []);

  async function handleDelete(key, name) {
    try {
      await api.deleteBankFormat(key);
      setFormats(f => f.filter(x => x.format_key !== key));
      addToast("success", `Formato "${name || key}" eliminado.`);
      onDeleted?.();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  if (!loading && formats.length === 0) return null;

  return (
    <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
      <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Formatos de banco guardados</p>
      <p className="mt-1 text-sm text-neutral-500">Cuando subas archivos de estos bancos, las columnas se detectarán automáticamente.</p>
      <div className="mt-4 space-y-2">
        {loading && <p className="text-sm text-neutral-400">Cargando…</p>}
        {formats.map(fmt => (
          <div key={fmt.format_key} className="flex items-center justify-between rounded-2xl bg-finance-cream/75 px-4 py-3 dark:bg-neutral-800/75">
            <div>
              <p className="font-semibold text-finance-ink dark:text-neutral-100">
                {fmt.bank_name || "Banco sin nombre"}
              </p>
              <p className="text-xs text-neutral-400 font-mono">{fmt.format_key}</p>
            </div>
            <button
              onClick={() => handleDelete(fmt.format_key, fmt.bank_name)}
              className="rounded-full p-1.5 text-neutral-400 transition hover:bg-red-50 hover:text-finance-red dark:hover:bg-red-900/20"
              title="Eliminar formato guardado"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Upload({ month, onDone }) {
  const { addToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [selectedAccount, setSelectedAccount] = useState("");
  const [uploadForm, setUploadForm] = useState({ file: null, period: month });
  const [manualForm, setManualForm] = useState({ fecha: `${month}-01`, desc_banco: "", monto: "", moneda: "UYU" });
  // ColumnMapper state — shown when server returns needs_mapping:true for a CSV
  const [columnMapper, setColumnMapper] = useState(null); // null | { columns, sample, formatKey }

  async function load() {
    setLoading(true);
    try {
      const [nextAccounts, nextHistory] = await Promise.all([api.getAccounts(), api.getUploads()]);
      setAccounts(nextAccounts);
      setHistory(nextHistory);
      if (!selectedAccount && nextAccounts.length === 1) setSelectedAccount(nextAccounts[0].id);
    } catch (e) {
      addToast("error", e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUploadForm((prev) => ({ ...prev, period: month }));
    setManualForm((prev) => ({ ...prev, fecha: `${month}-01` }));
    load();
  }, [month]);

  useEffect(() => {
    const acc = accounts.find((a) => a.id === selectedAccount);
    if (acc) setManualForm((prev) => ({ ...prev, moneda: acc.currency }));
  }, [selectedAccount, accounts]);

  function handleDragEnter(e) {
    e.preventDefault();
    dragCounter.current++;
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) setUploadForm((prev) => ({ ...prev, file }));
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedAccount) { addToast("warning", "Primero elegí la cuenta de origen."); return; }
    if (!uploadForm.file) { addToast("warning", "Seleccioná un archivo."); return; }
    setFeedback(null);

    const formData = new FormData();
    formData.append("account_id", selectedAccount);
    formData.append("period", uploadForm.period);

    const file = uploadForm.file;
    if (file.name.toLowerCase().endsWith(".pdf")) {
      setParsing(true);
      try {
        const text = await extractPdfText(file);
        formData.append("extracted_text", text);
        formData.append("file", new Blob([file.name], { type: "text/plain" }), file.name);
      } catch (e) {
        addToast("error", `Error al leer el PDF: ${e.message}`);
        setParsing(false);
        return;
      }
      setParsing(false);
    } else {
      formData.append("file", file);
    }

    try {
      const result = await api.uploadFile(formData);

      // Server couldn't detect the CSV format → show column mapper
      if (result.needs_mapping) {
        setColumnMapper({
          columns:   result.columns,
          sample:    result.sample,
          formatKey: result.format_key,
        });
        return; // don't show feedback or clear the file yet
      }

      setFeedback(result);
      setUploadForm((prev) => ({ ...prev, file: null }));
      await load();
      if (result.new_transactions > 0) {
        addToast("success", `${result.new_transactions} transacciones nuevas importadas.`);
        setTimeout(() => onDone?.(), 2500);
      } else if (result.duplicates_skipped > 0) {
        addToast("info", `Archivo ya procesado: ${result.duplicates_skipped} duplicados salteados.`);
      } else {
        addToast("warning", "No se encontraron transacciones en el archivo.");
      }
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    if (!selectedAccount) { addToast("warning", "Primero elegí la cuenta de origen."); return; }
    if (!manualForm.desc_banco.trim()) { addToast("warning", "Ingresá una descripción."); return; }
    if (!manualForm.monto) { addToast("warning", "Ingresá un monto."); return; }
    try {
      await api.createTransaction({ ...manualForm, monto: Number(manualForm.monto), account_id: selectedAccount });
      setManualForm((prev) => ({ ...prev, desc_banco: "", monto: "" }));
      addToast("success", "Transacción guardada correctamente.");
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount);

  return (
    <div className="space-y-6">
      {/* ColumnMapper modal — appears when server can't auto-detect CSV format */}
      {columnMapper && (
        <ColumnMapper
          columns={columnMapper.columns}
          sample={columnMapper.sample}
          formatKey={columnMapper.formatKey}
          accountId={selectedAccount}
          month={uploadForm.period}
          onSuccess={(result) => {
            setColumnMapper(null);
            setUploadForm((prev) => ({ ...prev, file: null }));
            load();
            if (result.created > 0) {
              addToast("success", `${result.created} transacciones importadas correctamente.`);
              setTimeout(() => onDone?.(), 2500);
            } else if (result.duplicates > 0) {
              addToast("info", `Todas las transacciones ya existían (${result.duplicates} duplicados).`);
            } else {
              addToast("warning", "No se importaron transacciones.");
            }
          }}
          onCancel={() => setColumnMapper(null)}
        />
      )}
      {/* STEP 1: Account selector */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 1 — Cuenta de origen</p>
        <p className="mt-1 text-sm text-neutral-500">Seleccioná de qué cuenta vienen los movimientos antes de cargar.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {loading ? <p className="col-span-4 text-neutral-400">Cargando cuentas…</p> : null}
          {accounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => setSelectedAccount(acc.id)}
              className={`rounded-2xl border-2 px-4 py-3 text-left transition ${
                selectedAccount === acc.id
                  ? "border-finance-purple bg-finance-purpleSoft dark:bg-purple-900/30"
                  : "border-neutral-200 hover:border-finance-purple/40 dark:border-neutral-700 dark:hover:border-finance-purple/40"
              }`}
            >
              <p className="font-semibold text-finance-ink">{acc.name}</p>
              <p className="text-xs text-neutral-400">{acc.currency}</p>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2: Upload + manual — disabled until account is selected */}
      <div className={`grid gap-6 lg:grid-cols-[1fr_0.95fr] transition-opacity ${!selectedAccount ? "pointer-events-none opacity-40" : ""}`}>

        {/* Upload PDF / drag-and-drop */}
        <form
          onSubmit={handleUpload}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`rounded-[32px] border-2 border-dashed p-6 shadow-panel transition-colors dark:bg-neutral-900/85 ${
            isDragging
              ? "border-finance-purple bg-finance-purpleSoft dark:bg-purple-900/20"
              : "border-finance-purple/30 bg-white/85 dark:border-finance-purple/20"
          }`}
        >
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
            Paso 2a — Subir resumen
            {selectedAccountData ? <span className="ml-2 font-semibold text-finance-purple">({selectedAccountData.name})</span> : null}
          </p>
          <h2 className="font-display text-3xl text-finance-ink">PDF, CSV o imagen</h2>

          <div className={`mt-6 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
            isDragging
              ? "border-finance-purple bg-white/50 dark:border-finance-purple dark:bg-purple-900/10"
              : "border-neutral-200 dark:border-neutral-700"
          }`}>
            <p className="text-3xl mb-2">{isDragging ? "⬇" : "📄"}</p>
            <p className="text-sm font-medium text-finance-ink">
              {isDragging ? "Soltá el archivo aquí" : uploadForm.file ? uploadForm.file.name : "Arrastrá un archivo o clic para elegir"}
            </p>
            {uploadForm.file && !isDragging && (
              <p className="mt-1 text-xs text-neutral-400">{(uploadForm.file.size / 1024).toFixed(0)} KB</p>
            )}
            <input
              type="file"
              accept=".pdf,image/*,.txt,.csv"
              onChange={(e) => setUploadForm((prev) => ({ ...prev, file: e.target.files?.[0] || null }))}
              className="mt-3 text-sm"
            />
          </div>

          {uploadForm.file?.name.toLowerCase().endsWith(".pdf") && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-finance-teal">PDF detectado — el texto se extrae en tu navegador antes de subir.</p>
              <p className="text-xs text-finance-amber">
                💡 <strong>Tip BROU:</strong> Para mejores resultados descargá el <strong>CSV</strong> desde el portal de BROU (Movimientos → Exportar) en lugar del PDF.
              </p>
            </div>
          )}
          {uploadForm.file?.name.toLowerCase().endsWith(".csv") && (
            <p className="mt-3 text-xs text-finance-teal">CSV detectado — se parsea automáticamente. Soporta formato BROU con columnas Débito/Crédito.</p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <input
              type="month"
              value={uploadForm.period}
              onChange={(e) => setUploadForm((prev) => ({ ...prev, period: e.target.value }))}
              className="flex-1 rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            />
            <button
              disabled={parsing || !selectedAccount}
              className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {parsing ? "Leyendo PDF…" : "Procesar"}
            </button>
          </div>

          {feedback && (
            <div className={`mt-5 rounded-2xl p-4 text-sm space-y-1 ${
              feedback.new_transactions === 0 && feedback.duplicates_skipped === 0
                ? "bg-finance-amberSoft text-finance-ink dark:bg-amber-900/30 dark:text-amber-200"
                : "bg-finance-purpleSoft text-finance-ink dark:bg-purple-900/30 dark:text-purple-200"
            }`}>
              {feedback.new_transactions === 0 && feedback.duplicates_skipped === 0 ? (
                <>
                  <p className="font-semibold">No se encontraron transacciones</p>
                  <p className="text-neutral-500 dark:text-amber-300/70">El archivo no pudo parsearse. Intentá cargando las transacciones a mano.</p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Procesado correctamente</p>
                  <p>Nuevas: <strong>{feedback.new_transactions}</strong></p>
                  <p>Duplicados salteados: {feedback.duplicates_skipped}</p>
                  <p>Auto-categorizadas: {feedback.auto_categorized}</p>
                  <p>Pendientes de categorizar: {feedback.pending_review}</p>
                </>
              )}
            </div>
          )}
        </form>

        {/* Manual entry */}
        <form onSubmit={handleManualSubmit} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
            Paso 2b — Carga manual
            {selectedAccountData ? <span className="ml-2 font-semibold text-finance-purple">({selectedAccountData.name})</span> : null}
          </p>
          <h2 className="font-display text-3xl text-finance-ink">Cargar gasto/ingreso</h2>
          <div className="mt-6 grid gap-4">
            <input
              type="date"
              value={manualForm.fecha}
              onChange={(e) => setManualForm((p) => ({ ...p, fecha: e.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              required
            />
            <input
              type="text"
              placeholder="Descripción (obligatoria)"
              value={manualForm.desc_banco}
              onChange={(e) => setManualForm((p) => ({ ...p, desc_banco: e.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                placeholder="Monto (negativo = gasto)"
                value={manualForm.monto}
                onChange={(e) => setManualForm((p) => ({ ...p, monto: e.target.value }))}
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                required
              />
              <select
                value={manualForm.moneda}
                onChange={(e) => setManualForm((p) => ({ ...p, moneda: e.target.value }))}
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="UYU">UYU</option>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </div>
            <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-finance-ink">
              Guardar transacción
            </button>
          </div>
        </form>
      </div>

      {/* CSV / paste import */}
      <CsvImportPanel
        selectedAccount={selectedAccount}
        month={uploadForm.period}
        onImported={() => { load(); onDone?.(); }}
      />

      {/* Upload history */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Historial de uploads</p>
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-finance-cream/75 px-4 py-4 dark:bg-neutral-800/75">
              <div>
                <p className="font-semibold text-finance-ink">{item.filename}</p>
                <p className="text-sm text-neutral-500">{item.account_name || "Sin cuenta"} · {item.period} · {item.tx_count} transacciones</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${
                item.status === "needs_mapping"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "bg-finance-tealSoft text-finance-teal dark:bg-teal-900/30 dark:text-teal-300"
              }`}>
                {item.status === "needs_mapping" ? "Sin mapeo" : item.status}
              </span>
            </div>
          ))}
          {!loading && history.length === 0 && (
            <p className="text-neutral-500">No hay uploads todavía.</p>
          )}
        </div>
      </div>

      {/* Saved bank formats */}
      <SavedFormats onDeleted={load} />
    </div>
  );
}
