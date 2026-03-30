import { useMemo, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";

export default function GuidedCategorizationDeck({ groups, onComplete, onFollowLater, onSkip, onAcceptedGroup }) {
  const { addToast } = useToast();
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);

  const current = groups[index] || null;
  const visibleSamples = (current?.samples || []).slice(0, 3);
  const remaining = Math.max(groups.length - index, 0);
  const progress = useMemo(() => {
    if (groups.length === 0) return 0;
    return ((index + 1) / groups.length) * 100;
  }, [groups.length, index]);

  function next() {
    if (index + 1 >= groups.length) {
      onComplete?.();
    } else {
      setIndex((prev) => prev + 1);
    }
  }

  async function resolveRuleForAction(nextMode, nextConfidence, source) {
    const rule = await api.createRule({
      pattern: current.pattern,
      category_id: current.category_id,
      mode: nextMode,
      confidence: nextConfidence,
      source,
    });

    if (!rule.duplicate) {
      return {
        activeRule: { id: rule.id, mode: nextMode, confidence: nextConfidence },
        previousRule: null,
        created: true,
      };
    }

    const previousRule = {
      id: rule.id,
      mode: rule.mode,
      confidence: Number(rule.confidence ?? nextConfidence),
    };

    if (rule.mode !== nextMode || Number(rule.confidence ?? nextConfidence) !== Number(nextConfidence)) {
      await api.updateRule(rule.id, { mode: nextMode, confidence: nextConfidence });
    }

    return {
      activeRule: { id: rule.id, mode: nextMode, confidence: nextConfidence },
      previousRule,
      created: false,
    };
  }

  async function handleAccept() {
    if (!current || saving) return;
    setSaving(true);
    try {
      const ruleState = await resolveRuleForAction(
        current.suggested_rule_mode || "suggest",
        Number(current.suggested_rule_confidence || 0.84),
        "guided"
      );
      await api.confirmCategory(current.transaction_ids, current.category_id, {
        ruleId: ruleState.activeRule.id,
        origin: "guided_onboarding",
      });
      setHistory((prev) => [...prev, {
        type: "accept",
        transactionIds: current.transaction_ids,
        categoryId: current.category_id,
        ruleId: ruleState.activeRule.id,
        previousRule: ruleState.previousRule,
        createdRule: ruleState.created,
      }]);
      onAcceptedGroup?.(current);
      addToast("success", `${current.count} movimiento${current.count !== 1 ? "s" : ""} quedan en "${current.category_name}".`);
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!current || saving) return;
    setSaving(true);
    try {
      const ruleState = await resolveRuleForAction("disabled", 0.51, "guided_reject");
      await Promise.all(
        current.transaction_ids.map((transactionId) =>
          api.rejectCategory(transactionId, ruleState.activeRule.id, { origin: "guided_onboarding" })
        )
      );
      setHistory((prev) => [...prev, {
        type: "reject",
        transactionIds: current.transaction_ids,
        ruleId: ruleState.activeRule.id,
        previousRule: ruleState.previousRule,
        createdRule: ruleState.created,
      }]);
      addToast("info", `No vamos a aprender "${current.pattern}" automaticamente por ahora.`);
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleBack() {
    if (index === 0 || history.length === 0 || saving) return;
    const last = history[history.length - 1];
    setSaving(true);
    try {
      if (last.type === "accept") {
        await Promise.all(
          last.transactionIds.map((transactionId) =>
            api.undoConfirmCategory(transactionId, last.categoryId, { origin: "guided_onboarding" })
          )
        );
      } else if (last.type === "reject") {
        await Promise.all(
          last.transactionIds.map((transactionId) =>
            api.undoRejectCategory(transactionId, last.ruleId, { origin: "guided_onboarding" })
          )
        );
      }

      if (last.previousRule) {
        await api.updateRule(last.previousRule.id, {
          mode: last.previousRule.mode,
          confidence: last.previousRule.confidence,
        });
      } else if (last.createdRule && last.ruleId) {
        await api.deleteRule(last.ruleId);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onFollowLater?.(); }}
    >
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Aprendizaje guiado</p>
            <h3 className="mt-1 font-display text-3xl text-finance-ink dark:text-neutral-100">
              Ayudanos a evitar errores escondidos
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-300">
              Antes de ir al dashboard, revisemos unos patrones claros. Así evitamos que una mala categoría quede enterrada en tus métricas.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onFollowLater?.()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            x
          </button>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-finance-purple transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          Carta {index + 1} de {groups.length}. Quedan {remaining} por revisar.
        </p>

        <div className="mt-5 rounded-[28px] border border-finance-purple/15 bg-finance-purpleSoft/60 p-5 dark:border-finance-purple/20 dark:bg-purple-900/20">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-finance-purple dark:bg-neutral-900/85 dark:text-purple-200">
              {current.priority === "high" ? "Alta claridad" : "Sugerencia cuidada"}
            </span>
            {current.risk_label ? (
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-300">
                {current.risk_label}
              </span>
            ) : null}
          </div>

          <h4 className="mt-4 font-display text-2xl text-finance-ink dark:text-neutral-100">
            {current.pattern} {"->"} {current.category_name}
          </h4>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {current.guided_reason || "Patrón claro para aprender más rápido"}.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/80 px-4 py-3 dark:bg-neutral-900/80">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Impacto</p>
              <p className="mt-1 text-lg font-semibold text-finance-ink dark:text-neutral-100">
                {current.count} movimiento{current.count !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="rounded-2xl bg-white/80 px-4 py-3 dark:bg-neutral-900/80">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Aprendizaje</p>
              <p className="mt-1 text-sm font-semibold text-finance-ink dark:text-neutral-100">
                {current.suggested_rule_mode === "auto" ? "Regla automática" : "Regla en modo sugerencia"}
              </p>
            </div>
            <div className="rounded-2xl bg-white/80 px-4 py-3 dark:bg-neutral-900/80">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Objetivo</p>
              <p className="mt-1 text-sm font-semibold text-finance-ink dark:text-neutral-100">
                Evitar mala categorización silenciosa
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[26px] border border-neutral-200 bg-finance-cream/60 p-5 dark:border-neutral-700 dark:bg-neutral-800/80">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Ejemplos reales</p>
            {current.count > visibleSamples.length ? (
              <p className="text-xs text-neutral-400">
                Mostrando {visibleSamples.length} de {current.count}
              </p>
            ) : null}
          </div>
          <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
            {visibleSamples.map((sample) => (
              <div key={sample} className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-finance-ink dark:bg-neutral-900/80 dark:text-neutral-100">
                {sample}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
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
              onClick={() => onFollowLater?.()}
              disabled={saving}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-finance-ink dark:border-neutral-700"
            >
              Seguir despues
            </button>
            <button
              type="button"
              onClick={() => onSkip?.()}
              disabled={saving}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-finance-red hover:text-finance-red dark:border-neutral-700"
            >
              Omitir por ahora
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleReject}
              disabled={saving}
              className="rounded-2xl border-2 border-neutral-200 px-5 py-3 font-semibold text-neutral-500 transition hover:border-finance-red hover:text-finance-red dark:border-neutral-700 dark:hover:border-red-500 dark:hover:text-red-400"
            >
              No
            </button>
            <button
              type="button"
              onClick={handleAccept}
              disabled={saving}
              className="rounded-2xl bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              Si, usar esto para aprender
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
