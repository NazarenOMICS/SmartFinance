import { useEffect, useState } from "react";
import { api } from "../api";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

export default function Installments({ month }) {
  const [state, setState] = useState({ loading: true, error: "", installments: [], commitments: [] });
  const [accounts, setAccounts] = useState([]);
  const [form, setForm] = useState({ descripcion: "", monto_total: "", cantidad_cuotas: "", account_id: "", start_month: month });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [installments, commitments, nextAccounts] = await Promise.all([
        api.getInstallments(),
        api.getCommitments(month, 6),
        api.getAccounts()
      ]);
      setAccounts(nextAccounts);
      setState({ loading: false, error: "", installments, commitments });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setForm((prev) => ({ ...prev, start_month: month }));
    load();
  }, [month]);

  async function handleCreate(event) {
    event.preventDefault();
    await api.createInstallment({
      ...form,
      monto_total: Number(form.monto_total),
      cantidad_cuotas: Number(form.cantidad_cuotas)
    });
    setForm({ descripcion: "", monto_total: "", cantidad_cuotas: "", account_id: "", start_month: month });
    await load();
  }

  async function handleDelete(id) {
    await api.deleteInstallment(id);
    await load();
  }

  async function handleUpdate(id, cuotaActual) {
    await api.updateInstallment(id, { cuota_actual: Number(cuotaActual) });
    await load();
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando cuotas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;

  const totalMonth = state.commitments[0]?.total || 0;
  const remainingDebt = state.installments.reduce(
    (sum, item) => sum + item.monto_cuota * Math.max(0, item.cantidad_cuotas - item.cuota_actual + 1),
    0
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Cuotas del mes" value={fmtMoney(totalMonth)} tone="text-finance-amber" />
        <MetricCard label="Deuda restante" value={fmtMoney(remainingDebt)} tone="text-finance-red" />
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <div className="grid grid-cols-[1.2fr_120px_120px_120px_140px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span>Descripción</span>
          <span>Total</span>
          <span>Cuota</span>
          <span>Monto/mes</span>
          <span>Cuenta</span>
          <span>Acción</span>
        </div>
        <div className="divide-y divide-neutral-100">
          {state.installments.map((item) => (
            <div key={item.id} className="grid grid-cols-[1.2fr_120px_120px_120px_140px_80px] gap-4 py-4">
              <span className="font-semibold text-finance-ink">{item.descripcion}</span>
              <span>{fmtMoney(item.monto_total)}</span>
              <input className="rounded-xl border border-neutral-200 px-3 py-2" type="number" value={item.cuota_actual} onChange={(event) => handleUpdate(item.id, event.target.value)} />
              <span>{fmtMoney(item.monto_cuota)}</span>
              <span className="text-neutral-500">{item.account_name || "—"}</span>
              <button onClick={() => handleDelete(item.id)} className="text-finance-red">
                Borrar
              </button>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleCreate} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva compra</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_140px_120px_180px_140px_auto]">
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" placeholder="Descripción" value={form.descripcion} onChange={(event) => setForm((prev) => ({ ...prev, descripcion: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" type="number" placeholder="Monto total" value={form.monto_total} onChange={(event) => setForm((prev) => ({ ...prev, monto_total: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" type="number" placeholder="Cuotas" value={form.cantidad_cuotas} onChange={(event) => setForm((prev) => ({ ...prev, cantidad_cuotas: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={form.account_id} onChange={(event) => setForm((prev) => ({ ...prev, account_id: event.target.value }))}>
            <option value="">Cuenta</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" type="month" value={form.start_month} onChange={(event) => setForm((prev) => ({ ...prev, start_month: event.target.value }))} />
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>
    </div>
  );
}

