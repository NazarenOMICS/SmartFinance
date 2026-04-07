import { useState } from "react";
import {
  Bar, BarChart, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { fmtMoney } from "../utils";

/**
 * Monthly comparison: shows spending delta between current month and previous,
 * broken down by category, in a grouped horizontal bar chart.
 *
 * Props:
 *   current  - summary.byCategory for the current month
 *   previous - summary.byCategory for the previous month (fetched separately)
 *   loading  - boolean
 */
export default function MonthComparison({ current = [], previous = [], loading, currency = "UYU" }) {
  const [hiddenCats, setHiddenCats] = useState(new Set());

  function toggleCat(name) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      </div>
    );
  }

  const allCatNames = [...new Set([
    ...current.map((c) => c.name),
    ...previous.map((c) => c.name),
  ])];

  const data = allCatNames
    .map((name) => {
      const cur = current.find((c) => c.name === name);
      const prev = previous.find((c) => c.name === name);
      const curSpent = cur?.spent || 0;
      const prevSpent = prev?.spent || 0;
      const delta = prevSpent > 0
        ? Math.round(((curSpent - prevSpent) / prevSpent) * 100)
        : null;
      return {
        name,
        actual: curSpent,
        anterior: prevSpent,
        color: cur?.color || prev?.color || "#888780",
        delta,
      };
    })
    .filter((d) => d.actual > 0 || d.anterior > 0)
    .sort((a, b) => b.actual - a.actual);

  const MAX_ITEMS = 8;
  const rows = data.slice(0, MAX_ITEMS).filter((d) => !hiddenCats.has(d.name));

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const cur = payload.find((p) => p.dataKey === "actual")?.value || 0;
    const prev = payload.find((p) => p.dataKey === "anterior")?.value || 0;
    const diff = cur - prev;

    return (
      <div className="rounded-2xl border border-neutral-100 bg-white p-3 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <p className="mb-1 font-semibold text-finance-ink">{label}</p>
        <p className="text-finance-purple">Este mes: {fmtMoney(cur, currency)}</p>
        <p className="text-neutral-400">Mes ant.: {fmtMoney(prev, currency)}</p>
        {prev > 0 && (
          <p className={`mt-1 font-bold ${diff > 0 ? "text-finance-red" : "text-finance-teal"}`}>
            {diff > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(diff), currency)} ({Math.abs(Math.round((diff / prev) * 100))}%)
          </p>
        )}
      </div>
    );
  };

  const significant = data.filter((d) => d.delta !== null && d.anterior > 0);
  const topGrowth = significant.sort((a, b) => b.delta - a.delta)[0];
  const topSaving = [...significant].sort((a, b) => a.delta - b.delta)[0];

  return (
    <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Comparativa</p>
        <h2 className="font-display text-3xl text-finance-ink">Este mes vs anterior</h2>
      </div>

      {(topGrowth || topSaving) && (
        <div className="mb-4 flex flex-wrap gap-2">
          {topGrowth && topGrowth.delta > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-finance-redSoft px-3 py-1.5 text-xs dark:bg-red-900/25">
              <span className="text-finance-red">▲</span>
              <span className="font-semibold text-finance-red">{topGrowth.name}</span>
              <span className="text-finance-red/70">+{topGrowth.delta}% vs mes ant.</span>
            </div>
          )}
          {topSaving && topSaving.delta < -5 && (
            <div className="flex items-center gap-1.5 rounded-full bg-finance-tealSoft px-3 py-1.5 text-xs dark:bg-teal-900/25">
              <span className="text-finance-teal">▼</span>
              <span className="font-semibold text-finance-teal">{topSaving.name}</span>
              <span className="text-finance-teal/70">{topSaving.delta}% vs mes ant.</span>
            </div>
          )}
        </div>
      )}

      {data.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {data.slice(0, MAX_ITEMS).map((cat) => (
            <button
              key={cat.name}
              type="button"
              onClick={() => toggleCat(cat.name)}
              className="rounded-full border px-2.5 py-1 text-xs font-medium transition"
              style={{
                color: cat.color,
                borderColor: `${cat.color}55`,
                opacity: hiddenCats.has(cat.name) ? 0.3 : 1,
              }}
            >
              {cat.name}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-neutral-400">No hay datos suficientes para comparar.</p>
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
              barCategoryGap="25%"
              barGap={2}
            >
              <XAxis
                type="number"
                tick={{ fill: "#737373", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => fmtMoney(v, currency)}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={90}
                tick={{ fill: "#525252", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                iconType="circle"
                iconSize={8}
                formatter={(value) => (
                  <span className="text-xs text-neutral-500">
                    {value === "actual" ? "Este mes" : "Mes anterior"}
                  </span>
                )}
              />
              <Bar dataKey="anterior" radius={[0, 6, 6, 0]} name="anterior">
                {rows.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} opacity={0.28} />
                ))}
              </Bar>
              <Bar dataKey="actual" radius={[0, 6, 6, 0]} name="actual">
                {rows.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} opacity={1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {data.length > MAX_ITEMS && (
        <p className="mt-2 text-center text-xs text-neutral-400">
          Mostrando {MAX_ITEMS} de {data.length} categorías
        </p>
      )}
    </div>
  );
}
