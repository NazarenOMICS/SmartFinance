import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import BudgetBar from "../components/BudgetBar";
import ExportButton from "../components/ExportButton";
import MetricCard from "../components/MetricCard";
import TransactionTable from "../components/TransactionTable";
import { fmtMoney } from "../utils";

const chartColors = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780"];

function CategoryTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;

  return (
    <div className="rounded-2xl border border-white/70 bg-white px-4 py-3 shadow-panel">
      <p className="font-semibold text-finance-ink">{item.name}</p>
      <p className="text-sm text-neutral-500">{fmtMoney(item.spent)}</p>
    </div>
  );
}

export default function Dashboard({ month, dataVersion }) {
  const [state, setState] = useState({ loading: true, error: "", summary: null, transactions: [], categories: [], evolution: [] });
  const [showAllCategories, setShowAllCategories] = useState(false);

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const dashboard = await api.getDashboard(month);
      setState({
        loading: false,
        error: "",
        summary: dashboard.summary,
        transactions: dashboard.transactions,
        categories: dashboard.categories,
        evolution: dashboard.evolution
      });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setShowAllCategories(false);
    load();
  }, [month, dataVersion]);

  async function handleCategorize(id, categoryId) {
    const result = await api.updateTransaction(id, { category_id: Number(categoryId) });
    setState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((tx) => (tx.id === id ? result.transaction : tx))
    }));

    try {
      const summary = await api.getSummary(month);
      setState((prev) => ({ ...prev, summary }));
    } catch (error) {
      setState((prev) => ({ ...prev, error: error.message }));
    }
  }

  const visibleCategories = useMemo(() => {
    if (!state.summary) return [];
    return showAllCategories ? state.summary.byCategory : state.summary.byCategory.slice(0, 5);
  }, [showAllCategories, state.summary]);

  if (state.loading) {
    return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando dashboard...</div>;
  }

  if (state.error) {
    return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;
  }

  const { summary } = state;
  const hiddenCategories = Math.max(0, summary.byCategory.length - 5);

  return (
    <div className="space-y-6">
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
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Distribucion mensual</p>
              <h2 className="font-display text-3xl text-finance-ink">Gastos por categoria</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-full bg-finance-cream px-4 py-2 text-sm text-neutral-500">
                Moneda display: <span className="font-semibold text-finance-ink">{summary.currency || "UYU"}</span>
              </div>
              <ExportButton month={month} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={visibleCategories} dataKey="spent" nameKey="name" innerRadius={72} outerRadius={106} paddingAngle={2}>
                    {visibleCategories.map((entry, index) => (
                      <Cell key={entry.id} fill={entry.color || chartColors[index % chartColors.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CategoryTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-3">
              {visibleCategories.map((category) => (
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
              {hiddenCategories > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllCategories((current) => !current)}
                  className="w-full rounded-2xl border border-dashed border-finance-purple/30 px-4 py-3 text-sm font-semibold text-finance-purple"
                >
                  {showAllCategories ? "Mostrar solo top 5" : `Ver ${hiddenCategories} categorias mas`}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Evolucion</p>
              <h2 className="font-display text-3xl text-finance-ink">Ultimos 6 meses</h2>
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
        {summary.budgets.filter((item) => item.budget > 0).map((item) => (
          <BudgetBar key={item.id} label={item.name} spent={item.spent} budget={item.budget} type={item.type} color={item.color} />
        ))}
      </div>

      <TransactionTable transactions={state.transactions} categories={state.categories} onCategorize={handleCategorize} />
    </div>
  );
}
