import { useEffect, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import BudgetBar from "../components/BudgetBar";
import ExportButton from "../components/ExportButton";
import MetricCard from "../components/MetricCard";
import MonthComparison from "../components/MonthComparison";
import TransactionTable from "../components/TransactionTable";
import { SkeletonDashboard } from "../components/SkeletonLoader";
import { fmtMoney } from "../utils";

const chartColors = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780"];

export default function Dashboard({ month, settings, refreshSettings, onNavigate, onPendingChange }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", summary: null, transactions: [], categories: [], evolution: [], trend: null, prevSummary: null });
  const [clickedCategory, setClickedCategory]         = useState(null);
  const [dismissedBudgetAlert, setDismissedBudgetAlert] = useState(false);
  const [showUSD, setShowUSD] = useState(false);

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      // Compute previous month for comparison
      const [y, m] = month.split("-").map(Number);
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const prevMonth = `${prevY}-${String(prevM).padStart(2, "0")}`;

      const [summary, transactions, categories, evolution, trend, prevSummary] = await Promise.all([
        api.getSummary(month),
        api.getTransactions(month),
        api.getCategories(),
        api.getEvolution(month, 6),
        api.getCategoryTrend(month, 4),
        api.getSummary(prevMonth).catch(() => null),
      ]);
      setState({ loading: false, error: "", summary, transactions, categories, evolution, trend, prevSummary });
      onPendingChange?.(transactions.filter((t) => !t.category_id).length);
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => { load(); }, [month]);

  async function handleCategorize(id, categoryId) {
    const result = await api.updateTransaction(id, { category_id: Number(categoryId) });
    if (result?.rule?.conflict) {
      addToast("warning", `Regla "${result.rule.rule?.pattern}" existe para otra categoría — la transacción fue categorizada sin modificar la regla.`);
    } else if (result?.rule?.created && result.rule.retro_count > 0) {
      addToast("success", `Regla "${result.rule.rule?.pattern}" aplicada a ${result.rule.retro_count} transacciones anteriores.`);
    }
    await load();
  }

  async function handleBulkCategorize(ids, categoryId) {
    await Promise.all(ids.map((id) => api.updateTransaction(id, { category_id: Number(categoryId) })));
    addToast("success", `${ids.length} transacciones categorizadas.`);
    await load();
  }

  async function handleDeleteTransaction(id) {
    const tx = state.transactions.find((t) => t.id === id);
    await api.deleteTransaction(id);
    await load();
    if (tx) {
      addToast("info", `"${(tx.desc_usuario || tx.desc_banco).slice(0, 32)}" eliminada`, {
        label: "Deshacer",
        fn: async () => {
          await api.createTransaction({
            fecha: tx.fecha,
            desc_banco: tx.desc_banco,
            ...(tx.desc_usuario && { desc_usuario: tx.desc_usuario }),
            monto: tx.monto,
            moneda: tx.moneda,
            ...(tx.category_id && { category_id: tx.category_id }),
            ...(tx.account_id && { account_id: tx.account_id }),
          });
          await load();
          addToast("success", "Transacción restaurada.");
        },
      });
    }
  }

  async function handleUpdateDesc(id, desc) {
    await api.updateTransaction(id, { desc_usuario: desc });
    await load();
  }

  async function handleUpdateFull(id, changes) {
    await api.updateTransaction(id, changes);
    await load();
  }

  if (state.loading) return <SkeletonDashboard />;

  if (state.error) {
    return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;
  }

  const { summary } = state;

  if (state.transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[32px] border border-dashed border-finance-purple/30 bg-white/80 px-8 py-20 text-center shadow-panel dark:bg-neutral-900/80 dark:border-finance-purple/20">
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
            className="rounded-full border border-neutral-200 bg-white px-6 py-3 font-semibold text-finance-ink hover:bg-neutral-50 transition dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            Cargar gasto manual
          </button>
        </div>
      </div>
    );
  }

  function toggleCategory(name) {
    setClickedCategory((prev) => (prev === name ? null : name));
  }

  const overBudget = summary.budgets.filter((b) => b.budget > 0 && b.spent > b.budget);

  const tc = parseFloat(settings.exchange_rate_usd_uyu) || 42.5;
  const cvt = (amount) => showUSD ? amount / tc : amount;
  const dispCurrency = showUSD ? "USD" : (settings.display_currency || "UYU");
  const fmt = (amount) => fmtMoney(cvt(amount), dispCurrency);
  const evolutionData = showUSD
    ? state.evolution.map((d) => ({ ...d, ingresos: d.ingresos / tc, gastos: d.gastos / tc }))
    : state.evolution;

  return (
    <div className="space-y-6">
      {/* Budget overrun banner */}
      {overBudget.length > 0 && !dismissedBudgetAlert && (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-finance-redSoft px-5 py-4 dark:bg-red-900/25">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-xl">🚨</span>
            <div>
              <p className="font-semibold text-finance-red dark:text-red-300">
                {overBudget.length === 1
                  ? `"${overBudget[0].name}" superó el presupuesto mensual`
                  : `${overBudget.length} categorías superaron su presupuesto mensual`}
              </p>
              <p className="mt-1 text-sm text-finance-red/80 dark:text-red-400">
                {overBudget.map((b) => `${b.name} (${fmt(b.spent)} / ${fmt(b.budget)})`).join(" · ")}
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissedBudgetAlert(true)}
            className="shrink-0 text-finance-red/60 transition hover:text-finance-red dark:text-red-400"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowUSD((v) => !v)}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            showUSD
              ? "border-finance-blue bg-finance-blue text-white"
              : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${showUSD ? "bg-white" : "bg-neutral-300 dark:bg-neutral-600"}`} />
          Ver en USD {showUSD ? `(TC ${tc})` : ""}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Patrimonio total" value={fmt(summary.totals.patrimonio)} tone="text-finance-purple" />
        <MetricCard label="Ingresos del mes" value={fmt(summary.totals.income)} delta={summary.deltas.income} tone="text-finance-teal" />
        <MetricCard label="Gastos del mes" value={fmt(summary.totals.expenses)} delta={summary.deltas.expenses} tone="text-finance-red" />
        <MetricCard label="Margen disponible" value={fmt(summary.totals.margin)} tone={summary.totals.margin >= 0 ? "text-finance-green" : "text-finance-red"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        {/* Pie chart + category legend */}
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Distribución mensual</p>
              <h2 className="font-display text-3xl text-finance-ink">Gastos por categoría</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-full border border-neutral-200 bg-finance-cream px-4 py-2 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={settings.display_currency || "UYU"}
                onChange={async (e) => { await api.updateSetting("display_currency", e.target.value); await refreshSettings(); await load(); }}
              >
                <option value="UYU">UYU</option>
                <option value="USD">USD</option>
              </select>
              <input
                className="w-28 rounded-full border border-neutral-200 bg-finance-cream px-4 py-2 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
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
                  <Pie
                    data={summary.byCategory}
                    dataKey="spent"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={106}
                    paddingAngle={2}
                    onClick={(entry) => toggleCategory(entry.name)}
                  >
                    {summary.byCategory.map((entry, index) => (
                      <Cell
                        key={entry.id}
                        fill={entry.color || chartColors[index % chartColors.length]}
                        opacity={clickedCategory && clickedCategory !== entry.name ? 0.3 : 1}
                        style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmt(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              {clickedCategory && (
                <button
                  onClick={() => setClickedCategory(null)}
                  className="mb-1 flex w-full items-center justify-between rounded-2xl bg-finance-purpleSoft px-3 py-2 text-xs font-semibold text-finance-purple transition hover:bg-finance-purple hover:text-white dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-700 dark:hover:text-white"
                >
                  <span>Filtrando: {clickedCategory}</span>
                  <span>✕ limpiar</span>
                </button>
              )}
              {summary.byCategory.map((category) => (
                <button
                  key={category.id}
                  onClick={() => toggleCategory(category.name)}
                  className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                    clickedCategory === category.name
                      ? "ring-1 ring-finance-purple/40 bg-finance-purple/10 dark:bg-purple-900/30"
                      : clickedCategory
                      ? "opacity-40 bg-finance-cream/50 dark:bg-neutral-800/50"
                      : "bg-finance-cream/70 hover:bg-finance-cream dark:bg-neutral-800/70 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: category.color || "#888780" }} />
                    <div>
                      <p className="font-semibold text-finance-ink">{category.name}</p>
                      <p className="text-xs uppercase tracking-[0.16em] text-neutral-400">{category.type}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-finance-ink">{fmt(category.spent)}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Evolution chart */}
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Evolución</p>
              <h2 className="font-display text-3xl text-finance-ink">Últimos 6 meses</h2>
            </div>
            {summary.pending_count > 0 && (
              <span className="rounded-full bg-finance-amberSoft px-4 py-2 text-sm font-semibold text-finance-amber dark:bg-amber-900/30 dark:text-amber-300">
                {summary.pending_count} pendientes
              </span>
            )}
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evolutionData}>
                <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => fmt(value)} />
                <Bar dataKey="ingresos" fill="#1D9E75" radius={[10, 10, 0, 0]} name="Ingresos" />
                <Bar dataKey="gastos" fill="#534AB7" radius={[10, 10, 0, 0]} name="Gastos" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Gastos fijos" value={fmt(summary.byType.fijo)} tone="text-finance-coral" />
        <MetricCard label="Gastos variables" value={fmt(summary.byType.variable)} tone="text-finance-blue" />
        <MetricCard label="Cuotas del mes" value={fmt(summary.totals.installments)} tone="text-finance-amber" />
      </div>

      <div className="space-y-3">
        {summary.budgets.filter((item) => item.budget > 0 || item.spent > 0).map((item) => {
          const catTrend = state.trend?.categories?.find((c) => c.id === item.id);
          return (
            <BudgetBar
              key={item.id}
              label={item.name}
              spent={cvt(item.spent)}
              budget={cvt(item.budget)}
              type={item.type}
              color={item.color}
              trend={catTrend?.series}
              currency={dispCurrency}
            />
          );
        })}
      </div>

      <MonthComparison
        current={summary.byCategory}
        previous={state.prevSummary?.byCategory || []}
      />

      <TransactionTable
        transactions={state.transactions}
        categories={state.categories}
        onCategorize={handleCategorize}
        onBulkCategorize={handleBulkCategorize}
        onDelete={handleDeleteTransaction}
        onUpdateDesc={handleUpdateDesc}
        onUpdateFull={handleUpdateFull}
        externalCatFilter={clickedCategory}
        onClearExternalFilter={() => setClickedCategory(null)}
      />
    </div>
  );
}
