import { monthLabel, shiftMonth } from "../utils";

export default function PeriodSelector({ month, onChange }) {
  return (
    <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-900/90">
      <button className="h-9 w-9 rounded-full bg-finance-cream text-lg text-finance-ink dark:hover:bg-neutral-700" onClick={() => onChange(shiftMonth(month, -1))}>
        ‹
      </button>
      <span className="min-w-24 text-center font-semibold text-finance-ink">{monthLabel(month)}</span>
      <button className="h-9 w-9 rounded-full bg-finance-cream text-lg text-finance-ink dark:hover:bg-neutral-700" onClick={() => onChange(shiftMonth(month, 1))}>
        ›
      </button>
    </div>
  );
}

