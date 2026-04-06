import { useEffect, useState } from "react";
import { api } from "../api";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

export default function Accounts({ settings, refreshSettings, dataVersion, invalidateData }) {
  const [state, setState] = useState({ loading: true, error: "", accounts: [], consolidated: null, links: [] });
  const [newAccount, setNewAccount] = useState({ id: "", name: "", currency: "UYU", balance: "" });
  const [linkForm, setLinkForm] = useState({ account_a_id: "", account_b_id: "" });
  const [draftBalances, setDraftBalances] = useState({});
  const [linkMessage, setLinkMessage] = useState("");

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [accounts, consolidated, links] = await Promise.all([api.getAccounts(), api.getConsolidatedAccounts(), api.getAccountLinks()]);
      setDraftBalances(
        accounts.reduce((acc, account) => {
          acc[account.id] = String(account.live_balance ?? account.balance ?? 0);
          return acc;
        }, {})
      );
      setState({ loading: false, error: "", accounts, consolidated, links });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    load();
  }, [settings.display_currency, settings.exchange_rate_usd_uyu, dataVersion]);

  async function handleBalanceSave(id) {
    await api.updateAccount(id, { live_balance: Number(draftBalances[id] || 0) });
    invalidateData();
    await load();
  }

  async function handleCreate(event) {
    event.preventDefault();
    await api.createAccount({ ...newAccount, balance: Number(newAccount.balance || 0) });
    setNewAccount({ id: "", name: "", currency: "UYU", balance: "" });
    invalidateData();
    await load();
  }

  async function handleSetting(key, value) {
    await api.updateSetting(key, value);
    await refreshSettings();
  }

  async function handleCreateLink(event) {
    event.preventDefault();
    try {
      await api.createAccountLink(linkForm);
      setLinkForm({ account_a_id: "", account_b_id: "" });
      setLinkMessage("Cuentas vinculadas correctamente.");
      invalidateData();
      await load();
    } catch (error) {
      setLinkMessage(error.message);
    }
  }

  async function handleCreateLinkAndReconcile(event) {
    event.preventDefault();
    try {
      const created = await api.createAccountLink(linkForm);
      const reconciliation = await api.reconcileAccountLink(created.id);
      setLinkForm({ account_a_id: "", account_b_id: "" });
      setLinkMessage(`Cuentas vinculadas y conciliadas. ${reconciliation.reconciled_pairs} pares historicos pasaron a transferencia interna.`);
      invalidateData();
      await load();
    } catch (error) {
      setLinkMessage(error.message);
    }
  }

  async function handleReconcileLink(id) {
    try {
      const reconciliation = await api.reconcileAccountLink(id);
      setLinkMessage(`Se conciliaron ${reconciliation.reconciled_pairs} pares historicos para este link.`);
      invalidateData();
      await load();
    } catch (error) {
      setLinkMessage(error.message);
    }
  }

  async function handleDeleteLink(id) {
    await api.deleteAccountLink(id);
    setLinkMessage("");
    invalidateData();
    await load();
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando cuentas...</div>;
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
        <div className="grid grid-cols-[1.2fr_80px_150px_150px_1fr] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span>Cuenta</span>
          <span>Moneda</span>
          <span>Saldo vivo</span>
          <span>Saldo inicial</span>
          <span>Links</span>
        </div>
        <div className="divide-y divide-neutral-100">
          {state.accounts.map((account) => (
            <div key={account.id} className="grid grid-cols-[1.2fr_80px_150px_150px_1fr] gap-4 py-4">
              <span className="font-semibold text-finance-ink">{account.name}</span>
              <span className="text-neutral-500">{account.currency}</span>
              <input
                className="rounded-xl border border-neutral-200 px-3 py-2"
                type="number"
                value={draftBalances[account.id] ?? ""}
                onChange={(event) => setDraftBalances((prev) => ({ ...prev, [account.id]: event.target.value }))}
                onBlur={() => handleBalanceSave(account.id)}
              />
              <span className="font-semibold text-finance-ink">{fmtMoney(account.opening_balance, account.currency)}</span>
              <div className="flex flex-wrap gap-2">
                {account.linked_accounts.length === 0 ? <span className="text-neutral-400">Sin links</span> : null}
                {account.linked_accounts.map((linked) => (
                  <span key={`${account.id}-${linked.id}`} className="rounded-full bg-finance-cream px-3 py-1 text-xs text-finance-ink">
                    {linked.account_name} ({linked.currency})
                  </span>
                ))}
              </div>
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
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" type="number" placeholder="Saldo inicial" value={newAccount.balance} onChange={(event) => setNewAccount((prev) => ({ ...prev, balance: event.target.value }))} />
          <button className="rounded-full bg-finance-ink px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <form onSubmit={handleCreateLink} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Link de cuentas</p>
          {linkMessage ? <p className="mt-3 text-sm text-neutral-500">{linkMessage}</p> : null}
          <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr]">
            <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={linkForm.account_a_id} onChange={(event) => setLinkForm((prev) => ({ ...prev, account_a_id: event.target.value }))}>
              <option value="">Cuenta A</option>
              {state.accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({account.currency})
                </option>
              ))}
            </select>
            <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={linkForm.account_b_id} onChange={(event) => setLinkForm((prev) => ({ ...prev, account_b_id: event.target.value }))}>
              <option value="">Cuenta B</option>
              {state.accounts
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
              Linkear y conciliar historico
            </button>
          </div>
        </form>

        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Links activos</p>
          <div className="mt-4 space-y-3">
            {state.links.length === 0 ? <p className="text-neutral-500">Todavia no hay cuentas vinculadas.</p> : null}
            {state.links.map((link) => (
              <div key={link.id} className="flex items-center justify-between rounded-2xl bg-finance-cream/75 px-4 py-4">
                <div>
                  <p className="font-semibold text-finance-ink">
                    {link.account_a_name} ({link.account_a_currency}) {"<->"} {link.account_b_name} ({link.account_b_currency})
                  </p>
                  <p className="text-sm text-neutral-500">{link.relation_type}</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button type="button" onClick={() => handleReconcileLink(link.id)} className="rounded-full border border-finance-ink/10 px-3 py-1 text-xs font-semibold text-finance-ink">
                    Conciliar historico
                  </button>
                  <button onClick={() => handleDeleteLink(link.id)} className="text-finance-red">
                    Borrar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
