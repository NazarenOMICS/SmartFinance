import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import MetricCard from "../components/MetricCard";
import { convertCurrencyAmount, fmtMoney, getExchangeRateMap } from "../utils";

export default function Installments({ month }) {
  const { addToast } = useToast();
  const [state, setState] = useState({
    loading: true,
    error: "",
    installments: [],
    commitments: [],
    settings: null
  });
  const [localCuotas, setLocalCuotas] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ descripcion: "", monto_total: "", cantidad_cuotas: "", account_id: "", start_month: month });
  const loadRequestIdRef = useRef(0);

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [installments, commitments, nextAccounts, settings] = await Promise.all([
        api.getInstallments(),
        api.getCommitments(month, 6),
        api.getAccounts(),
        api.getSettings()
      ]);
      if (loadRequestIdRef.current !== requestId) return;
      setAccounts(nextAccounts);
      setState({ loading: false, error: "", installments, commitments, settings });
      const map = {};
      installments.forEach((i) => { map[i.id] = String(i.cuota_actual); });
      setLocalCuotas(map);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setForm((prev) => ({ ...prev, start_month: month }));
    load();
  }, [month]);

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.createInstallment({
        ...form,
        monto_total: Number(form.monto_total),
        cantidad_cuotas: Number(form.cantidad_cuotas)
      });
      addToast("success", `Cuota "${form.descripcion}" creada.`);
      setForm({ descripcion: "", monto_total: "", cantidad_cuotas: "", account_id: "", start_month: month });
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleDelete(id) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    const item = state.installments.find((i) => i.id === id);
    setConfirmDelete(null);
    try {
      await api.deleteInstallment(id);
      addToast("info", `Cuota "${item?.descripcion}" eliminada.`);
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleUpdate(id, cuotaActual) {
    const installment = state.installments.find((item) => item.id === id);
    const rawValue = String(cuotaActual ?? "").trim();
    if (!rawValue) {
      setLocalCuotas((prev) => ({ ...prev, [id]: String(installment?.cuota_actual ?? 1) }));
      addToast("warning", "La cuota actual no puede quedar vacia.");
      return;
    }
    const parsedValue = Number(rawValue);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) {
      setLocalCuotas((prev) => ({ ...prev, [id]: String(installment?.cuota_actual ?? 1) }));
      addToast("warning", "Ingresá una cuota actual válida.");
      return;
    }
    try {
      await api.updateInstallment(id, { cuota_actual: parsedValue });
      await load();
    } catch (e) {
      addToast("error", e.message);
      await load();
    }
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Cargando cuotas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  const displayCurrency = state.settings?.display_currency || "UYU";
  const exchangeRates = getExchangeRateMap(state.settings || {});

  // Find THIS month's commitment (not necessarily the first in the array)
  const thisMonthCommitment = state.commitments.find((c) => c.month === month);
  const totalMonth = thisMonthCommitment?.total || 0;
  // cuota_actual represents the current/upcoming installment, so the remaining
  // debt still includes that installment until the user advances it.
  const remainingDebt = state.installments.reduce((sum, item) => {
    const pendingInstallments = Math.max(0, item.cantidad_cuotas - item.cuota_actual + 1);
    return sum + convertCurrencyAmount(
      item.monto_cuota * pendingInstallments,
      item.account_currency || "UYU",
      displayCurrency,
      exchangeRates
    );
  }, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Cuotas del mes" value={fmtMoney(totalMonth, displayCurrency)} tone="text-finance-amber" />
        <MetricCard label="Deuda restante" value={fmtMoney(remainingDebt, displayCurrency)} tone="text-finance-red" />
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="grid grid-cols-[1.2fr_120px_120px_120px_140px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
          <span>Descripción</span>
          <span>Total</span>
          <span>Cuota</span>
          <span>Monto/mes</span>
          <span>Cuenta</span>
          <span>Acción</span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {state.installments.map((item) => (
            <div key={item.id} className="grid grid-cols-[1.2fr_120px_120px_120px_140px_80px] gap-4 py-4">
              <span className="font-semibold text-finance-ink">{item.descripcion}</span>
              <span>{fmtMoney(item.monto_total, item.account_currency || "UYU")}</span>
              <input
                className="rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                type="number"
                value={localCuotas[item.id] ?? item.cuota_actual}
                onChange={(event) => setLocalCuotas((prev) => ({ ...prev, [item.id]: event.target.value }))}
                onBlur={(event) => handleUpdate(item.id, event.target.value)}
              />
              <span>{fmtMoney(item.monto_cuota, item.account_currency || "UYU")}</span>
              <span className="text-neutral-500">{item.account_name || "—"}</span>
              <button onClick={() => handleDelete(item.id)} className="text-finance-red">
                {confirmDelete === item.id ? "¿Confirmar?" : "Borrar"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleCreate} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva compra</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_140px_120px_180px_140px_auto]">
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" placeholder="Descripción" value={form.descripcion} onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" type="number" placeholder="Monto total" value={form.monto_total} onChange={(event) => setForm((prev) => ({ ...prev, monto_total: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" type="number" placeholder="Cuotas" value={form.cantidad_cuotas} onChange={(event) => setForm((prev) => ({ ...prev, cantidad_cuotas: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" value={form.account_id} onChange={(event) => setForm((prev) => ({ ...prev, account_id: event.target.value }))}>
            <option value="">Cuenta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" type="month" value={form.start_month} onChange={(event) => setForm((prev) => ({ ...prev, start_month: event.target.value }))} />
          <button data-testid="installments-create-button" className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>
    </div>
  );
}
