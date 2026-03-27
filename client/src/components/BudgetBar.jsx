import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { fmtMoney } from "../utils";

export default function BudgetBar({ label, spent, budget, type, color, trend, currency = "UYU" }) {
  const progress = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const overrun  = progress >= 100;
  const warning  = !overrun && progress >= 80;

  const barColor = overrun ? "#E24B4A" : warning ? "#BA7517" : (color || "#534AB7");

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-neutral-900/80">
      <div className="flex items-center gap-4">

        {/* Main section */}
        <div className="min-w-0 flex-1">
          {/* Label row */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: barColor }}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-finance-ink">{label}</p>
                <p className="text-xs uppercase tracking-[0.14em] text-neutral-400">{type}</p>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs font-semibold text-finance-ink">{fmtMoney(spent, currency)}</p>
              {budget > 0 && (
                <p className={`text-[10px] ${overrun ? "text-finance-red font-bold" : "text-neutral-400"}`}>
                  {overrun ? `+${fmtMoney(spent - budget, currency)} excedido` : `de ${fmtMoney(budget, currency)}`}
                </p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {budget > 0 ? (
            <>
              <div className="relative h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: barColor }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-[10px] text-neutral-400">
                  {fmtMoney(Math.max(0, budget - spent), currency)} restante
                </span>
                <span className={`text-[10px] font-bold ${
                  overrun  ? "text-finance-red" :
                  warning  ? "text-finance-amber" :
                  "text-neutral-400"
                }`}>
                  {progress}%
                  {overrun && " ⚠"}
                </span>
              </div>
            </>
          ) : (
            <div className="h-2 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
              <div className="h-full w-full rounded-full bg-neutral-200 dark:bg-neutral-700" />
            </div>
          )}
        </div>

        {/* Sparkline */}
        {trend && trend.length > 1 && (
          <div className="hidden h-14 w-24 shrink-0 sm:block">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
                <Line
                  type="monotone"
                  dataKey="spent"
                  stroke={barColor}
                  strokeWidth={2}
                  dot={(props) => {
                    const isLast = props.index === trend.length - 1;
                    return isLast ? (
                      <circle
                        key={props.key}
                        cx={props.cx}
                        cy={props.cy}
                        r={3}
                        fill={barColor}
                        strokeWidth={0}
                      />
                    ) : null;
                  }}
                  activeDot={{ r: 3, fill: barColor }}
                />
                <Tooltip
                  formatter={(v) => [fmtMoney(v, currency), "Gasto"]}
                  labelFormatter={(l) => l}
                  contentStyle={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="mt-0.5 text-center text-[9px] uppercase tracking-widest text-neutral-400">
              tendencia
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
