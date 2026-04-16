import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import CsvImportPanel from "../components/CsvImportPanel";
import ColumnMapper from "../components/ColumnMapper";
import BrandMark from "../components/BrandMark";
import GuidedCategorizationDeck from "../components/GuidedCategorizationDeck";
import RuleReviewDeck from "../components/RuleReviewDeck";
import TransactionReviewDeck from "../components/TransactionReviewDeck";
import { SUPPORTED_CURRENCY_OPTIONS } from "../utils";
import {
  clearPendingGuidedReviewContext,
  writePendingGuidedReviewContext,
} from "../utils/pendingReviewSession";

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

function computeClientFormatKey(rawHeaders = []) {
  const normalized = rawHeaders.slice(0, 8).map((value) => normForDetect(value)).filter(Boolean).join("|");
  let hash = 5381;
  for (const ch of normalized) {
    hash = ((hash << 5) + hash) ^ ch.charCodeAt(0);
    hash = hash >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function normalizeSheetCell(value) {
  if (value == null) return "";
  return String(value).trim();
}

function findSpreadsheetHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const normalized = (rows[i] || []).map((cell) => normForDetect(cell));
    const hasFecha = normalized.some((value) => value === "fecha" || value === "date");
    const hasAmount = normalized.some((value) =>
      /dbito|debito|credito|crdito|monto|importe|amount|valor|caja de ahorro|cuenta corriente|saldo/.test(value)
    );
    if (hasFecha && hasAmount) return i;
  }
  return rows.findIndex((row) => row.some((cell) => String(cell || "").trim()));
}

function trimEmptySpreadsheetColumns(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const keepIndexes = [];
  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex++) {
    const hasContent = rows.some((row) => String(row[columnIndex] || "").trim());
    if (hasContent) keepIndexes.push(columnIndex);
  }
  return rows.map((row) => keepIndexes.map((columnIndex) => row[columnIndex] ?? ""));
}

async function parseSpreadsheetFile(file) {
  const XLSX = await import("xlsx");
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    raw: false,
    cellDates: false,
  });

  const sheetName = workbook.SheetNames.find((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return false;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
    return rows.some((row) => Array.isArray(row) && row.some((cell) => String(cell || "").trim()));
  });

  if (!sheetName) return null;

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })
    .map((row) => (Array.isArray(row) ? row.map(normalizeSheetCell) : []))
    .filter((row) => row.some((cell) => String(cell || "").trim()));
  if (rows.length === 0) return null;

  const headerIdx = findSpreadsheetHeaderRow(rows);
  if (headerIdx < 0 || headerIdx >= rows.length) return null;

  const preparedRows = trimEmptySpreadsheetColumns(rows.slice(headerIdx));
  const headers = preparedRows[0] || [];
  return {
    sheetName,
    rows: preparedRows,
    sample: preparedRows.slice(0, 6),
    headers,
    formatKey: computeClientFormatKey(headers),
  };
}

async function extractImageText(file) {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(file, "spa+eng");
  return String(result?.data?.text || "").trim();
}

function isImageImport(fileName = "") {
  return /\.(png|jpe?g|webp)$/i.test(String(fileName || ""));
}

function formatUploadParser(parser) {
  if (parser === "csv") return "CSV";
  if (parser === "text") return "Texto";
  if (parser === "ai") return "AI";
  if (parser === "hybrid") return "Hibrido";
  if (parser === "unsupported") return "Manual";
  return "Import";
}

function uploadStatusTone(status) {
  if (status === "needs_review") {
    return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  }
  if (status === "processing" || status === "uploaded" || status === "pending") {
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
  }
  return "bg-finance-tealSoft text-finance-teal dark:bg-teal-900/30 dark:text-teal-300";
}

function buildInitialManualForm(month) {
  return {
    fecha: `${month}-01`,
    desc_banco: "",
    monto: "",
    moneda: "UYU",
    account_id: "",
  };
}

