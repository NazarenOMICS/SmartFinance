import { fmtPct } from "../utils";

export default function MetricCard({ label, value, delta, tone = "text-finance-ink" }) {
  return (
    <div className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/85">
      <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className={`font-display text-3xl ${tone}`}>{value}</p>
        {delta != null ? (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${delta > 0 ? "bg-finance-redSoft text-finance-red" : "bg-finance-greenSoft text-finance-teal"}`}>
            {fmtPct(delta)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

