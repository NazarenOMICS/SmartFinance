import { useEffect, useState } from "react";
import { api } from "../api";

export default function Upload({ month }) {
  const [accounts, setAccounts] = useState([]);
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadForm, setUploadForm] = useState({ file: null, account_id: "", period: month });
  const [manualForm, setManualForm] = useState({ fecha: `${month}-01`, desc_banco: "", monto: "", moneda: "UYU", account_id: "" });

  async function load() {
    setLoading(true);
    try {
      const [nextAccounts, nextHistory] = await Promise.all([api.getAccounts(), api.getUploads(month)]);
      setAccounts(nextAccounts);
      setHistory(nextHistory);
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUploadForm((prev) => ({ ...prev, period: month }));
    setManualForm((prev) => ({ ...prev, fecha: `${month}-01` }));
    load();
  }, [month]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!uploadForm.file || !uploadForm.account_id) {
      setError("Elegí un archivo y una cuenta.");
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadForm.file);
    formData.append("account_id", uploadForm.account_id);
    formData.append("period", uploadForm.period);

    try {
      const result = await api.uploadFile(formData);
      setFeedback(result);
      setError("");
      setUploadForm((prev) => ({ ...prev, file: null }));
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();
    try {
      await api.createTransaction({
        ...manualForm,
        monto: Number(manualForm.monto)
      });
      setManualForm({ fecha: `${month}-01`, desc_banco: "", monto: "", moneda: "UYU", account_id: "" });
      setError("");
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-3xl bg-finance-redSoft p-4 text-finance-red">{error}</div> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <form onSubmit={handleUpload} className="rounded-[32px] border border-dashed border-finance-purple/30 bg-white/85 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Carga asistida</p>
          <h2 className="font-display text-3xl text-finance-ink">Subir PDF o imagen</h2>
          <div className="mt-6 space-y-4">
            <input type="file" accept=".pdf,image/*" onChange={(event) => setUploadForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))} />
            <select
              value={uploadForm.account_id}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, account_id: event.target.value }))}
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3"
            >
              <option value="">Seleccionar cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
            <input
              type="month"
              value={uploadForm.period}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, period: event.target.value }))}
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3"
            />
            <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Procesar archivo</button>
          </div>
          {feedback ? (
            <div className="mt-6 rounded-3xl bg-finance-purpleSoft p-4 text-sm text-finance-ink">
              <p>Nuevas: {feedback.new_transactions}</p>
              <p>Duplicados salteados: {feedback.duplicates_skipped}</p>
              <p>Auto-categorizadas: {feedback.auto_categorized}</p>
              <p>Pendientes: {feedback.pending_review}</p>
            </div>
          ) : null}
        </form>

        <form onSubmit={handleManualSubmit} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Fallback manual</p>
          <h2 className="font-display text-3xl text-finance-ink">Cargar transacción</h2>
          <div className="mt-6 grid gap-4">
            <input type="date" value={manualForm.fecha} onChange={(event) => setManualForm((prev) => ({ ...prev, fecha: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3" />
            <input type="text" placeholder="Descripción" value={manualForm.desc_banco} onChange={(event) => setManualForm((prev) => ({ ...prev, desc_banco: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3" />
            <input type="number" placeholder="Monto" value={manualForm.monto} onChange={(event) => setManualForm((prev) => ({ ...prev, monto: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3" />
            <select value={manualForm.moneda} onChange={(event) => setManualForm((prev) => ({ ...prev, moneda: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3">
              <option value="UYU">UYU</option>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
            <select value={manualForm.account_id} onChange={(event) => setManualForm((prev) => ({ ...prev, account_id: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3">
              <option value="">Cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">Guardar manualmente</button>
          </div>
        </form>
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Historial</p>
        <h2 className="font-display text-3xl text-finance-ink">Uploads del período</h2>
        {loading ? <p className="mt-4 text-neutral-500">Cargando uploads…</p> : null}
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-finance-cream/75 px-4 py-4">
              <div>
                <p className="font-semibold text-finance-ink">{item.filename}</p>
                <p className="text-sm text-neutral-500">
                  {item.account_name || "Sin cuenta"} · {item.period} · {item.tx_count} transacciones
                </p>
              </div>
              <span className="rounded-full bg-finance-tealSoft px-3 py-1 text-sm font-semibold text-finance-teal">{item.status}</span>
            </div>
          ))}
          {!loading && history.length === 0 ? <p className="text-neutral-500">Todavía no hay archivos para este período.</p> : null}
        </div>
      </div>
    </div>
  );
}