function getReviewTransactionId(item) {
  const id = Number(item?.transaction_id ?? item?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
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
      addToast(
        e?.code === "ACCOUNT_CURRENCY_MISMATCH" ? "warning" : "error",
        e.message
      );
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

export default function Upload({
  month,
  userId,
  resumeGuidedReview = null,
  onConsumeResumeGuidedReview,
  onInvalidResumeGuidedReview,
  onDone,
  onNavigate,
}) {
  const { addToast } = useToast();
  const [accounts, setAccounts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const loadRequestIdRef = useRef(0);

  const [selectedAccount, setSelectedAccount] = useState("");
  const [uploadForm, setUploadForm] = useState({ file: null, period: month });
  const [manualForm, setManualForm] = useState({ entry_type: "expense", fecha: `${month}-01`, desc_banco: "", monto: "", moneda: "UYU", target_account_id: "", target_amount: "", fee_amount: "" });
  // ColumnMapper state — shown when server returns needs_mapping:true for a CSV
  const [columnMapper, setColumnMapper] = useState(null); // null | { columns, sample, formatKey }
  const [reviewGroups, setReviewGroups] = useState([]);
  const [guidedReviewGroups, setGuidedReviewGroups] = useState([]);
  const [guidedOnboardingRequired, setGuidedOnboardingRequired] = useState(false);
  const [transactionReviewQueue, setTransactionReviewQueue] = useState([]);
  const [resolvedGuidedGroupKeys, setResolvedGuidedGroupKeys] = useState([]);
  const [resolvedReviewGroupKeys, setResolvedReviewGroupKeys] = useState([]);
  const [resolvedReviewTransactionIds, setResolvedReviewTransactionIds] = useState([]);

  function resetReviewFlowState() {
    setReviewGroups([]);
    setGuidedReviewGroups([]);
    setGuidedOnboardingRequired(false);
    setTransactionReviewQueue([]);
    setResolvedGuidedGroupKeys([]);
    setResolvedReviewGroupKeys([]);
    setResolvedReviewTransactionIds([]);
  }

  function applyImportReviewState(result = {}) {
    resetReviewFlowState();
    setReviewGroups(result.review_groups || []);
    setGuidedReviewGroups(result.guided_review_groups || []);
    setGuidedOnboardingRequired(
      Boolean(result.guided_onboarding_required && (result.guided_review_groups || []).length > 0)
    );
    setTransactionReviewQueue(result.transaction_review_queue || []);
  }

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    try {
      const [nextAccounts, nextHistory, nextCategories] = await Promise.all([
        api.getAccounts(),
        api.getUploads(uploadForm.period || month),
        api.getCategories(),
      ]);
      if (loadRequestIdRef.current !== requestId) return;
      setAccounts(nextAccounts);
      setHistory(nextHistory);
      setCategories(nextCategories);
      if (nextAccounts.every((account) => account.id !== selectedAccount)) {
        setSelectedAccount(nextAccounts.length === 1 ? nextAccounts[0].id : "");
      } else if (!selectedAccount && nextAccounts.length === 1) {
        setSelectedAccount(nextAccounts[0].id);
      }
    } catch (e) {
      if (loadRequestIdRef.current !== requestId) return;
      addToast("error", e.message);
    } finally {
      if (loadRequestIdRef.current !== requestId) return;
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [uploadForm.period]);

  useEffect(() => {
    setUploadForm((prev) => ({ ...prev, period: month }));
    setManualForm(buildInitialManualForm(month));
  }, [month]);

  useEffect(() => {
    const acc = accounts.find((a) => a.id === selectedAccount);
    if (acc) setManualForm((prev) => ({ ...prev, moneda: acc.currency }));
    // Close column mapper if account changes — prevents import to wrong account
    if (columnMapper) setColumnMapper(null);
  }, [selectedAccount]);

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

  function finishUploadFlow() {
    if (userId) {
      clearPendingGuidedReviewContext(userId);
    }
    resetReviewFlowState();
    onDone?.();
  }

  function closeUploadFlowWithPending() {
    onDone?.();
  }

  async function handleGuidedComplete() {
    try {
      await api.completeGuidedCategorizationOnboarding();
      addToast("success", "Listo. Categorización inicial completa.");
      setGuidedOnboardingRequired(false);
      setGuidedReviewGroups([]);
      if (displayedRuleReviewGroups.length === 0 && displayedTransactionReviewQueue.length === 0) {
        finishUploadFlow();
      }
    } catch (error) {
      addToast("error", error.message);
    }
  }

  function handleGuidedFollowLater() {
    closeUploadFlowWithPending();
  }

  async function handleGuidedSkip() {
    try {
      await api.skipGuidedCategorizationOnboarding();
      addToast("info", "Perfecto. Lo dejamos para mas adelante.");
      finishUploadFlow();
    } catch (error) {
      addToast("error", error.message);
    }
  }

  function handleRuleReviewDone() {
    setReviewGroups([]);
    if (displayedTransactionReviewQueue.length === 0) {
      finishUploadFlow();
    }
  }

  function markResolvedTransactions(group) {
    setResolvedReviewTransactionIds((prev) => {
      const next = new Set(prev);
      (group.transaction_ids || []).forEach((id) => {
        const transactionId = Number(id);
        if (Number.isInteger(transactionId) && transactionId > 0) next.add(transactionId);
      });
      return [...next];
    });
  }

  function handleAcceptedGuidedGroup(group) {
    setResolvedGuidedGroupKeys((prev) => (prev.includes(group.key) ? prev : [...prev, group.key]));
    markResolvedTransactions(group);
  }

  function handleAcceptedRuleReviewGroup(group) {
    setResolvedReviewGroupKeys((prev) => (prev.includes(group.key) ? prev : [...prev, group.key]));
    markResolvedTransactions(group);
  }

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedAccount) { addToast("warning", "Primero elegí la cuenta de origen."); return; }
    if (!uploadForm.file) { addToast("warning", "Seleccioná un archivo."); return; }
    setFeedback(null);

    const formData = new FormData();
    formData.append("account_id", selectedAccount);
    formData.append("period", uploadForm.period);
    formData.append("statement_currency", selectedAccountData?.currency || "UYU");

    const file = uploadForm.file;
    setParsing(true);
    try {
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const spreadsheet = await parseSpreadsheetFile(file);
        if (!spreadsheet || spreadsheet.rows.length < 2 || spreadsheet.headers.length < 2) {
          addToast("error", "No pudimos leer una tabla valida en ese Excel.");
          setParsing(false);
          return;
        }
        setColumnMapper({
          columns: spreadsheet.headers,
          sample: spreadsheet.sample,
          formatKey: spreadsheet.formatKey,
        });
        addToast("info", "Excel listo. Revisa el mapeo antes de importar.");
        setParsing(false);
        return;
      }

      if (lowerName.endsWith(".pdf")) {
        const text = await extractPdfText(file);
        formData.append("extracted_text", text);
        formData.append("file", file, file.name);
      } else if (isImageImport(lowerName)) {
        const text = await extractImageText(file);
        formData.append("extracted_text", text);
        formData.append("file", file, file.name);
      } else {
        formData.append("file", file);
      }

      const result = await api.uploadFile(formData);

      // Server couldn't detect the CSV format → show column mapper
      if (result.needs_mapping) {
        setColumnMapper({
          columns:   result.columns,
          sample:    result.sample,
          formatKey: result.format_key,
        });
        setParsing(false);
        return; // don't show feedback or clear the file yet
      }

      setFeedback(result);
      applyImportReviewState(result);
      setUploadForm((prev) => ({ ...prev, file: null }));
      await load();
      if (result.new_transactions > 0) {
        addToast("success", `${result.new_transactions} transacciones nuevas importadas.`);
        const hasGuided = Boolean(result.guided_onboarding_required && (result.guided_review_groups || []).length > 0);
        const hasReviewGroups = (result.review_groups || []).length > 0;
        const hasTransactionQueue = (result.transaction_review_queue || []).length > 0;
        if (!hasGuided && !hasReviewGroups && !hasTransactionQueue) {
          setTimeout(() => onDone?.(), 2500);
        }
      } else if (result.duplicates_skipped > 0) {
        addToast("info", `Archivo ya procesado: ${result.duplicates_skipped} duplicados salteados.`);
      } else {
        addToast("warning", "No se encontraron transacciones en el archivo.");
      }
    } catch (e) {
      addToast(
        e?.code === "ACCOUNT_CURRENCY_MISMATCH" ? "warning" : "error",
        e.message
      );
    } finally {
      setParsing(false);
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    if (!selectedAccount) { addToast("warning", "Primero elegí la cuenta de origen."); return; }
    if (!manualForm.desc_banco.trim()) { addToast("warning", "Ingresá una descripción."); return; }
    if (!manualForm.monto) { addToast("warning", "Ingresá un monto."); return; }
    if (manualForm.entry_type === "internal_transfer" && !manualForm.target_account_id) {
      addToast("warning", "Para transferencia interna, elegí la cuenta destino."); return;
    }
    const accountCurrency = accounts.find((account) => account.id === selectedAccount)?.currency;
    if (accountCurrency && manualForm.moneda !== accountCurrency) {
      addToast("warning", `La cuenta seleccionada es ${accountCurrency}. Usá esa moneda o elegí otra cuenta.`);
      return;
    }
    try {
      const payload = {
        ...manualForm,
        monto: manualForm.entry_type === "expense" ? -Math.abs(Number(manualForm.monto)) : Math.abs(Number(manualForm.monto)),
        account_id: selectedAccount,
        target_account_id: manualForm.target_account_id || undefined,
        target_amount: manualForm.target_amount ? Number(manualForm.target_amount) : undefined,
        fee_amount: manualForm.fee_amount ? Number(manualForm.fee_amount) : undefined,
      };
      await api.createTransaction(payload);
      setManualForm((prev) => ({ ...prev, entry_type: "expense", desc_banco: "", monto: "", target_account_id: "", target_amount: "", fee_amount: "" }));
      addToast("success", "Transacción guardada correctamente.");
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount);
  const displayedGuidedReviewGroups = guidedReviewGroups.filter(
    (group) => !resolvedGuidedGroupKeys.includes(group.key)
  );
  const displayedTransactionReviewQueue = transactionReviewQueue.filter(
    (item) => {
      const transactionId = getReviewTransactionId(item);
      return transactionId ? !resolvedReviewTransactionIds.includes(transactionId) : false;
    }
  );
  const displayedRuleReviewGroups = reviewGroups.filter(
    (group) => !resolvedReviewGroupKeys.includes(group.key)
  );
  const pendingGuidedTransactionIds = Array.from(
    new Set([
      ...displayedGuidedReviewGroups.flatMap((group) => group.transaction_ids || []),
      ...displayedRuleReviewGroups.flatMap((group) => group.transaction_ids || []),
      ...displayedTransactionReviewQueue.map((item) => getReviewTransactionId(item)),
    ].map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))
  );
  const pendingReviewSummary = [
    displayedGuidedReviewGroups.length > 0
      ? { label: "Guiado", value: displayedGuidedReviewGroups.length }
      : null,
    displayedRuleReviewGroups.length > 0
      ? { label: "Reglas", value: displayedRuleReviewGroups.length }
      : null,
    displayedTransactionReviewQueue.length > 0
      ? { label: "1 a 1", value: displayedTransactionReviewQueue.length }
      : null,
  ].filter(Boolean);

  useEffect(() => {
    if (!userId) return;
    if (pendingGuidedTransactionIds.length > 0) {
      writePendingGuidedReviewContext(userId, {
        source: "upload",
        month: uploadForm.period || month,
        accountId: selectedAccount || null,
        transactionIds: pendingGuidedTransactionIds,
      });
      return;
    }
    clearPendingGuidedReviewContext(userId);
  }, [userId, pendingGuidedTransactionIds, uploadForm.period, month, selectedAccount]);

  useEffect(() => {
    if (!resumeGuidedReview || !userId) return;

    let cancelled = false;
    const accountId = resumeGuidedReview.accountId || null;

    async function resumeGuidedQueue() {
      setParsing(true);
      try {
        if (accountId) {
          setSelectedAccount(accountId);
        }
        const result = await api.resumePendingGuidedReview({
          transaction_ids: resumeGuidedReview.transactionIds,
          month: resumeGuidedReview.month || month,
          account_id: accountId,
        });
        if (cancelled) return;

        if (!result.remaining_transaction_ids || result.remaining_transaction_ids.length === 0) {
          clearPendingGuidedReviewContext(userId);
          addToast("info", "Esa revision ya no tiene movimientos pendientes.");
          onConsumeResumeGuidedReview?.();
          return;
        }

        applyImportReviewState(result);
        writePendingGuidedReviewContext(userId, {
          source: resumeGuidedReview.source || "upload",
          month: resumeGuidedReview.month || month,
          accountId,
          transactionIds: result.remaining_transaction_ids,
        });
        onConsumeResumeGuidedReview?.();
      } catch (error) {
        if (cancelled) return;
        addToast("error", error.message);
        onInvalidResumeGuidedReview?.();
      } finally {
        if (!cancelled) {
          setParsing(false);
        }
      }
    }

    resumeGuidedQueue();
    return () => {
      cancelled = true;
    };
  }, [
    resumeGuidedReview,
    userId,
    month,
    addToast,
    onConsumeResumeGuidedReview,
    onInvalidResumeGuidedReview,
  ]);

  return (
    <div className="space-y-6">
      {/* ColumnMapper modal — appears when server can't auto-detect CSV format */}
      {columnMapper && (
        <ColumnMapper
          columns={columnMapper.columns}
          sample={columnMapper.sample}
          formatKey={columnMapper.formatKey}
          accountId={selectedAccount}
          accountCurrency={selectedAccountData?.currency || "UYU"}
          month={uploadForm.period}
          onSuccess={(result) => {
            setColumnMapper(null);
            setUploadForm((prev) => ({ ...prev, file: null }));
            setFeedback({
              new_transactions: result.created || 0,
              duplicates_skipped: result.duplicates || 0,
              auto_categorized: 0,
              pending_review: 0,
            });
            applyImportReviewState(result);
            load();
            if (result.created > 0) {
              addToast("success", `${result.created} transacciones importadas correctamente.`);
              const hasGuided = Boolean(result.guided_onboarding_required && (result.guided_review_groups || []).length > 0);
              const hasReviewGroups = (result.review_groups || []).length > 0;
              const hasTransactionQueue = (result.transaction_review_queue || []).length > 0;
              if (!hasGuided && !hasReviewGroups && !hasTransactionQueue) {
                setTimeout(() => onDone?.(), 2500);
              }
            } else if (result.duplicates > 0) {
              addToast("info", `Todas las transacciones ya existían (${result.duplicates} duplicados).`);
            } else {
              addToast("warning", "No se importaron transacciones.");
            }
          }}
          onCancel={() => setColumnMapper(null)}
        />
      )}
        {guidedOnboardingRequired && guidedReviewGroups.length > 0 && (
          <GuidedCategorizationDeck
            key={`guided-review-${guidedReviewGroups.map((group) => group.key).join("|")}`}
            groups={guidedReviewGroups}
            onAcceptedGroup={handleAcceptedGuidedGroup}
            onComplete={handleGuidedComplete}
            onFollowLater={handleGuidedFollowLater}
            onSkip={handleGuidedSkip}
        />
      )}
        {!guidedOnboardingRequired && displayedRuleReviewGroups.length > 0 && (
          <RuleReviewDeck
            key={`rule-review-${displayedRuleReviewGroups.map((group) => group.key).join("|")}`}
            groups={displayedRuleReviewGroups}
            onAcceptedGroup={handleAcceptedRuleReviewGroup}
            onClose={closeUploadFlowWithPending}
            onDone={() => {
            load();
            handleRuleReviewDone();
          }}
        />
      )}
      {!guidedOnboardingRequired && displayedRuleReviewGroups.length === 0 && displayedTransactionReviewQueue.length > 0 && (
        <TransactionReviewDeck
          items={displayedTransactionReviewQueue}
          categories={categories}
          accounts={accounts}
          onCategoryCreated={load}
          onClose={closeUploadFlowWithPending}
          onDone={() => {
            finishUploadFlow();
          }}
        />
      )}
      <section className="relative overflow-hidden rounded-[38px] border border-white/70 bg-white/82 p-6 shadow-panel backdrop-blur dark:border-white/10 dark:bg-neutral-900/82 md:p-8">
        <div className="absolute -right-12 top-0 h-40 w-40 rounded-full bg-finance-purple/10 blur-3xl" />
        <div className="absolute -left-12 bottom-0 h-40 w-40 rounded-full bg-finance-teal/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-800/85">
              <BrandMark size="sm" />
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-[0.34em] text-neutral-400">Upload studio</p>
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">
                  Importá movimientos desde tu banco
                </p>
              </div>
            </div>

            <h1 className="mt-6 max-w-2xl font-display text-4xl leading-tight text-finance-ink dark:text-neutral-100 md:text-5xl">
              Importá movimientos desde PDF, CSV o carga manual.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
              Elegí la cuenta, subí un archivo o cargá algo manual. SmartFinance extrae las transacciones automáticamente.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              { title: "Importá", body: "PDF, CSV o TXT con detección y mapeo automático.", tone: "bg-finance-purpleSoft/75 text-finance-purple" },
              { title: "Aprende", body: "Los formatos guardados y tus categorías reducen trabajo repetido.", tone: "bg-finance-tealSoft/80 text-finance-teal" },
              { title: "Acumula", body: "Cada archivo importado suma historial para comparar meses.", tone: "bg-finance-amberSoft/80 text-finance-amber" },
            ].map((item, index) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-white/70 bg-white/82 p-4 shadow-sm dark:border-white/10 dark:bg-neutral-950/45"
              >
                <span className={`inline-flex h-10 min-w-10 items-center justify-center rounded-2xl px-2 text-sm font-semibold ${item.tone}`}>
                  0{index + 1}
                </span>
                <p className="mt-3 font-semibold text-finance-ink dark:text-neutral-100">{item.title}</p>
                <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-300">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* STEP 1: Account selector */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 1 — Cuenta de origen</p>
        <p className="mt-1 text-sm text-neutral-500">Seleccioná de qué cuenta vienen los movimientos antes de cargar.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {loading ? <p className="col-span-4 text-neutral-400">Cargando cuentas…</p> : null}
          {!loading && accounts.length === 0 && (
            <p className="col-span-4 text-neutral-500">No tenés cuentas creadas todavía.</p>
          )}
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
          <button
            type="button"
            onClick={() => onNavigate?.("accounts")}
            className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-neutral-300 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-600 dark:hover:border-purple-400 dark:hover:text-purple-300"
          >
            <span className="text-lg">+</span>
            Nueva cuenta
          </button>
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
          className={`relative rounded-[32px] border-2 border-dashed p-6 shadow-panel transition-colors dark:bg-neutral-900/85 ${
            isDragging
              ? "border-finance-purple bg-finance-purpleSoft dark:bg-purple-900/20"
              : "border-finance-purple/30 bg-white/85 dark:border-finance-purple/20"
          }`}
        >
          {/* Loading overlay — shown while extracting PDF + uploading */}
          {parsing && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-[30px] bg-white/97 backdrop-blur-md dark:bg-neutral-950/97">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-finance-purple/20 border-t-finance-purple" />
              <div className="text-center">
                <p className="font-semibold text-finance-ink dark:text-white">Procesando archivo…</p>
                <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">Esto puede tardar unos segundos</p>
              </div>
            </div>
          )}
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
            Paso 2a — Subir resumen
            {selectedAccountData ? <span className="ml-2 font-semibold text-finance-purple">({selectedAccountData.name})</span> : null}
          </p>
          <h2 className="font-display text-3xl text-finance-ink">PDF, CSV o TXT</h2>

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
              accept=".pdf,.txt,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setUploadForm((prev) => ({ ...prev, file: e.target.files?.[0] || null }))}
              className="mt-3 text-sm"
            />
          </div>

          {uploadForm.file?.name.toLowerCase().endsWith(".pdf") && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-finance-teal">PDF detectado — el texto se extrae en tu navegador antes de subir.</p>
              {selectedAccountData && selectedAccountData.currency !== "UYU" && (
                <p className="text-xs text-finance-amber">
                  Cuenta en <strong>{selectedAccountData.currency}</strong> — las transacciones se importarán en {selectedAccountData.currency}. Verificá que el PDF corresponda a esta cuenta.
                </p>
              )}
              <p className="text-xs text-finance-amber">
                💡 <strong>Tip BROU:</strong> Para mejores resultados descargá el <strong>CSV</strong> desde el portal de BROU (Movimientos → Exportar) en lugar del PDF.
              </p>
            </div>
          )}
          {uploadForm.file?.name.toLowerCase().endsWith(".csv") && (
            <p className="mt-3 text-xs text-finance-teal">CSV detectado — se parsea automáticamente. Soporta formato BROU con columnas Débito/Crédito.</p>
          )}
          {isImageImport(uploadForm.file?.name || "") && (
            <p className="mt-3 text-xs text-finance-teal">Imagen detectada — extraemos texto con OCR en tu navegador y, si hace falta, usamos Ollama para estructurar el movimiento.</p>
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
              data-testid="upload-process-button"
              className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Procesar
            </button>
          </div>

          {feedback && (
            <div data-testid="upload-feedback" className={`mt-5 rounded-2xl p-4 text-sm space-y-1 ${
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
                  <div className="mt-3 flex flex-wrap gap-2">
                    {feedback.parser ? (
                      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/60 dark:text-neutral-100">
                        Parser: {formatUploadParser(feedback.parser)}
                      </span>
                    ) : null}
                    {feedback.detected_format ? (
                      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/60 dark:text-neutral-100">
                        Formato: {feedback.detected_format}
                      </span>
                    ) : null}
                    {Number.isFinite(Number(feedback.extracted_candidates)) ? (
                      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/60 dark:text-neutral-100">
                        Extraidas: {Number(feedback.extracted_candidates)}
                      </span>
                    ) : null}
                    {Number(feedback.unmatched_count || 0) > 0 ? (
                      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/60 dark:text-neutral-100">
                        Ambiguas: {Number(feedback.unmatched_count)}
                      </span>
                    ) : null}
                  </div>
                  {feedback.ai_assisted ? (
                    <p className="text-xs text-neutral-500 dark:text-purple-200/80">
                      AI assist: usamos {feedback.ai_provider || "el provider configurado"} para rescatar transacciones del archivo.
                    </p>
                  ) : null}
                  {pendingReviewSummary.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-purple-200/80">
                        Te queda por revisar
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {pendingReviewSummary.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/60 dark:text-neutral-100"
                          >
                            {item.label}: {item.value}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
          <h2 className="font-display text-3xl text-finance-ink">Cargar movimiento</h2>
          <div className="mt-6 grid gap-4">
            <select
              value={manualForm.entry_type}
              onChange={(e) => setManualForm((p) => ({ ...p, entry_type: e.target.value, target_account_id: "", target_amount: "", fee_amount: "" }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
              <option value="internal_transfer">Transferencia interna (compra/venta de moneda)</option>
            </select>
            <input
              type="date"
              value={manualForm.fecha}
              onChange={(e) => setManualForm((p) => ({ ...p, fecha: e.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              required
            />
            <input
              type="text"
              placeholder={manualForm.entry_type === "internal_transfer" ? "Descripción (ej: Compra dólares)" : "Descripción (obligatoria)"}
              value={manualForm.desc_banco}
              onChange={(e) => setManualForm((p) => ({ ...p, desc_banco: e.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                placeholder={manualForm.entry_type === "income" ? "Monto ingresado" : "Monto"}
                value={manualForm.monto}
                onChange={(e) => setManualForm((p) => ({ ...p, monto: e.target.value }))}
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                required
              />
              <select
                value={manualForm.moneda}
                onChange={(e) => setManualForm((p) => ({ ...p, moneda: e.target.value }))}
                disabled={Boolean(selectedAccountData)}
                title={selectedAccountData ? "La moneda queda fijada por la cuenta seleccionada." : undefined}
                className="rounded-2xl border border-neutral-200 px-4 py-3 disabled:bg-neutral-100 disabled:text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:disabled:bg-neutral-800/60"
              >
                {SUPPORTED_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
            </div>
            {selectedAccountData && (
              <p className="text-xs text-neutral-500">
                La moneda se toma de la cuenta seleccionada: <strong>{selectedAccountData.currency}</strong>. Para cargar otra moneda, cambiá de cuenta.
              </p>
            )}
            {manualForm.entry_type === "internal_transfer" && (() => {
              const linkedOptions = selectedAccountData?.linked_accounts || [];
              return (
                <>
                  <select
                    value={manualForm.target_account_id}
                    onChange={(e) => setManualForm((p) => ({ ...p, target_account_id: e.target.value }))}
                    className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <option value="">Cuenta destino</option>
                    {linkedOptions.map((a) => (
                      <option key={a.account_id} value={a.account_id}>{a.account_name} ({a.currency})</option>
                    ))}
                  </select>
                  {selectedAccount && linkedOptions.length === 0 && (
                    <p className="text-sm text-amber-600">La cuenta origen no tiene cuentas vinculadas. Vinculalas primero en la sección de accounts.</p>
                  )}
                  <input
                    type="number"
                    placeholder="Monto acreditado en destino (opcional si igual)"
                    value={manualForm.target_amount}
                    onChange={(e) => setManualForm((p) => ({ ...p, target_amount: e.target.value }))}
                    className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <input
                    type="number"
                    placeholder="Comisión bancaria (opcional)"
                    value={manualForm.fee_amount}
                    onChange={(e) => setManualForm((p) => ({ ...p, fee_amount: e.target.value }))}
                    className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                </>
              );
            })()}
            <button data-testid="manual-transaction-submit" className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white transition hover:opacity-90 dark:bg-white dark:text-finance-ink">
              Guardar transacción
            </button>
          </div>
        </form>
      </div>

      {/* CSV / paste import */}
      <CsvImportPanel
        selectedAccount={selectedAccount}
        selectedCurrency={selectedAccountData?.currency || "UYU"}
        month={uploadForm.period}
        onImported={(result) => {
          const pendingCount = Number(result?.remaining_transaction_ids?.length || 0);
          setFeedback({
            new_transactions: result?.created || 0,
            duplicates_skipped: result?.duplicates || 0,
            auto_categorized: Math.max(Number(result?.created || 0) - pendingCount, 0),
            pending_review: pendingCount,
            parser: "csv",
            extracted_candidates: result?.created || 0,
            unmatched_count: 0,
          });
          applyImportReviewState(result);
          load();
          const hasGuided = Boolean(result?.guided_onboarding_required && (result?.guided_review_groups || []).length > 0);
          const hasReviewGroups = (result?.review_groups || []).length > 0;
          const hasTransactionQueue = (result?.transaction_review_queue || []).length > 0;
          if (!hasGuided && !hasReviewGroups && !hasTransactionQueue) {
            onDone?.();
          }
        }}
      />

      {/* Upload history */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Historial de uploads</p>
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div data-testid={`upload-history-${item.id}`} key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-finance-cream/75 px-4 py-4 dark:bg-neutral-800/75">
              <div>
                <p className="font-semibold text-finance-ink">{item.original_filename || item.filename}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {item.parser ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      {formatUploadParser(item.parser)}
                    </span>
                  ) : null}
                  {item.detected_format ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      {item.detected_format}
                    </span>
                  ) : null}
                  {item.ai_assisted ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      AI assist
                    </span>
                  ) : null}
                  {Number(item.pending_review_count || 0) > 0 ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      Pendientes: {Number(item.pending_review_count)}
                    </span>
                  ) : null}
                  {Number(item.auto_categorized_count || 0) > 0 ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      Auto: {Number(item.auto_categorized_count)}
                    </span>
                  ) : null}
                  {Number(item.duplicates_skipped || 0) > 0 ? (
                    <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900/70 dark:text-neutral-100">
                      Duplicados: {Number(item.duplicates_skipped)}
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-neutral-500">{item.account_name || "Sin cuenta"} · {item.period} · {item.tx_count} transacciones</p>
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-semibold ${uploadStatusTone(item.status)}`}>
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
