import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import CategorySelect from "./CategorySelect";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";

function formatSuggestionSource(source) {
  if (source === "rule_suggest" || source === "regla") return "Regla";
  if (source === "heuristica" || source === "keyword" || source === "history") return "Heurística";
  if (source === "ollama") return "Ollama";
  if (source === "ollama_new_category") return "Categoría nueva sugerida";
  if (source === "fallback_new_category") return "Nueva categoría sugerida";
  return "Sugerencia";
}

export default function TransactionReviewDeck({ items, categories, onDone, onClose, onCategoryCreated }) {
  const { addToast } = useToast();
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const otherCategory = useMemo(
    () => categories.find((category) => String(category.name || "").toLowerCase() === "otros") || null,
    [categories]
  );

  const current = items[index] || null;
  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    return ((index + 1) / items.length) * 100;
  }, [items.length, index]);

  useEffect(() => {
    if (index >= items.length && items.length > 0) {
      setIndex(items.length - 1);
    }
    if (items.length === 0) {
      setIndex(0);
    }
  }, [items.length, index]);

  useEffect(() => {
    setSelectedCategoryId(current?.suggested_category_id ? String(current.suggested_category_id) : "");
  }, [current?.transaction_id, current?.suggested_category_id]);

  function next() {
    if (index + 1 >= items.length) {
      onDone?.();
    } else {
      setIndex((prev) => prev + 1);
    }
  }

  async function applyCategory(categoryId, options = {}) {
    if (!current || saving || !categoryId) return;
    setSaving(true);
    try {
      const result = await api.updateTransaction(current.transaction_id, { category_id: Number(categoryId) });
      setHistory((prev) => [...prev, {
        type: "apply",
        transactionId: current.transaction_id,
        previousCategoryId: null,
        createdRuleId: result?.rule?.created ? result?.rule?.rule?.id : null,
        createdCategoryId: options.createdCategoryId || null,
      }]);
      addToast("success", "Categoria aplicada.");
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAcceptSuggestion() {
    if (!current || saving) return;
    if (current.suggested_category_id) {
      await applyCategory(current.suggested_category_id);
      return;
    }

    if (current.proposed_new_category) {
      setSaving(true);
      try {
        const created = await api.createCategory({
          name: current.proposed_new_category.name,
          type: current.proposed_new_category.type || "variable",
          budget: 0,
          color: current.proposed_new_category.color,
        });
        onCategoryCreated?.();
        setSaving(false);
        await applyCategory(created.id, { createdCategoryId: created.id });
      } catch (error) {
        setSaving(false);
        addToast("error", error.message);
      }
      return;
    }

    addToast("warning", "No hay una categoría sugerida lista para aceptar.");
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
      if (last.type === "apply") {
        await api.updateTransaction(last.transactionId, { category_id: last.previousCategoryId });
        if (last.createdRuleId) {
          await api.deleteRule(last.createdRuleId);
        }
        if (last.createdCategoryId) {
          await api.deleteCategory(last.createdCategoryId).catch(() => {});
          onCategoryCreated?.();
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Revisión individual</p>
            <h3 className="mt-1 font-display text-3xl text-finance-ink dark:text-neutral-100">
              Ajustemos lo que todavía no quedó claro
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-300">
              Cada movimiento tiene una sugerencia para que no quede bajo una categoría incorrecta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            x
          </button>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-finance-purple transition-all" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-5 rounded-[28px] border border-neutral-200 bg-finance-cream/60 p-5 dark:border-neutral-700 dark:bg-neutral-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-finance-purple dark:bg-neutral-900/85 dark:text-purple-200">
              {formatSuggestionSource(current.suggestion_source)}
            </span>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-300">
              {current.fecha}
            </span>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-300">
              {fmtMoney(current.monto, current.moneda)}
            </span>
          </div>

          <p className="mt-4 text-lg font-semibold text-finance-ink dark:text-neutral-100">
            {current.desc_banco}
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
            {current.suggestion_reason || "Sugerencia del motor"}
          </p>

          <div className="mt-4 rounded-2xl bg-white/80 px-4 py-4 dark:bg-neutral-900/80">
            <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Categoria sugerida</p>
            {current.suggested_category_id ? (
              <p className="mt-1 text-lg font-semibold text-finance-ink dark:text-neutral-100">
                {current.suggested_category_name}
              </p>
            ) : (
              <div className="mt-2">
                <p className="text-lg font-semibold text-finance-ink dark:text-neutral-100">
                  {current.proposed_new_category?.name || current.suggested_category_name}
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                  Categoria nueva sugerida en modo {current.proposed_new_category?.type || "variable"}
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="mt-5 rounded-[26px] border border-neutral-200 bg-white/80 p-5 dark:border-neutral-700 dark:bg-neutral-950/60">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Cambiar categoría</p>
          {otherCategory ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyCategory(otherCategory.id)}
                disabled={saving}
                className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                Mandar a Otros
              </button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <CategorySelect
                categories={categories}
                value={selectedCategoryId}
                onChange={(value) => setSelectedCategoryId(String(value))}
                onCategoryCreated={onCategoryCreated}
              />
            </div>
            <button
              type="button"
              onClick={() => applyCategory(selectedCategoryId)}
              disabled={saving || !selectedCategoryId}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-finance-ink transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
            >
              Usar esta otra
            </button>
          </div>
          <p className="mt-2 text-xs leading-6 text-neutral-500 dark:text-neutral-300">
            Si no existe, podés crear una desde el selector.
          </p>
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
              onClick={handleSkip}
              disabled={saving}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-finance-ink dark:border-neutral-700"
            >
              Omitir
            </button>
          </div>

          <button
            type="button"
            onClick={handleAcceptSuggestion}
            disabled={saving}
            className="rounded-2xl bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {current.suggested_category_id ? "Aceptar sugerencia" : "Crear y usar sugerencia"}
          </button>
        </div>
      </div>
    </div>
  );
}
