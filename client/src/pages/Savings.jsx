import { useEffect, useRef, useState } from "react";
import { Area, Bar, BarChart, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

export default function Savings({ month, settings, refreshSettings }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", projection: null, insights: null });
  const loadRequestIdRef = useRef(0);
  const [form, setForm] = useState({
    savings_initial: settings.savings_initial || "0",
    savings_goal: settings.savings_goal || "200000",
    savings_currency: settings.savings_currency || "UYU"
  });

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [projection, insights] = await Promise.all([api.getProjection(month, 12), api.getInsights(month)]);
      if (loadRequestIdRef.current !== requestId) return;
      setState({ loading: false, error: "", projection, insights });
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setForm({
      savings_initial: settings.savings_initial || "0",
      savings_goal: settings.savings_goal || "200000",
      savings_currency: settings.savings_currency || "UYU"
    });
  }, [settings]);

  useEffect(() => { load(); }, [month]);

  async function handleSave() {
    try {
      await Promise.all(Object.entries(form).map(([key, value]) => api.updateSetting(key, value)));
      await refreshSettings();
      await load();
      addToast("success", "Configuracion guardada.");
    } catch (e) {
      addToast("error", e.message);
    }
  }

  if (state.loading) {
    return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Calculando proyeccion...</div>;
  }
  if (state.error) {
    return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;
  }

  const { projection, insights } = state;
  const historicalPoints = projection.series.filter((p) => p.real != null);
  const currentSavings = historicalPoints.length > 0
    ? historicalPoints[historicalPoints.length - 1].real
    : Number(form.savings_initial);
  const goalAmount = Number(form.savings_goal);
  const goalPct = goalAmount > 0 ? Math.min(100, Math.round((currentSavings / goalAmount) * 100)) : 0;
  const insightsCurrency = insights.currency || projection.currency;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">Capital inicial</span>
            <input
              className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              type="number"
              value={form.savings_initial}
              onChange={(e) => setForm((prev) => ({ ...prev, savings_initial: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">Objetivo</span>
            <input
              className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              type="number"
              value={form.savings_goal}
              onChange={(e) => setForm((prev) => ({ ...prev, savings_goal: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">Moneda proyeccion</span>
            <select
              className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              value={form.savings_currency}
              onChange={(e) => setForm((prev) => ({ ...prev, savings_currency: e.target.value }))}
            >
              <option value="UYU">UYU</option>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
          </label>
        </div>
        <button onClick={handleSave} className="self-end rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90">
          Guardar
        </button>
      </div>

      {goalAmount > 0 && (
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Progreso hacia el objetivo</p>
              <p className="mt-1 font-display text-2xl text-finance-ink">
                {fmtMoney(currentSavings, projection.currency)}
                <span className="ml-2 text-base font-normal text-neutral-400">
                  de {fmtMoney(goalAmount, projection.currency)}
                </span>
              </p>
            </div>
            <div className={`text-4xl font-display font-bold ${goalPct >= 100 ? "text-finance-teal" : goalPct >= 60 ? "text-finance-green" : "text-finance-blue"}`}>
              {goalPct}%
            </div>
          </div>
          <div className="mt-4 h-4 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                goalPct >= 100 ? "bg-finance-teal" : goalPct >= 60 ? "bg-finance-green" : "bg-finance-blue"
              }`}
              style={{ width: `${goalPct}%` }}
            />
          </div>
          {goalPct < 100 && insights.eta_months && (
            <p className="mt-2 text-xs text-neutral-400">
              ETA estimada: {insights.eta_months} meses · Faltan {fmtMoney(goalAmount - currentSavings, projection.currency)}
            </p>
          )}
          {goalPct >= 100 && (
            <p className="mt-2 text-xs font-semibold text-finance-teal">Objetivo alcanzado.</p>
          )}
        </div>
      )}

      {(() => {
        const thisMonthCommitment = projection.commitments.find((c) => c.month === month);
        const cuotasMes = thisMonthCommitment?.total || 0;
        return (
          <div className="grid gap-4 md:grid-cols-3">
            <MetricCard label="Ahorro promedio mensual" value={fmtMoney(projection.average_monthly_savings, projection.currency)} tone="text-finance-teal" />
            <MetricCard label={`Cuotas ${month}`} value={fmtMoney(cuotasMes, projection.currency)} tone="text-finance-amber" />
            <MetricCard label="Ahorro neto estimado" value={fmtMoney(projection.average_monthly_savings - cuotasMes, projection.currency)} tone="text-finance-blue" />
          </div>
        );
      })()}

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Serie historica y futura</p>
        <h2 className="font-display text-3xl text-finance-ink">Proyeccion de ahorro</h2>
        <div className="mt-4 flex gap-4 text-xs text-neutral-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full bg-finance-teal opacity-60" /> Ahorro real</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full border-t-2 border-dashed border-finance-blue" /> Proyeccion</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-5 rounded-full border-t-2 border-finance-amber opacity-70" /> Objetivo</span>
        </div>
        <div className="mt-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={projection.series}>
              <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => fmtMoney(value, projection.currency)} />
              <Area type="monotone" dataKey="real" stroke="#1D9E75" fill="#1D9E75" fillOpacity={0.12} strokeWidth={2} name="Ahorro real" />
              <Line type="monotone" dataKey="projected" stroke="#378ADD" strokeWidth={2} strokeDasharray="6 4" dot={false} name="Proyeccion" />
              <Line type="monotone" dataKey="goal" stroke="#BA7517" strokeWidth={1.5} dot={false} name="Objetivo" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Cuotas</p>
          <h2 className="font-display text-3xl text-finance-ink">Compromisos proximos</h2>
          <div className="mt-6 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={projection.commitments}>
                <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => fmtMoney(value, projection.currency)} />
                <Bar dataKey="total" fill="#BA7517" radius={[10, 10, 0, 0]} name="Cuotas" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-finance-blueSoft/70 p-6 shadow-panel dark:border-white/10 dark:bg-blue-900/20">
          <p className="text-xs uppercase tracking-[0.18em] text-finance-blue">Insights dinamicos</p>
          <div className="mt-4 space-y-4 text-sm text-finance-ink dark:text-neutral-200">
            <div className="flex items-start gap-2">
              <span className="text-base">📈</span>
              <p>
                <strong>Categoria que mas crecio:</strong>{" "}
                {insights.growth
                  ? `${insights.growth.category} (${Math.round(insights.growth.delta_pct)}%, ${fmtMoney(insights.growth.previous_amount, insightsCurrency)} -> ${fmtMoney(insights.growth.current_amount, insightsCurrency)})`
                  : "sin suficiente historico"}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-base">📅</span>
              <p><strong>Gasto promedio diario:</strong> {fmtMoney(insights.daily_average_spend, insightsCurrency)}</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-base">{insights.budget_exhausted ? "🔴" : "🟡"}</span>
              <p>
                {insights.budget_exhausted
                  ? <><strong>Presupuesto agotado:</strong> superaste el limite por {fmtMoney(Math.abs(insights.remaining_budget), insightsCurrency)} con {insights.days_left} dias restantes.</>
                  : <>Quedan <strong>{insights.days_left} dias</strong> y <strong>{fmtMoney(insights.remaining_budget, insightsCurrency)}</strong> de presupuesto ({fmtMoney(insights.budget_per_day, insightsCurrency)}/dia).</>}
              </p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-base">🎯</span>
              <p><strong>ETA al objetivo:</strong> {insights.eta_months ? `${insights.eta_months} meses` : "aun no estimable"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
