import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import CategorySelect from "../components/CategorySelect";
import CandidateReview from "../components/CandidateReview";
import { fmtMoney } from "../utils";
import {
  clearPendingReviewSession,
  writePendingReviewSession,
} from "../utils/pendingReviewSession";

export default function Recurring({ month, userId, resumePendingReview = null, onConsumeResumePendingReview, onInvalidResumePendingReview }) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", data: [] });
  const [categories, setCategories] = useState([]);
  const [savingRule, setSavingRule] = useState(null);
  const [pendingReview, setPendingReview] = useState(null);
  const loadRequestIdRef = useRef(0);

  async function loadCategories() {
    try {
      const cats = await api.getCategories();
      setCategories(cats);
    } catch {
      // silent
    }
  }

  async function handleCategorize(item, categoryId, options = {}) {
    setSavingRule(item.desc_banco);
    try {
      const normalizedCategoryId = Number(categoryId);
      const categoryName = categories.find((cat) => cat.id === normalizedCategoryId)?.name;
      const result = await api.createRule({
        pattern: item.desc_banco,
        category_id: normalizedCategoryId,
        mode: options.mode || item.suggested_rule_mode || "suggest",
        confidence: options.confidence ?? item.suggestion_confidence ?? 0.82,
        source: options.source || (item.suggestion_provider === "cloudflare-ai" ? "guided" : "learned"),
      });

      if (result?.duplicate) {
        addToast("info", `Regla para "${item.desc_banco}" ya existe.`);
      } else if (result?.candidates_count > 0) {
        const review = {
          pattern: result.pattern,
          categoryId: normalizedCategoryId,
          categoryName,
          ruleId: result.id || null,
        };
        setPendingReview(review);
        rememberPendingReview(review);
        addToast("info", `Regla creada: "${result.pattern}" → ${categoryName || "categoría"}. Hay ${result.candidates_count} transacciones similares para revisar.`);
      } else {
        addToast("success", `Aprendido: las próximas transacciones con "${result.pattern}" se categorizarán automáticamente.`);
      }

      await load();
      await loadCategories();
    } catch (e) {
      addToast("error", e.message);
    } finally {
      setSavingRule(null);
    }
  }

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

  useEffect(() => {
    load();
    loadCategories();
  }, [month]);

  useEffect(() => {
    if (!resumePendingReview || categories.length === 0) return;
    if (resumePendingReview.source !== "recurring") return;

    const categoryId = Number(resumePendingReview.categoryId);
    const category = categories.find((item) => item.id === categoryId);

    if (!category) {
      clearPendingReviewSession(userId);
      onInvalidResumePendingReview?.();
      return;
    }

    setPendingReview({
      pattern: resumePendingReview.pattern,
      categoryId,
      categoryName: resumePendingReview.categoryName || category.name,
      ruleId: resumePendingReview.ruleId || null,
    });
    onConsumeResumePendingReview?.();
  }, [resumePendingReview, categories, userId, onConsumeResumePendingReview, onInvalidResumePendingReview]);

  function rememberPendingReview(review) {
    if (!userId) return;
    writePendingReviewSession(userId, {
      source: "recurring",
      pattern: review.pattern,
      categoryId: review.categoryId,
      categoryName: review.categoryName,
      ruleId: review.ruleId || null,
      createdAt: new Date().toISOString(),
    });
  }

  function clearRememberedPendingReview() {
    clearPendingReviewSession(userId);
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Analizando patrones...</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  const recurring = state.data;
  const totalsByCurrency = recurring.reduce((acc, item) => {
    acc[item.moneda] = (acc[item.moneda] || 0) + item.avg_amount;
    return acc;
  }, {});
  const recurringTotals = Object.entries(totalsByCurrency).sort(([left], [right]) => left.localeCompare(right));

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Gastos recurrentes</p>
        <h2 className="font-display text-3xl text-finance-ink">Detectados automáticamente</h2>
        <p className="mt-2 text-sm text-neutral-500">
          Transacciones que se repiten en varios meses. Útil para identificar suscripciones y gastos fijos recurrentes.
        </p>

        {recurring.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-finance-cream/60 px-5 py-8 text-center dark:bg-neutral-800/40">
            <p className="text-3xl">◈</p>
            <p className="mt-3 text-neutral-500">No se detectaron patrones recurrentes todavía. Necesitás movimientos repetidos en al menos 2 meses.</p>
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
                  ) : savingRule === item.desc_banco ? (
                    <span className="text-xs text-neutral-400">Guardando...</span>
                  ) : item.suggested_category_id ? (
                    <div className="flex w-64 flex-col items-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleCategorize(item, item.suggested_category_id, {
                          mode: item.suggested_rule_mode || "suggest",
                          confidence: item.suggestion_confidence ?? 0.82,
                          source: item.suggestion_provider === "cloudflare-ai" ? "guided" : "learned",
                        })}
                        className="rounded-full bg-finance-purple px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
                      >
                        Aceptar {item.suggested_category_name}
                      </button>
                      <p className="max-w-xs text-right text-[11px] text-neutral-500 dark:text-neutral-400">
                        {item.suggestion_reason || "Hay una sugerencia lista para convertir este patron en regla."}
                      </p>
                      <div className="w-full">
                        <CategorySelect
                          categories={categories.filter((c) => c.name !== "Ingreso")}
                          onChange={(catId) => handleCategorize(item, catId)}
                          onCategoryCreated={loadCategories}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="w-44">
                      <CategorySelect
                        categories={categories.filter((c) => c.name !== "Ingreso")}
                        onChange={(catId) => handleCategorize(item, catId)}
                        onCategoryCreated={loadCategories}
                      />
                    </div>
                  )}
                </div>
                <span className="self-center text-right font-semibold text-finance-red dark:text-red-300">
                  {fmtMoney(-item.avg_amount, item.moneda)}
                </span>
                <span className="self-center text-right text-sm text-neutral-500">
                  {item.occurrences}x
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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

      {pendingReview && (
        <CandidateReview
          pattern={pendingReview.pattern}
          categoryId={pendingReview.categoryId}
          categoryName={pendingReview.categoryName}
          ruleId={pendingReview.ruleId}
          intro="Estas transacciones se parecen a un gasto recurrente; revisarlas ahora ayuda a automatizar el proximo mes."
          onDone={() => {
            setPendingReview(null);
            clearRememberedPendingReview();
            onConsumeResumePendingReview?.();
            load();
          }}
          onClose={() => {
            setPendingReview(null);
          }}
        />
      )}
    </div>
  );
}
