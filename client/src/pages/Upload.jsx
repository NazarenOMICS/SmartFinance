import { useEffect, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { api } from "../api";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).href;

async function extractPdfText(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const lineMap = {};
    content.items.forEach((item) => {
      const y = Math.round(item.transform[5]);
      lineMap[y] = (lineMap[y] || "") + item.str + " ";
    });
    const lines = Object.keys(lineMap).sort((a, b) => b - a).map((k) => lineMap[k].trim());
    text += lines.join("\n") + "\n";
  }
  return text;
}

export default function Upload({ month }) {
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [parsing, setParsing] = useState(false);

  // Account must be selected FIRST — drives both upload and manual forms
  const [selectedAccount, setSelectedAccount] = useState("");

  const [uploadForm, setUploadForm] = useState({ file: null, period: month });
  const [manualForm, setManualForm] = useState({ fecha: `${month}-01`, desc_banco: "", monto: "", moneda: "UYU" });

  async function load() {
    setLoading(true);
    try {
      const [nextAccounts, nextHistory] = await Promise.all([api.getAccounts(), api.getUploads()]);
      setAccounts(nextAccounts);
      setHistory(nextHistory);
      if (!selectedAccount && nextAccounts.length === 1) setSelectedAccount(nextAccounts[0].id);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUploadForm((prev) => ({ ...prev, period: month }));
    setManualForm((prev) => ({ ...prev, fecha: `${month}-01` }));
    load();
  }, [month]);

  // Sync manual form currency to the selected account's currency
  useEffect(() => {
    const acc = accounts.find((a) => a.id === selectedAccount);
    if (acc) setManualForm((prev) => ({ ...prev, moneda: acc.currency }));
  }, [selectedAccount, accounts]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!selectedAccount) { setError("Primero elegí la cuenta de origen."); return; }
    if (!uploadForm.file) { setError("Seleccioná un archivo."); return; }
    setError(""); setFeedback(null);

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
        setError(`Error al leer el PDF: ${e.message}`);
        setParsing(false);
        return;
      }
      setParsing(false);
    } else {
      formData.append("file", file);
    }

    try {
      const result = await api.uploadFile(formData);
      setFeedback(result);
      setUploadForm((prev) => ({ ...prev, file: null }));
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    if (!selectedAccount) { setError("Primero elegí la cuenta de origen."); return; }
    if (!manualForm.desc_banco.trim()) { setError("Ingresá una descripción."); return; }
    if (!manualForm.monto) { setError("Ingresá un monto."); return; }
    setError("");
    try {
      await api.createTransaction({ ...manualForm, monto: Number(manualForm.monto), account_id: selectedAccount });
      setManualForm((prev) => ({ ...prev, desc_banco: "", monto: "" }));
      setManualSuccess(true);
      setTimeout(() => setManualSuccess(false), 3000);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount);

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-3xl bg-finance-redSoft p-4 text-finance-red">{error}</div> : null}

      {/* STEP 1: Choose account first */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
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
                  ? "border-finance-purple bg-finance-purpleSoft"
                  : "border-neutral-200 hover:border-finance-purple/40"
              }`}
            >
              <p className="font-semibold text-finance-ink">{acc.name}</p>
              <p className="text-xs text-neutral-400">{acc.currency}</p>
            </button>
          ))}
        </div>
      </div>

      {/* STEP 2: Upload or manual — only active once account is selected */}
      <div className={`grid gap-6 lg:grid-cols-[1fr_0.95fr] transition-opacity ${!selectedAccount ? "pointer-events-none opacity-40" : ""}`}>
        {/* Upload PDF */}
        <form onSubmit={handleUpload} className="rounded-[32px] border border-dashed border-finance-purple/30 bg-white/85 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">
            Paso 2a — Subir resumen
            {selectedAccountData ? <span className="ml-2 font-semibold text-finance-purple">({selectedAccountData.name})</span> : null}
          </p>
          <h2 className="font-display text-3xl text-finance-ink">PDF o imagen</h2>
          <div className="mt-6 space-y-4">
            <input
              type="file"
              accept=".pdf,image/*,.txt,.csv"
              onChange={(e) => setUploadForm((prev) => ({ ...prev, file: e.target.files?.[0] || null }))}
            />
            {uploadForm.file?.name.toLowerCase().endsWith(".pdf") && (
              <p className="text-xs text-finance-teal">PDF detectado — el texto se extrae en tu navegador antes de subir.</p>
            )}
            <input
              type="month"
              value={uploadForm.period}
              onChange={(e) => setUploadForm((prev) => ({ ...prev, period: e.target.value }))}
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3"
            />
            <button
              disabled={parsing || !selectedAccount}
              className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white disabled:opacity-60"
            >
              {parsing ? "Leyendo PDF…" : "Procesar archivo"}
            </button>
          </div>
          {feedback ? (
            <div className="mt-6 rounded-3xl bg-finance-purpleSoft p-4 text-sm text-finance-ink space-y-1">
              <p className="font-semibold">Procesado correctamente</p>
              <p>Nuevas: {feedback.new_transactions}</p>
              <p>Duplicados salteados: {feedback.duplicates_skipped}</p>
              <p>Auto-categorizadas: {feedback.auto_categorized}</p>
              <p>Pendientes de categorizar: {feedback.pending_review}</p>
            </div>
          ) : null}
        </form>

        {/* Manual entry */}
        <form onSubmit={handleManualSubmit} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
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
              className="rounded-2xl border border-neutral-200 px-4 py-3"
              required
            />
            <input
              type="text"
              placeholder="Descripción (obligatoria)"
              value={manualForm.desc_banco}
              onChange={(e) => setManualForm((p) => ({ ...p, desc_banco: e.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3"
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                placeholder="Monto (negativo = gasto)"
                value={manualForm.monto}
                onChange={(e) => setManualForm((p) => ({ ...p, monto: e.target.value }))}
                className="rounded-2xl border border-neutral-200 px-4 py-3"
                required
              />
              <select
                value={manualForm.moneda}
                onChange={(e) => setManualForm((p) => ({ ...p, moneda: e.target.value }))}
                className="rounded-2xl border border-neutral-200 px-4 py-3"
              >
                <option value="UYU">UYU</option>
                <option value="USD">USD</option>
                <option value="ARS">ARS</option>
              </select>
            </div>
            <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">
              Guardar transacción
            </button>
            {manualSuccess && (
              <p className="rounded-2xl bg-finance-tealSoft px-4 py-3 text-sm font-semibold text-finance-teal text-center">
                ✓ Transacción guardada correctamente
              </p>
            )}
          </div>
        </form>
      </div>

      {/* Upload history */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Historial de uploads</p>
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-finance-cream/75 px-4 py-4">
              <div>
                <p className="font-semibold text-finance-ink">{item.filename}</p>
                <p className="text-sm text-neutral-500">{item.account_name || "Sin cuenta"} · {item.period} · {item.tx_count} transacciones</p>
              </div>
              <span className="rounded-full bg-finance-tealSoft px-3 py-1 text-sm font-semibold text-finance-teal">{item.status}</span>
            </div>
          ))}
          {!loading && history.length === 0 ? <p className="text-neutral-500">No hay uploads para este período.</p> : null}
        </div>
      </div>
    </div>
  );
}
