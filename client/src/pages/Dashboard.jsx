import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import BudgetBar from "../components/BudgetBar";
import ExportButton from "../components/ExportButton";
import MetricCard from "../components/MetricCard";
import TransactionTable from "../components/TransactionTable";
import { fmtMoney } from "../utils";

const chartColors = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780"];

export default function Dashboard({ month, settings, refreshSettings, onNavigate }) {
  const [state, setState] = useState({ loading: true, error: "", summary: null, transactions: [], categories: [], evolution: [] });
  const [ruleNotice, setRuleNotice] = useState(null);

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [summary, transactions, categories, evolution] = await Promise.all([
        api.getSummary(month),
        api.getTransactions(month),
        api.getCategories(),
        api.getEvolution(month, 6)
      ]);
      setState({ loading: false, error: "", summary, transactions, categories, evolution });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    load();
  }, [month]);

  async function handleCategorize(id, categoryId) {
    const result = await api.updateTransaction(id, { category_id: Number(categoryId) });
    if (result?.rule?.conflict) {
      setRuleNotice({ type: "conflict", pattern: result.rule.rule?.pattern });
      setTimeout(() => setRuleNotice(null), 5000);
    } else if (result?.rule?.created && result.rule.retro_count > 0) {
      setRuleNotice({ type: "retro", count: result.rule.retro_count, pattern: result.rule.rule?.pattern });
      setTimeout(() => setRuleNotice(null), 5000);
    }
    await load();
  }

  async function handleDeleteTransaction(id) {
    await api.deleteTransaction(id);
    await load();
  }

  async function handleUpdateDesc(id, desc) {
    await api.updateTransaction(id, { desc_usuario: desc });
    await load();
  }

  if (state.loading) {
    return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando dashboard…</div>;
  }

  if (state.error) {
    return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;
  }

  const { summary } = state;

  // Empty state — no transactions this month
  if (!state.loading && state.transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[32px] border border-dashed border-finance-purple/30 bg-white/80 px-8 py-20 text-center shadow-panel">
        <p className="text-5xl">◱</p>
        <h2 className="mt-4 font-display text-4xl text-finance-ink">Sin transacciones este mes</h2>
        <p className="mt-3 max-w-sm text-neutral-500">Subí el PDF de tu resumen bancario o cargá un gasto manualmente para empezar a ver tus finanzas.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <button
            onClick={() => onNavigate?.("upload")}
            className="rounded-full bg-finance-purple px-6 py-3 font-semibold text-white hover:opacity-90 transition"
          >
            Subir PDF o imagen
          </button>
          <button
            onClick={() => onNavigate?.("upload")}
            className="rounded-full border border-neutral-200 bg-white px-6 py-3 font-semibold text-finance-ink hover:bg-neutral-50 transition"
          >
            Cargar gasto manual
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {ruleNotice?.type === "conflict" && (
        <div className="rounded-2xl bg-finance-amberSoft px-4 py-3 text-sm text-finance-ink">
          ⚠ Ya existe una regla con patrón <strong>"{ruleNotice.pattern}"</strong> para otra categoría. La transacción fue categorizada pero la regla existente no se modificó.
        </div>
      )}
      {ruleNotice?.type === "retro" && (
        <div className="rounded-2xl bg-finance-tealSoft px-4 py-3 text-sm text-finance-teal">
          ✓ Regla <strong>"{ruleNotice.pattern}"</strong> creada y aplicada retroactivamente a {ruleNotice.count} transacciones sin categorizar.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Patrimonio total" value={fmtMoney(summary.totals.patrimonio, summary.currency)} tone="text-finance-purple" />
        <MetricCard label="Ingresos del mes" value={fmtMoney(summary.totals.income)} delta={summary.deltas.income} tone="text-finance-teal" />
        <MetricCard label="Gastos del mes" value={fmtMoney(summary.totals.expenses)} delta={summary.deltas.expenses} tone="text-finance-red" />
        <MetricCard label="Margen disponible" value={fmtMoney(summary.totals.margin)} tone={summary.totals.margin >= 0 ? "text-finance-green" : "text-finance-red"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Distribución mensual</p>
              <h2 className="font-display text-3xl text-finance-ink">Gastos por categoría</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-full border border-neutral-200 bg-finance-cream px-4 py-2 text-sm text-finance-ink"
                value={settings.display_currency || "UYU"}
                onChange={async (e) => { await api.updateSetting("display_currency", e.target.value); await refreshSettings(); await load(); }}
              >
                <option value="UYU">UYU</option>
                <option value="USD">USD</option>
              </select>
              <input
                className="w-28 rounded-full border border-neutral-200 bg-finance-cream px-4 py-2 text-sm text-finance-ink"
                type="number"
                title="Tipo de cambio USD/UYU"
                placeholder="TC USD/UYU"
                defaultValue={settings.exchange_rate_usd_uyu || "42.5"}
                key={settings.exchange_rate_usd_uyu}
                onBlur={async (e) => { await api.updateSetting("exchange_rate_usd_uyu", e.target.value); await refreshSettings(); await load(); }}
              />
              <ExportButton month={month} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={summary.byCategory} dataKey="spent" nameKey="name" innerRadius={72} outerRadius={106} paddingAngle={2}>
                    {summary.byCategory.map((entry, index) => (
                      <Cell key={entry.id} fill={entry.color || chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmtMoney(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              {summary.byCategory.map((category) => (
                <div key={category.id} className="flex items-center justify-between rounded-2xl bg-finance-cream/70 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: category.color || "#888780" }} />
                    <div>
                      <p className="font-semibold text-finance-ink">{category.name}</p>
                      <p className="text-xs uppercase tracking-[0.16em] text-neutral-400">{category.type}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-finance-ink">{fmtMoney(category.spent)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Evolución</p>
              <h2 className="font-display text-3xl text-finance-ink">Últimos 6 meses</h2>
            </div>
            <div className="rounded-full bg-finance-amberSoft px-4 py-2 text-sm text-finance-amber">
              Pendientes: {summary.pending_count}
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={state.evolution}>
                <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => fmtMoney(value)} />
                <Bar dataKey="ingresos" fill="#1D9E75" radius={[10, 10, 0, 0]} />
                <Bar dataKey="gastos" fill="#534AB7" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Gastos fijos" value={fmtMoney(summary.byType.fijo)} tone="text-finance-coral" />
        <MetricCard label="Gastos variables" value={fmtMoney(summary.byType.variable)} tone="text-finance-blue" />
        <MetricCard label="Cuotas del mes" value={fmtMoney(summary.totals.installments)} tone="text-finance-amber" />
      </div>

      <div className="space-y-3">
        {summary.budgets.filter((item) => item.budget > 0 || item.spent > 0).map((item) => (
          <BudgetBar key={item.id} label={item.name} spent={item.spent} budget={item.budget} type={item.type} color={item.color} />
        ))}
      </div>

      <TransactionTable transactions={state.transactions} categories={state.categories} onCategorize={handleCategorize} onDelete={handleDeleteTransaction} onUpdateDesc={handleUpdateDesc} />
    </div>
  );
}

