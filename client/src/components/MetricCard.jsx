import { fmtPct } from "../utils";

export default function MetricCard({ label, value, delta, tone = "text-finance-ink", onClick, positiveIsGood = false }) {
  const Tag = onClick ? "button" : "div";
  // positiveIsGood=true: green when delta>0 (e.g. income increased)
  // positiveIsGood=false (default): red when delta>0 (e.g. spending increased)
  const isBad = positiveIsGood ? delta < 0 : delta > 0;
  return (
    <Tag
      onClick={onClick}
      className={`rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/85 text-left w-full ${
        onClick ? "cursor-pointer transition hover:border-finance-purple/40 hover:shadow-lg active:scale-[0.98]" : ""
      }`}
    >
      <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">{label}</p>
      <div className="mt-3 flex items-end justify-between gap-3">
        <p className={`font-display text-3xl ${tone}`}>{value}</p>
        {delta != null ? (
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${isBad ? "bg-finance-redSoft text-finance-red" : "bg-finance-greenSoft text-finance-teal"}`}>
            {fmtPct(delta)}
          </span>
        ) : null}
      </div>
      {onClick && (
        <p className="mt-2 text-[10px] uppercase tracking-[0.18em] text-neutral-300 dark:text-neutral-600">Ver detalle →</p>
      )}
    </Tag>
  );
}

