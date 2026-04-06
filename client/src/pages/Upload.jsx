import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

function buildInitialManualForm(month) {
  return {
    entry_type: "expense",
    fecha: `${month}-01`,
    desc_banco: "",
    monto: "",
    moneda: "UYU",
    account_id: "",
    target_account_id: "",
    target_amount: "",
    fee_amount: ""
  };
}

function buildInitialUploadForm(month) {
  return {
    file: null,
    account_id: "",
    period: month,
    statement_currency: "UYU"
  };
}

export default function Upload({ month, dataVersion, invalidateData }) {
  const [accounts, setAccounts] = useState([]);
  const [links, setLinks] = useState([]);
  const [history, setHistory] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadForm, setUploadForm] = useState(buildInitialUploadForm(month));
  const [manualForm, setManualForm] = useState(buildInitialManualForm(month));
  const [linkForm, setLinkForm] = useState({ account_a_id: "", account_b_id: "" });
  const [linkMessage, setLinkMessage] = useState("");

  const accountMap = useMemo(() => {
    return accounts.reduce((acc, account) => {
      acc[account.id] = account;
      return acc;
    }, {});
  }, [accounts]);

  const uploadAccount = uploadForm.account_id ? accountMap[uploadForm.account_id] : null;
  const uploadCurrencyMismatch = Boolean(uploadAccount && uploadForm.statement_currency && uploadAccount.currency !== uploadForm.statement_currency);
  const linkedDestinationOptions = manualForm.account_id ? accountMap[manualForm.account_id]?.linked_accounts || [] : [];
  const uploadSubmitDisabled = !uploadForm.file || !uploadForm.account_id || !uploadForm.period || uploadCurrencyMismatch;
  const transferSubmitDisabled =
    manualForm.entry_type === "internal_transfer" &&
    (!manualForm.account_id || linkedDestinationOptions.length === 0 || !manualForm.target_account_id);

  async function load() {
    setLoading(true);
    try {
      const [nextAccounts, nextHistory, nextLinks] = await Promise.all([api.getAccounts(), api.getUploads(month), api.getAccountLinks()]);
      setAccounts(nextAccounts);
      setHistory(nextHistory);
      setLinks(nextLinks);
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUploadForm((prev) => ({ ...prev, period: month }));
    setManualForm(buildInitialManualForm(month));
  }, [month]);

  useEffect(() => {
    load();
  }, [month, dataVersion]);

  async function handleUpload(event) {
    event.preventDefault();
    if (!uploadForm.file || !uploadForm.account_id) {
      setError("Elegi un archivo y una cuenta.");
      return;
    }

    const formData = new FormData();
    formData.append("file", uploadForm.file);
    formData.append("account_id", uploadForm.account_id);
    formData.append("period", uploadForm.period);
    formData.append("statement_currency", uploadForm.statement_currency);

    try {
      const result = await api.uploadFile(formData);
      setFeedback(result);
      setError("");
      setUploadForm((prev) => ({ ...prev, file: null }));
      invalidateData();
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
        monto: Number(manualForm.monto),
        target_amount: manualForm.target_amount ? Number(manualForm.target_amount) : undefined,
        fee_amount: manualForm.fee_amount ? Number(manualForm.fee_amount) : undefined
      });
      setManualForm(buildInitialManualForm(month));
      setError("");
      setFeedback(null);
      invalidateData();
      await load();
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function handleCreateLink(event) {
    event.preventDefault();
    try {
      await api.createAccountLink(linkForm);
      setLinkForm({ account_a_id: "", account_b_id: "" });
      setLinkMessage("Cuentas vinculadas correctamente. Ya podes usar transferencias internas o subir el resumen correcto.");
      invalidateData();
      await load();
    } catch (nextError) {
      setLinkMessage(nextError.message);
    }
  }

  async function handleCreateLinkAndReconcile(event) {
    event.preventDefault();
    try {
      const created = await api.createAccountLink(linkForm);
      const reconciliation = await api.reconcileAccountLink(created.id, { month });
      setLinkForm({ account_a_id: "", account_b_id: "" });
      setLinkMessage(`Cuentas vinculadas y conciliadas. ${reconciliation.reconciled_pairs} pares pasaron a transferencia interna en ${month}.`);
      invalidateData();
      await load();
    } catch (nextError) {
      setLinkMessage(nextError.message);
    }
  }

  async function handleReconcileLink(linkId) {
    try {
      const reconciliation = await api.reconcileAccountLink(linkId, { month });
      setLinkMessage(`Se conciliaron ${reconciliation.reconciled_pairs} pares en ${month}.`);
      invalidateData();
      await load();
    } catch (nextError) {
      setLinkMessage(nextError.message);
    }
  }

  function handleManualAccountChange(accountId) {
    const account = accountMap[accountId];
    setManualForm((prev) => ({
      ...prev,
      account_id: accountId,
      moneda: account?.currency || prev.moneda,
      target_account_id: "",
      target_amount: "",
      fee_amount: prev.entry_type === "internal_transfer" ? prev.fee_amount : ""
    }));
  }

  function handleUploadAccountChange(accountId) {
    const account = accountMap[accountId];
    setUploadForm((prev) => ({
      ...prev,
      account_id: accountId,
      statement_currency: account?.currency || prev.statement_currency
    }));
  }

  return (
    <div className="space-y-6">
      {error ? <div className="rounded-3xl bg-finance-redSoft p-4 text-finance-red">{error}</div> : null}

      <div className="rounded-[32px] border border-finance-purple/15 bg-white/92 p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 1</p>
            <h2 className="font-display text-3xl text-finance-ink">Vincular cuentas para compra de moneda</h2>
            <p className="mt-2 max-w-3xl text-sm text-neutral-500">
              Si vas a mover plata entre una cuenta en UYU y otra en USD, hace el link antes de subir o categorizar. Asi la app lo entiende como transferencia interna y no como gasto o ingreso.
            </p>
          </div>
          <div className="rounded-2xl bg-finance-purpleSoft px-4 py-3 text-sm text-finance-ink">
            <p className="font-semibold">{links.length} links activos</p>
            <p className="text-neutral-500">Solo los pares vinculados aparecen como destino en transferencias internas.</p>
          </div>
        </div>

        {linkMessage ? <p className="mt-4 rounded-2xl bg-finance-cream/80 px-4 py-3 text-sm text-finance-ink">{linkMessage}</p> : null}

        <div className="mt-5 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <form onSubmit={handleCreateLink} className="rounded-[28px] border border-white/70 bg-finance-cream/45 p-5">
            <div className="grid gap-4 md:grid-cols-[1fr_1fr]">
              <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={linkForm.account_a_id} onChange={(event) => setLinkForm((prev) => ({ ...prev, account_a_id: event.target.value }))}>
                <option value="">Cuenta A</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name} ({account.currency})
                  </option>
                ))}
              </select>
              <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={linkForm.account_b_id} onChange={(event) => setLinkForm((prev) => ({ ...prev, account_b_id: event.target.value }))}>
                <option value="">Cuenta B</option>
                {accounts
                  .filter((account) => account.id !== linkForm.account_a_id)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} ({account.currency})
                    </option>
                  ))}
              </select>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Linkear</button>
              <button type="button" onClick={handleCreateLinkAndReconcile} className="rounded-full border border-finance-purple/30 px-5 py-3 font-semibold text-finance-purple">
                Linkear y conciliar este mes
              </button>
            </div>
          </form>

          <div className="rounded-[28px] border border-white/70 bg-finance-cream/45 p-5">
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Pares disponibles</p>
            <div className="mt-4 space-y-3">
              {links.length === 0 ? <p className="text-sm text-neutral-500">Todavia no hay cuentas vinculadas.</p> : null}
              {links.map((link) => (
                <div key={link.id} className="rounded-2xl bg-white/80 px-4 py-3">
                  <p className="font-semibold text-finance-ink">
                    {link.account_a_name} ({link.account_a_currency}) {"<->"} {link.account_b_name} ({link.account_b_currency})
                  </p>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-neutral-500">{link.relation_type}</p>
                    <button type="button" onClick={() => handleReconcileLink(link.id)} className="rounded-full border border-finance-ink/10 px-3 py-1 text-xs font-semibold text-finance-ink">
                      Conciliar {month}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <form onSubmit={handleUpload} className="rounded-[32px] border border-dashed border-finance-purple/30 bg-white/85 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 2</p>
          <h2 className="font-display text-3xl text-finance-ink">Subir PDF o imagen</h2>
          <div className="mt-6 space-y-4">
            <input type="file" accept=".pdf,image/*" onChange={(event) => setUploadForm((prev) => ({ ...prev, file: event.target.files?.[0] || null }))} />
            <select value={uploadForm.account_id} onChange={(event) => handleUploadAccountChange(event.target.value)} className="w-full rounded-2xl border border-neutral-200 px-4 py-3">
              <option value="">Seleccionar cuenta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
            <select
              value={uploadForm.statement_currency}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, statement_currency: event.target.value }))}
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3"
            >
              <option value="UYU">Resumen en UYU</option>
              <option value="USD">Resumen en USD</option>
              <option value="ARS">Resumen en ARS</option>
            </select>
            {uploadCurrencyMismatch ? (
              <div className="rounded-2xl bg-finance-redSoft px-4 py-3 text-sm text-finance-red">
                La cuenta elegida es {uploadAccount.currency} pero el resumen esta marcado como {uploadForm.statement_currency}. Revisa la cuenta o la moneda antes de procesarlo.
              </div>
            ) : null}
            <input
              type="month"
              value={uploadForm.period}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, period: event.target.value }))}
              className="w-full rounded-2xl border border-neutral-200 px-4 py-3"
            />
            <button disabled={uploadSubmitDisabled} className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              Procesar archivo
            </button>
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
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Paso 3</p>
          <h2 className="font-display text-3xl text-finance-ink">Cargar movimiento</h2>
          <div className="mt-6 grid gap-4">
            <select
              value={manualForm.entry_type}
              onChange={(event) => setManualForm((prev) => ({ ...prev, entry_type: event.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3"
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
              <option value="internal_transfer">Transferencia interna</option>
            </select>
            <input type="date" value={manualForm.fecha} onChange={(event) => setManualForm((prev) => ({ ...prev, fecha: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3" />
            <input
              type="text"
              placeholder={manualForm.entry_type === "internal_transfer" ? "Descripcion de la compra/venta de moneda" : "Descripcion"}
              value={manualForm.desc_banco}
              onChange={(event) => setManualForm((prev) => ({ ...prev, desc_banco: event.target.value }))}
              className="rounded-2xl border border-neutral-200 px-4 py-3"
            />
            <select value={manualForm.account_id} onChange={(event) => handleManualAccountChange(event.target.value)} className="rounded-2xl border border-neutral-200 px-4 py-3">
              <option value="">Cuenta origen</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
            <input type="number" placeholder={manualForm.entry_type === "income" ? "Monto ingresado" : "Monto"} value={manualForm.monto} onChange={(event) => setManualForm((prev) => ({ ...prev, monto: event.target.value }))} className="rounded-2xl border border-neutral-200 px-4 py-3" />
            <input className="rounded-2xl border border-neutral-200 px-4 py-3 text-neutral-500" value={manualForm.moneda} readOnly />

            {manualForm.entry_type === "internal_transfer" ? (
              <>
                <select
                  value={manualForm.target_account_id}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, target_account_id: event.target.value }))}
                  className="rounded-2xl border border-neutral-200 px-4 py-3"
                >
                  <option value="">Cuenta destino</option>
                  {linkedDestinationOptions.map((account) => (
                    <option key={account.account_id} value={account.account_id}>
                      {account.account_name} ({account.currency})
                    </option>
                  ))}
                </select>
                {manualForm.account_id && linkedDestinationOptions.length === 0 ? (
                  <p className="text-sm text-finance-amber">La cuenta origen no tiene links fx_pair; primero vinculala arriba antes de registrar la compra de moneda.</p>
                ) : null}
                <input
                  type="number"
                  placeholder="Monto acreditado en destino"
                  value={manualForm.target_amount}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, target_amount: event.target.value }))}
                  className="rounded-2xl border border-neutral-200 px-4 py-3"
                />
                <input
                  type="number"
                  placeholder="Comision opcional"
                  value={manualForm.fee_amount}
                  onChange={(event) => setManualForm((prev) => ({ ...prev, fee_amount: event.target.value }))}
                  className="rounded-2xl border border-neutral-200 px-4 py-3"
                />
              </>
            ) : null}

            <button disabled={transferSubmitDisabled} className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              Guardar manualmente
            </button>
          </div>
        </form>
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Historial</p>
        <h2 className="font-display text-3xl text-finance-ink">Uploads del periodo</h2>
        {loading ? <p className="mt-4 text-neutral-500">Cargando uploads...</p> : null}
        <div className="mt-5 space-y-3">
          {history.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-finance-cream/75 px-4 py-4">
              <div>
                <p className="font-semibold text-finance-ink">{item.filename}</p>
                <p className="text-sm text-neutral-500">
                  {item.account_name || "Sin cuenta"} - {item.period} - {item.tx_count} transacciones
                </p>
              </div>
              <span className="rounded-full bg-finance-tealSoft px-3 py-1 text-sm font-semibold text-finance-teal">{item.status}</span>
            </div>
          ))}
          {!loading && history.length === 0 ? <p className="text-neutral-500">Todavia no hay archivos para este periodo.</p> : null}
        </div>
      </div>
    </div>
  );
}
