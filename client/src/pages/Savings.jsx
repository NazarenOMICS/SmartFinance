import { useEffect, useState } from "react";
import { Area, AreaChart, Bar, BarChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

export default function Savings({ month, settings, refreshSettings, dataVersion }) {
  const [state, setState] = useState({ loading: true, error: "", projection: null, insights: null });
  const [form, setForm] = useState({
    savings_initial: settings.savings_initial || "50000",
    savings_goal: settings.savings_goal || "200000",
    savings_currency: settings.savings_currency || "UYU"
  });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [projection, insights] = await Promise.all([api.getProjection(month, 12), api.getInsights(month)]);
      setState({ loading: false, error: "", projection, insights });
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setForm({
      savings_initial: settings.savings_initial || "50000",
      savings_goal: settings.savings_goal || "200000",
      savings_currency: settings.savings_currency || "UYU"
    });
  }, [settings]);

  useEffect(() => {
    load();
  }, [month, dataVersion]);

  async function handleSave() {
    await Promise.all(
      Object.entries(form).map(([key, value]) => {
        return api.updateSetting(key, value);
      })
    );
    await refreshSettings();
    await load();
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Calculando proyección…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;

  const { projection, insights } = state;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-4 md:grid-cols-3">
          <input className="rounded-2xl border border-neutral-200 bg-white px-4 py-3" value={form.savings_initial} onChange={(event) => setForm((prev) => ({ ...prev, savings_initial: event.target.value }))} />
          <input className="rounded-2xl border border-neutral-200 bg-white px-4 py-3" value={form.savings_goal} onChange={(event) => setForm((prev) => ({ ...prev, savings_goal: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 bg-white px-4 py-3" value={form.savings_currency} onChange={(event) => setForm((prev) => ({ ...prev, savings_currency: event.target.value }))}>
            <option value="UYU">UYU</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <button onClick={handleSave} className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">
          Guardar
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Ahorro promedio" value={fmtMoney(projection.average_monthly_savings, projection.currency)} tone="text-finance-teal" />
        <MetricCard label="Cuotas proyectadas" value={fmtMoney(projection.commitments[0]?.total || 0, projection.currency)} tone="text-finance-amber" />
        <MetricCard label="Ahorro neto" value={fmtMoney(projection.average_monthly_savings - (projection.commitments[0]?.total || 0), projection.currency)} tone="text-finance-blue" />
      </div>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Serie histórica y futura</p>
        <h2 className="font-display text-3xl text-finance-ink">Proyección de ahorro</h2>
        <div className="mt-6 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={projection.series}>
              <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => fmtMoney(value, projection.currency)} />
              <Area type="monotone" dataKey="real" stroke="#1D9E75" fill="#1D9E75" fillOpacity={0.12} strokeWidth={2} />
              <Line type="monotone" dataKey="projected" stroke="#378ADD" strokeWidth={2} strokeDasharray="6 4" dot={false} />
              <Line type="monotone" dataKey="goal" stroke="#BA7517" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Cuotas</p>
          <h2 className="font-display text-3xl text-finance-ink">Compromisos próximos</h2>
          <div className="mt-6 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projection.commitments}>
                <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => fmtMoney(value, projection.currency)} />
                <Bar dataKey="total" fill="#BA7517" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-finance-blueSoft/70 p-6 shadow-panel">
          <p className="text-xs uppercase tracking-[0.18em] text-finance-blue">Insights dinámicos</p>
          <div className="mt-4 space-y-4 text-sm text-finance-ink">
            <p>
              Categoría que más creció:{" "}
              {insights.growth
                ? `${insights.growth.category} (${Math.round(insights.growth.delta_pct)}%, ${fmtMoney(insights.growth.previous_amount)} → ${fmtMoney(insights.growth.current_amount)})`
                : "sin suficiente histórico"}
            </p>
            <p>Gasto promedio diario: {fmtMoney(insights.daily_average_spend)}</p>
            <p>
              Quedan {insights.days_left} días y {fmtMoney(insights.remaining_budget)} de presupuesto ({fmtMoney(insights.budget_per_day)}/día).
            </p>
            <p>ETA al objetivo: {insights.eta_months ? `${insights.eta_months} meses` : "aún no estimable"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

