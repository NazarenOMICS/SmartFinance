import { useEffect, useState } from "react";
import { api } from "../api";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

function useConfirm() {
  const [pending, setPending] = useState(null);
  function ask(id) { setPending(id); }
  function clear() { setPending(null); }
  return { pending, ask, clear };
}

export default function Accounts({ settings, refreshSettings, onAccountDeleted }) {
  const [state, setState] = useState({ loading: true, error: "", accounts: [], consolidated: null });
  const [localBalances, setLocalBalances] = useState({});
  const [newAccount, setNewAccount] = useState({ id: "", name: "", currency: "UYU", balance: "" });
  const [deleteError, setDeleteError] = useState(null);
  const confirm = useConfirm();

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [accounts, consolidated] = await Promise.all([api.getAccounts(), api.getConsolidatedAccounts()]);
      setState({ loading: false, error: "", accounts, consolidated });
      const map = {};
      accounts.forEach((a) => { map[a.id] = String(a.balance); });
      setLocalBalances(map);
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    load();
  }, [settings.display_currency, settings.exchange_rate_usd_uyu]);

  async function handleBalanceBlur(id) {
    const balance = Number(localBalances[id] ?? 0);
    await api.updateAccount(id, { balance });
    await load();
  }

  async function handleCreate(event) {
    event.preventDefault();
    await api.createAccount({ ...newAccount, balance: Number(newAccount.balance || 0) });
    setNewAccount({ id: "", name: "", currency: "UYU", balance: "" });
    await load();
  }

  async function handleDeleteAccount(id, force = false) {
    setDeleteError(null);
    try {
      await api.deleteAccount(id, force);
      confirm.clear();
      await load();
      onAccountDeleted?.();
    } catch (e) {
      if (e.message.includes("transacciones")) {
        setDeleteError({ id, message: e.message });
      } else {
        setDeleteError({ id, message: e.message });
      }
    }
  }

  async function handleSetting(key, value) {
    await api.updateSetting(key, value);
    await refreshSettings();
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando cuentas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Patrimonio consolidado" value={fmtMoney(state.consolidated.total, state.consolidated.currency)} tone="text-finance-purple" />
        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Preferencias</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input
              className="rounded-2xl border border-neutral-200 px-4 py-3"
              value={settings.exchange_rate_usd_uyu || "42.5"}
              onChange={(event) => handleSetting("exchange_rate_usd_uyu", event.target.value)}
            />
            <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={settings.display_currency || "UYU"} onChange={(event) => handleSetting("display_currency", event.target.value)}>
              <option value="UYU">UYU</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span>Cuenta</span><span>Moneda</span><span>Balance</span><span>Equiv.</span><span></span>
        </div>
        <div className="divide-y divide-neutral-100">
          {state.accounts.map((account) => (
            <div key={account.id}>
              <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 py-4">
                <span className="font-semibold text-finance-ink">{account.name}</span>
                <span className="text-neutral-500">{account.currency}</span>
                <input
                  className="rounded-xl border border-neutral-200 px-3 py-2"
                  type="number"
                  value={localBalances[account.id] ?? account.balance}
                  onChange={(e) => setLocalBalances((prev) => ({ ...prev, [account.id]: e.target.value }))}
                  onBlur={() => handleBalanceBlur(account.id)}
                />
                <span className="font-semibold text-finance-ink">
                  {fmtMoney(
                    account.currency === "USD" && (settings.display_currency || "UYU") === "UYU"
                      ? account.balance * Number(settings.exchange_rate_usd_uyu || 1)
                      : account.balance,
                    settings.display_currency || account.currency
                  )}
                </span>
                <button
                  onClick={() => confirm.pending === account.id ? handleDeleteAccount(account.id) : confirm.ask(account.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    confirm.pending === account.id
                      ? "bg-finance-red text-white"
                      : "bg-finance-redSoft text-finance-red hover:bg-finance-red hover:text-white"
                  }`}
                >
                  {confirm.pending === account.id ? "¿Seguro?" : "Borrar"}
                </button>
              </div>
              {deleteError?.id === account.id && (
                <div className="mb-3 rounded-2xl bg-finance-amberSoft px-4 py-3 text-sm text-finance-ink">
                  <p>{deleteError.message}</p>
                  <button
                    onClick={() => handleDeleteAccount(account.id, true)}
                    className="mt-2 rounded-full bg-finance-red px-4 py-1.5 text-xs font-semibold text-white"
                  >
                    Borrar cuenta y todas sus transacciones
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleCreate} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva cuenta</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[120px_1fr_100px_140px_auto]">
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" placeholder="id" value={newAccount.id} onChange={(event) => setNewAccount((prev) => ({ ...prev, id: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" placeholder="Nombre" value={newAccount.name} onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={newAccount.currency} onChange={(event) => setNewAccount((prev) => ({ ...prev, currency: event.target.value }))}>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" type="number" placeholder="Balance" value={newAccount.balance} onChange={(event) => setNewAccount((prev) => ({ ...prev, balance: event.target.value }))} />
          <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>
    </div>
  );
}
