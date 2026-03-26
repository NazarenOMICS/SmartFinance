import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtMoney } from "../utils";

export default function Recurring({ month }) {
  const [state, setState] = useState({ loading: true, error: "", data: [] });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const data = await api.getRecurring(month);
      setState({ loading: false, error: "", data });
    } catch (e) {
      setState((prev) => ({ ...prev, loading: false, error: e.message }));
    }
  }

  useEffect(() => { load(); }, [month]);

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Analizando patrones…</div>;
  if (state.error)   return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  const recurring = state.data;

  return (
    <div className="space-y-6">
      {/* Header card */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Gastos recurrentes</p>
        <h2 className="font-display text-3xl text-finance-ink">Detectados automáticamente</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Transacciones que aparecen en al menos 2 de los últimos 4 meses. Útil para identificar suscripciones y gastos fijos recurrentes.
        </p>

        {recurring.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-finance-cream/60 px-5 py-8 text-center dark:bg-neutral-800/40">
            <p className="text-3xl">◈</p>
            <p className="mt-3 text-neutral-500">No se detectaron patrones recurrentes todavía. Necesitás más de 1 mes de datos.</p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-neutral-100 pb-2 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
              <span>Descripción</span>
              <span>Categoría</span>
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
                      Sin categoría
                    </span>
                  )}
                </div>
                <span className="self-center text-right font-semibold text-finance-red dark:text-red-300">
                  {fmtMoney(-item.avg_amount, item.moneda)}
                </span>
                <span className="self-center text-right text-sm text-neutral-500">
                  {item.occurrences}×
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
              <p className="font-display text-3xl text-finance-ink">
                {fmtMoney(recurring.reduce((s, r) => s + r.avg_amount, 0))}
              </p>
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
