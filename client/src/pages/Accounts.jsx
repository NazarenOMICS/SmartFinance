import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import MetricCard from "../components/MetricCard";
import {
  CURRENCY_LABELS,
  convertCurrencyAmount,
  fmtMoney,
  getExchangeRateMap,
  getExchangeRateSettingKey,
  SUPPORTED_CURRENCY_OPTIONS,
} from "../utils";

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
  const [nameDrafts, setNameDrafts] = useState({});
  const [rateDrafts, setRateDrafts] = useState({
    exchange_rate_usd_uyu: settings.manual_exchange_rate_usd_uyu || settings.exchange_rate_usd_uyu || "42.5",
    exchange_rate_eur_uyu: settings.manual_exchange_rate_eur_uyu || settings.exchange_rate_eur_uyu || "46.5",
    exchange_rate_ars_uyu: settings.manual_exchange_rate_ars_uyu || settings.exchange_rate_ars_uyu || "0.045",
  });
  const [newAccount, setNewAccount] = useState({ name: "", currency: "UYU", balance: "" });
  const [deleteError, setDeleteError] = useState(null);
  const [refreshingRates, setRefreshingRates] = useState(false);
  const confirm = useConfirm();
  const loadRequestIdRef = useRef(0);

  async function load(options = {}) {
    const { silent = false } = options;
    const requestId = ++loadRequestIdRef.current;

    if (!silent || state.accounts.length === 0) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }

    try {
      const [accounts, consolidated] = await Promise.all([api.getAccounts(), api.getConsolidatedAccounts()]);
      if (loadRequestIdRef.current !== requestId) return;

      setState((prev) => ({
        ...prev,
        loading: false,
        error: "",
        accounts,
        consolidated,
      }));

      setLocalBalances((prev) => {
        const next = { ...prev };
        accounts.forEach((account) => {
          next[account.id] = String(account.balance);
        });
        return next;
      });

      setNameDrafts((prev) => {
        const next = { ...prev };
        accounts.forEach((account) => {
          next[account.id] = account.name;
        });
        return next;
      });
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    load({ silent: state.accounts.length > 0 });
  }, [settings.display_currency, settings.exchange_rate_usd_uyu, settings.exchange_rate_eur_uyu, settings.exchange_rate_ars_uyu]);

  useEffect(() => {
    setRateDrafts({
      exchange_rate_usd_uyu: settings.manual_exchange_rate_usd_uyu || settings.exchange_rate_usd_uyu || "42.5",
      exchange_rate_eur_uyu: settings.manual_exchange_rate_eur_uyu || settings.exchange_rate_eur_uyu || "46.5",
      exchange_rate_ars_uyu: settings.manual_exchange_rate_ars_uyu || settings.exchange_rate_ars_uyu || "0.045",
    });
  }, [
    settings.manual_exchange_rate_usd_uyu,
    settings.manual_exchange_rate_eur_uyu,
    settings.manual_exchange_rate_ars_uyu,
    settings.exchange_rate_usd_uyu,
    settings.exchange_rate_eur_uyu,
    settings.exchange_rate_ars_uyu,
  ]);

  async function handleBalanceBlur(id) {
    const account = state.accounts.find((item) => item.id === id);
    const rawValue = String(localBalances[id] ?? "").trim();

    if (!rawValue) {
      setLocalBalances((prev) => ({ ...prev, [id]: String(account?.balance ?? 0) }));
      addToast("warning", "El balance no puede quedar vacio.");
      return;
    }

    const balance = Number(rawValue);
    if (!Number.isFinite(balance)) {
      setLocalBalances((prev) => ({ ...prev, [id]: String(account?.balance ?? 0) }));
      addToast("warning", "Ingresa un balance valido.");
      return;
    }

    if (!account || balance === Number(account.balance)) return;

    const previousAccounts = state.accounts;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((item) => (
        item.id === id ? { ...item, balance } : item
      )),
    }));

    try {
      await api.updateAccount(id, { balance });
      load({ silent: true });
    } catch (error) {
      setState((prev) => ({ ...prev, accounts: previousAccounts }));
      setLocalBalances((prev) => ({ ...prev, [id]: String(account.balance) }));
      addToast("error", error.message);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();

    try {
      const created = await api.createAccount({ ...newAccount, balance: Number(newAccount.balance || 0) });
      addToast("success", `Cuenta "${created.name}" creada.`);
      setNewAccount({ name: "", currency: "UYU", balance: "" });
      setState((prev) => ({
        ...prev,
        accounts: [...prev.accounts, created],
      }));
      setLocalBalances((prev) => ({ ...prev, [created.id]: String(created.balance) }));
      setNameDrafts((prev) => ({ ...prev, [created.id]: created.name }));
      load({ silent: true });
    } catch (error) {
      addToast("error", error.message);
    }
  }

  async function handleDeleteAccount(id, force = false) {
    setDeleteError(null);
    const previousAccounts = state.accounts;

    try {
      await api.deleteAccount(id, force);
      confirm.clear();
      setState((prev) => ({
        ...prev,
        accounts: prev.accounts.filter((account) => account.id !== id),
      }));
      load({ silent: true });
      onAccountDeleted?.();
    } catch (error) {
      setState((prev) => ({ ...prev, accounts: previousAccounts }));
      setDeleteError({ id, message: error.message });
    }
  }

  async function handleSetting(key, value) {
    try {
      await api.updateSetting(key, value);
      await refreshSettings();
      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleRateBlur(key) {
    const rawValue = String(rateDrafts[key] || "").trim();
    const numericValue = Number(rawValue);

    if (!rawValue || !Number.isFinite(numericValue) || numericValue <= 0) {
      const fallbackByKey = {
        exchange_rate_usd_uyu: "42.5",
        exchange_rate_eur_uyu: "46.5",
        exchange_rate_ars_uyu: "0.045",
      };
      setRateDrafts((prev) => ({
        ...prev,
        [key]: settings[`manual_${key}`] || settings[key] || fallbackByKey[key] || "",
      }));
      addToast("warning", "Ingresa un tipo de cambio mayor a 0.");
      return;
    }

    const updated = await handleSetting(key, rawValue);
    if (updated === false) {
      const fallbackByKey = {
        exchange_rate_usd_uyu: "42.5",
        exchange_rate_eur_uyu: "46.5",
        exchange_rate_ars_uyu: "0.045",
      };
      setRateDrafts((prev) => ({
        ...prev,
        [key]: settings[`manual_${key}`] || settings[key] || fallbackByKey[key] || "",
      }));
    }
  }

  async function handleNameBlur(account, nextName) {
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      setNameDrafts((prev) => ({ ...prev, [account.id]: account.name }));
      addToast("warning", "El nombre no puede quedar vacio.");
      return;
    }

    if (trimmedName === account.name) {
      setNameDrafts((prev) => ({ ...prev, [account.id]: account.name }));
      return;
    }

    const previousAccounts = state.accounts;
    setState((prev) => ({
      ...prev,
      accounts: prev.accounts.map((item) => (
        item.id === account.id ? { ...item, name: trimmedName } : item
      )),
    }));

    try {
      await api.updateAccount(account.id, { name: trimmedName });
      load({ silent: true });
    } catch (error) {
      setState((prev) => ({ ...prev, accounts: previousAccounts }));
      setNameDrafts((prev) => ({ ...prev, [account.id]: account.name }));
      addToast("error", error.message);
    }
  }

  async function handleRefreshRates() {
    setRefreshingRates(true);
    try {
      const result = await api.refreshRates();
      await refreshSettings();
      addToast("success", `Tasas actualizadas desde ${result.source}.`);
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setRefreshingRates(false);
    }
  }

  if (state.loading) {
    return (
      <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">
        Cargando cuentas...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">
        {state.error}
      </div>
    );
  }

  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRateMode = settings.exchange_rate_mode || "auto";
  const exchangeRates = getExchangeRateMap(settings);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <MetricCard
          label="Patrimonio consolidado"
          value={fmtMoney(state.consolidated.total, state.consolidated.currency)}
          tone="text-finance-purple"
        />

        <div className="rounded-[28px] border border-white/70 bg-white/90 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Tipo de cambio</p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                Automatico por defecto, con override manual si queres fijar tus propios valores.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefreshRates}
              disabled={refreshingRates || exchangeRateMode !== "auto"}
              className="rounded-full bg-finance-purple px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {refreshingRates ? "Actualizando..." : "Actualizar ahora"}
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">Modo</span>
              <select
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={exchangeRateMode}
                onChange={(event) => handleSetting("exchange_rate_mode", event.target.value)}
              >
                <option value="auto">Automatico</option>
                <option value="manual">Manual</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-neutral-400">Moneda principal</span>
              <select
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={displayCurrency}
                onChange={(event) => handleSetting("display_currency", event.target.value)}
              >
                {SUPPORTED_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {`Mostrar en ${option.value}`}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-2xl bg-finance-cream/75 px-4 py-3 dark:bg-neutral-800/75">
            <div className="grid gap-3 md:grid-cols-3">
              {["USD", "EUR", "ARS"].map((currency) => {
                const rate = Number(exchangeRates[currency] || 0);
                return (
                  <div key={currency}>
                    <p className="text-xs uppercase tracking-[0.16em] text-neutral-400">{currency} / UYU</p>
                    <p className="mt-1 text-2xl font-semibold text-finance-ink dark:text-neutral-100">
                      {Number(rate || 0).toFixed(rate < 1 ? 3 : 2)}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-neutral-400">
              Fuente: {settings.exchange_rate_source || "manual_override"}
              {settings.exchange_rate_updated_at ? ` | Ultima actualizacion: ${new Date(settings.exchange_rate_updated_at).toLocaleString("es-UY")}` : ""}
            </p>
            {settings.exchange_rate_fetch_error ? (
              <p className="mt-2 text-xs text-finance-amber">
                Ultimo error de actualizacion: {settings.exchange_rate_fetch_error}
              </p>
            ) : null}
          </div>

          {exchangeRateMode === "manual" && (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {["USD", "EUR", "ARS"].map((currency) => {
                const key = getExchangeRateSettingKey(currency);
                return (
                  <label key={currency} className="flex flex-col gap-1">
                    <span className="text-xs text-neutral-400">{`Override manual ${currency}/UYU`}</span>
                    <input
                      type="number"
                      className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                      value={rateDrafts[key]}
                      onChange={(event) => setRateDrafts((prev) => ({ ...prev, [key]: event.target.value }))}
                      onBlur={() => handleRateBlur(key)}
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
          <span>Cuenta</span>
          <span>Moneda</span>
          <span>Balance</span>
          <span>Equiv.</span>
          <span></span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {state.accounts.map((account) => (
            <div key={account.id}>
              <div className="grid grid-cols-[1.4fr_80px_140px_130px_80px] gap-4 py-4">
                <input
                  className="w-full rounded-xl border border-transparent bg-transparent px-2 py-1 font-semibold text-finance-ink hover:border-neutral-200 focus:border-finance-purple focus:outline-none dark:hover:border-neutral-700"
                  value={nameDrafts[account.id] ?? account.name}
                  onChange={(event) => setNameDrafts((prev) => ({ ...prev, [account.id]: event.target.value }))}
                  onBlur={(event) => handleNameBlur(account, event.target.value)}
                />
                <span className="text-neutral-500">{account.currency}</span>
                <input
                  className="rounded-xl border border-neutral-200 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  type="number"
                  value={localBalances[account.id] ?? account.balance}
                  onChange={(event) => setLocalBalances((prev) => ({ ...prev, [account.id]: event.target.value }))}
                  onBlur={() => handleBalanceBlur(account.id)}
                />
                <span className="font-semibold text-finance-ink">
                  {fmtMoney(convertCurrencyAmount(account.balance, account.currency, displayCurrency, exchangeRates), displayCurrency)}
                </span>
                <button
                  onClick={() => (confirm.pending === account.id ? handleDeleteAccount(account.id) : confirm.ask(account.id))}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    confirm.pending === account.id
                      ? "bg-finance-red text-white"
                      : "bg-finance-redSoft text-finance-red hover:bg-finance-red hover:text-white"
                  }`}
                >
                  {confirm.pending === account.id ? "Seguro?" : "Borrar"}
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
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_100px_140px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Nombre de la cuenta"
            value={newAccount.name}
            onChange={(event) => setNewAccount((prev) => ({ ...prev, name: event.target.value }))}
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={newAccount.currency}
            onChange={(event) => setNewAccount((prev) => ({ ...prev, currency: event.target.value }))}
          >
            {SUPPORTED_CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {`${option.value} - ${CURRENCY_LABELS[option.value] || option.value}`}
              </option>
            ))}
          </select>
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            type="number"
            placeholder="Balance"
            value={newAccount.balance}
            onChange={(event) => setNewAccount((prev) => ({ ...prev, balance: event.target.value }))}
          />
          <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">
            Agregar
          </button>
        </div>
      </form>
    </div>
  );
}
