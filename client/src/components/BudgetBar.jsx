import { fmtMoney } from "../utils";

export default function BudgetBar({ label, spent, budget, type, color }) {
  const progress = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const tone = progress >= 100 ? "bg-finance-red" : progress >= 80 ? "bg-finance-amber" : "";

  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-finance-ink">{label}</p>
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">{type}</p>
        </div>
        <p className="text-xs text-neutral-500">
          {fmtMoney(spent)} / {fmtMoney(budget)}
        </p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-neutral-100">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: tone ? undefined : color || "#888780" }}
        />
      </div>
    </div>
  );
}

