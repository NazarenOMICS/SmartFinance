import { useMemo, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";

export default function RuleReviewDeck({ groups, onDone, onClose, onAcceptedGroup }) {
  const { addToast } = useToast();
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const current = groups[index] || null;
  const visibleSamples = (current?.samples || []).slice(0, 3);
  const remaining = Math.max(groups.length - index, 0);
  const progress = useMemo(() => {
    if (groups.length === 0) return 0;
    return (index / groups.length) * 100;
  }, [groups.length, index]);

  function next() {
    if (index + 1 >= groups.length) onDone?.();
    else setIndex((prev) => prev + 1);
  }

  async function handleAccept() {
    if (!current || saving) return;
    setSaving(true);
    try {
      const rule = await api.createRule({
        pattern: current.pattern,
        category_id: current.category_id,
        mode: current.suggested_rule_mode || "auto",
        confidence: current.suggested_rule_confidence || 0.94,
        source: current.suggestion_source === "cloudflare-ai" ? "guided" : "learned",
      });

      await api.confirmCategory(current.transaction_ids, current.category_id, {
        ruleId: rule.id,
        origin: "upload_review",
      });

      setHistory((prev) => [
        ...prev,
        {
          type: "accept",
          ruleId: rule.id,
          transactionIds: current.transaction_ids,
          categoryId: current.category_id,
        },
      ]);
      onAcceptedGroup?.(current);
      addToast("success", `${current.count} movimiento${current.count !== 1 ? "s" : ""} pasan a "${current.category_name}".`);
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    if (!current || saving) return;
    setHistory((prev) => [...prev, { type: "skip" }]);
    next();
  }

  async function handleBack() {
    if (index === 0 || history.length === 0 || saving) return;
    const last = history[history.length - 1];
    setSaving(true);
    try {
      if (last.type === "accept") {
        await Promise.all(
          last.transactionIds.map((transactionId) =>
            api.undoConfirmCategory(transactionId, last.categoryId, { origin: "upload_review" }),
          ),
        );
        if (last.ruleId) {
          await api.deleteRule(last.ruleId);
        }
      }
      setHistory((prev) => prev.slice(0, -1));
      setIndex((prev) => Math.max(prev - 1, 0));
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-[30px] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Revision inteligente</p>
            <h3 className="mt-1 font-display text-2xl text-finance-ink dark:text-neutral-100">
              {current.pattern} {"->"} {current.category_name}
            </h3>
            <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-300">
              {current.reason || `Encontramos ${current.count} movimiento${current.count !== 1 ? "s" : ""} parecidos. Queres usarlos para crear una regla y categorizarlos asi?`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {current.priority ? (
                <span className="rounded-full bg-finance-purpleSoft px-2.5 py-1 text-[11px] font-semibold text-finance-purple dark:bg-purple-900/30 dark:text-purple-300">
                  Prioridad {current.priority}
                </span>
              ) : null}
              {current.suggested_rule_mode ? (
                <span className="rounded-full bg-finance-cream px-2.5 py-1 text-[11px] font-semibold text-finance-ink dark:bg-neutral-800 dark:text-neutral-200">
                  Regla {current.suggested_rule_mode === "auto" ? "auto" : "suggest"}
                </span>
              ) : null}
              {typeof current.suggested_rule_confidence === "number" ? (
                <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-500 dark:bg-neutral-800 dark:text-neutral-300">
                  Confianza {Math.round(current.suggested_rule_confidence * 100)}%
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            x
          </button>
        </div>

        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-finance-purple transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          {remaining} grupo{remaining !== 1 ? "s" : ""} restante{remaining !== 1 ? "s" : ""}.
        </p>

        <div className="mt-5 rounded-[26px] border border-neutral-200 bg-finance-cream/60 p-5 dark:border-neutral-700 dark:bg-neutral-800/80">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Ejemplos</p>
            {current.count > visibleSamples.length ? (
              <p className="text-xs text-neutral-400">
                Mostrando {visibleSamples.length} de {current.count}
              </p>
            ) : null}
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {visibleSamples.map((sample) => (
              <div
                key={sample}
                className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-finance-ink dark:bg-neutral-900/80 dark:text-neutral-100"
              >
                {sample}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={index === 0 || saving}
            className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-400 transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700"
          >
            Atras
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={saving}
            className="flex-1 rounded-2xl border-2 border-neutral-200 py-3 font-semibold text-neutral-500 transition hover:border-finance-red hover:text-finance-red dark:border-neutral-700 dark:hover:border-red-500 dark:hover:text-red-400"
          >
            No
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={saving}
            className="flex-1 rounded-2xl bg-finance-purple py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {current.suggested_rule_mode === "suggest" ? "Si, sugerir esta regla" : "Si, usar esta regla"}
          </button>
        </div>
      </div>
    </div>
  );
}
