import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

function useConfirm() {
  const [pending, setPending] = useState(null);
  function ask(id) { setPending(id); }
  function clear() { setPending(null); }
  return { pending, ask, clear };
}

export default function Accounts({ settings, refreshSettings, onAccountDeleted }) {
  const { addToast } = useToast();
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
  }, [settings.display_currency, settings.exchange_rate_usd_uyu, settings.exchange_rate_ars_uyu]);

  async function handleBalanceBlur(id) {
    try {
      const balance = Number(localBalances[id] ?? 0);
      await api.updateAccount(id, { balance });
      await load();
    } catch (e) {
      addToast("error", e.message);
      await load();
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    try {
      await api.createAccount({ ...newAccount, balance: Number(newAccount.balance || 0) });
      addToast("success", `Cuenta "${newAccount.name}" creada.`);
      setNewAccount({ id: "", name: "", currency: "UYU", balance: "" });
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
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

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Cargando cuentas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard label="Patrimonio consolidado" value={fmtMoney(state.consolidated.total, state.consolidated.currency)} tone="text-finance-purple" />
        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Preferencias</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">TC USD/UYU</span>
              <input
                type="number"
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={settings.exchange_rate_usd_uyu || "42.5"}
                onChange={(e) => { if (Number(e.target.value) > 0) handleSetting("exchange_rate_usd_uyu", e.target.value); }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">TC ARS/UYU</span>
              <input
                type="number"
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={settings.exchange_rate_ars_uyu || "0.045"}
                onChange={(e) => { if (Number(e.target.value) > 0) handleSetting("exchange_rate_ars_uyu", e.target.value); }}
              />
            </label>
            <select className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" value={settings.display_currency || "UYU"} onChange={(e) => handleSetting("display_currency", e.target.value)}>
              <option value="UYU">Mostrar en UYU</option>
              <option value="USD">Mostrar en USD</option>
              <option value="ARS">Mostrar en ARS</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
          <span>Cuenta</span><span>Moneda</span><span>Balance</span><span>Equiv.</span><span></span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {state.accounts.map((account) => (
            <div key={account.id}>
              <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 py-4">
                <input
                  className="rounded-xl border border-transparent px-2 py-1 font-semibold text-finance-ink hover:border-neutral-200 focus:border-finance-purple focus:outline-none w-full bg-transparent dark:hover:border-neutral-700"
                  defaultValue={account.name}
                  key={account.name}
                  onBlur={async (e) => {
                    const nextName = e.target.value.trim();
                    if (!nextName || nextName === account.name) return;
                    try {
                      await api.updateAccount(account.id, { name: nextName });
                      await load();
                    } catch (error) {
                      addToast("error", error.message);
                      await load();
                    }
                  }}
                />
                <span className="text-neutral-500">{account.currency}</span>
                <input
                  className="rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  type="number"
                  value={localBalances[account.id] ?? account.balance}
                  onChange={(e) => setLocalBalances((prev) => ({ ...prev, [account.id]: e.target.value }))}
                  onBlur={() => handleBalanceBlur(account.id)}
                />
                <span className="font-semibold text-finance-ink">
                  {(() => {
                    const display = settings.display_currency || "UYU";
                    const usdRate = Number(settings.exchange_rate_usd_uyu || 1);
                    const arsRate = Number(settings.exchange_rate_ars_uyu || 0.045);
                    if (account.currency === display) return fmtMoney(account.balance, display);
                    let inUYU = account.balance;
                    if (account.currency === "USD") inUYU = account.balance * usdRate;
                    else if (account.currency === "ARS") inUYU = account.balance * arsRate;
                    const equiv =
                      display === "USD" ? inUYU / usdRate
                        : display === "ARS" ? inUYU / arsRate
                        : inUYU;
                    return fmtMoney(equiv, display);
                  })()}
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
                <div className="mb-3 rounded-2xl bg-finance-amberSoft px-4 py-3 text-sm text-finance-ink dark:bg-amber-900/30 dark:text-amber-200">
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

      <form onSubmit={handleCreate} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva cuenta</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[120px_1fr_100px_140px_auto]">
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" placeholder="id" value={newAccount.id} onChange={(event) => setNewAccount((prev) => ({ ...prev, id: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" placeholder="Nombre" value={newAccount.name} onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" value={newAccount.currency} onChange={(event) => setNewAccount((prev) => ({ ...prev, currency: event.target.value }))}>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
          <input className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100" type="number" placeholder="Balance" value={newAccount.balance} onChange={(event) => setNewAccount((prev) => ({ ...prev, balance: event.target.value }))} />
          <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>
    </div>
  );
}
