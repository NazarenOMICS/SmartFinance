import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmtMoney } from "../utils";

export default function Recurring({ month }) {
  const [state, setState] = useState({ loading: true, error: "", data: [] });
  const loadRequestIdRef = useRef(0);

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await api.getRecurring(month);
      if (loadRequestIdRef.current !== requestId) return;
      setState({ loading: false, error: "", data });
    } catch (e) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: e.message }));
    }
  }

  useEffect(() => { load(); }, [month]);

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">{"Analizando patrones\u2026"}</div>;
  if (state.error)   return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  const recurring = state.data;
  const totalsByCurrency = recurring.reduce((acc, item) => {
    acc[item.moneda] = (acc[item.moneda] || 0) + item.avg_amount;
    return acc;
  }, {});
  const recurringTotals = Object.entries(totalsByCurrency).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Gastos recurrentes</p>
        <h2 className="font-display text-3xl text-finance-ink">{"Detectados autom\u00E1ticamente"}</h2>
        <p className="mt-2 text-sm text-neutral-500">
          {"Transacciones que se repiten en varios meses. \u00DAtil para identificar suscripciones y gastos fijos recurrentes."}
        </p>

        {recurring.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-finance-cream/60 px-5 py-8 text-center dark:bg-neutral-800/40">
            <p className="text-3xl">{"\u25C8"}</p>
            <p className="mt-3 text-neutral-500">{"No se detectaron patrones recurrentes todav\u00EDa. Necesit\u00E1s movimientos repetidos en al menos 2 meses."}</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-neutral-100 pb-2 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
              <span>{"Descripci\u00F3n"}</span>
              <span>{"Categor\u00EDa"}</span>
              <span className="text-right">Promedio/mes</span>
              <span className="text-right">Veces</span>
            </div>
            {recurring.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_auto_auto_auto] gap-4 rounded-2xl bg-finance-cream/50 px-4 py-3 dark:bg-neutral-800/50"
              >
                <div>
                  <p className="font-semibold text-finance-ink dark:text-neutral-200">{item.desc_banco}</p>
                  <p className="text-xs text-neutral-400">
                    Meses: {item.months_seen.join(", ")}
                  </p>
                </div>
                <div className="flex items-center">
                  {item.category_name ? (
                    <span
                      className="rounded-full px-3 py-1 text-xs font-semibold text-white"
                      style={{ backgroundColor: item.category_color || "#888780" }}
                    >
                      {item.category_name}
                    </span>
                  ) : (
                    <span className="rounded-full bg-finance-amberSoft px-3 py-1 text-xs font-semibold text-finance-amber dark:bg-amber-900/30 dark:text-amber-300">
                      {"Sin categor\u00EDa"}
                    </span>
                  )}
                </div>
                <span className="self-center text-right font-semibold text-finance-red dark:text-red-300">
                  {fmtMoney(-item.avg_amount, item.moneda)}
                </span>
                <span className="self-center text-right text-sm text-neutral-500">
                  {item.occurrences}{"\u00D7"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary */}
      {recurring.length > 0 && (
        <div className="rounded-[32px] border border-white/70 bg-finance-purpleSoft/60 p-6 shadow-panel dark:border-white/10 dark:bg-purple-900/20">
          <p className="text-xs uppercase tracking-[0.18em] text-finance-purple">Resumen de recurrentes</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-sm text-neutral-500">Gastos recurrentes detectados</p>
              <p className="font-display text-3xl text-finance-purple">{recurring.length}</p>
            </div>
            <div>
              <p className="text-sm text-neutral-500">Costo mensual promedio total</p>
              {recurringTotals.length === 1 ? (
                <p className="font-display text-3xl text-finance-ink">
                  {fmtMoney(recurringTotals[0][1], recurringTotals[0][0])}
                </p>
              ) : (
                <div className="space-y-1">
                  {recurringTotals.map(([currency, total]) => (
                    <p key={currency} className="font-display text-2xl text-finance-ink">
                      {fmtMoney(total, currency)}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm text-neutral-500">Sin categorizar</p>
              <p className="font-display text-3xl text-finance-amber">
                {recurring.filter((r) => !r.category_name).length}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
