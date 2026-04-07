import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import CandidateReview from "../components/CandidateReview";
import {
  clearPendingReviewSession,
  readPendingReviewSession,
  writePendingReviewSession,
} from "../utils/pendingReviewSession";

const PRESET_COLORS = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780", "#9B59B6", "#2ECC71"];

function describeThreshold(value, type) {
  const numeric = Number(value || (type === "auto" ? 0.88 : 0.68));
  if (type === "auto") {
    if (numeric >= 0.9) return "Muy prudente";
    if (numeric >= 0.8) return "Equilibrado";
    return "Más automático";
  }
  if (numeric >= 0.75) return "Solo sugerencias fuertes";
  if (numeric >= 0.6) return "Equilibrado";
  return "Más abierto a sugerencias";
}

function formatRuleSource(source) {
  if (source === "seed") return "base";
  if (source === "manual") return "manual";
  if (source === "guided") return "guiada";
  if (source === "guided_reject") return "rechazada";
  if (source === "ollama") return "ollama";
  if (source === "ollama_auto") return "ollama auto";
  if (source === "ollama_suggest") return "ollama sugerido";
  return source || "manual";
}

export default function Rules({
  userId,
  resumePendingReview = null,
  onConsumeResumePendingReview,
  onInvalidResumePendingReview,
  pendingCount = 0,
  onOpenPendingReminder,
  onResumePendingAction,
}) {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", categories: [], rules: [], settings: {}, accounts: [] });
  const [localBudgets, setLocalBudgets] = useState({});
  const [ruleForm, setRuleForm] = useState({ pattern: "", category_id: "", mode: "suggest" });
  const [catForm, setCatForm] = useState({ name: "", budget: "", type: "variable", color: PRESET_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetRules, setConfirmResetRules] = useState(false);
  const [pendingReview, setPendingReview] = useState(null);
  const [storedPendingReview, setStoredPendingReview] = useState(() => readPendingReviewSession(userId));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadRequestIdRef = useRef(0);

  async function load(options = {}) {
    const { silent = false } = options;
    const requestId = ++loadRequestIdRef.current;
    if (!silent || state.categories.length === 0) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }
    try {
      const [categories, rules, settings, accounts] = await Promise.all([
        api.getCategories(),
        api.getRules(),
        api.getSettings(),
        api.getAccounts(),
      ]);
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: "", categories, rules, settings, accounts }));
      const budgetMap = {};
      categories.forEach((category) => {
        budgetMap[category.id] = String(category.budget);
      });
      setLocalBudgets(budgetMap);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    setStoredPendingReview(readPendingReviewSession(userId));
  }, [userId]);

  useEffect(() => {
    if (state.loading || !resumePendingReview) return;
    if (!["rules", "category_manager"].includes(resumePendingReview.source)) return;

    const categoryId = Number(resumePendingReview.categoryId);
    const category = state.categories.find((item) => item.id === categoryId);

    if (!category) {
      clearPendingReviewSession(userId);
      setStoredPendingReview(null);
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
  }, [state.loading, state.categories, resumePendingReview, userId, onConsumeResumePendingReview, onInvalidResumePendingReview]);

  useEffect(() => {
    if (!confirmResetRules) return;
    const timeoutId = setTimeout(() => setConfirmResetRules(false), 6000);
    return () => clearTimeout(timeoutId);
  }, [confirmResetRules]);

  function rememberPendingReview(review, source = "rules") {
    if (!userId) return;
    const session = {
      source,
      pattern: review.pattern,
      categoryId: review.categoryId,
      categoryName: review.categoryName,
      ruleId: review.ruleId || null,
      createdAt: new Date().toISOString(),
    };
    writePendingReviewSession(userId, session);
    setStoredPendingReview(session);
  }

  function clearRememberedPendingReview() {
    clearPendingReviewSession(userId);
    setStoredPendingReview(null);
  }

  function openStoredPendingReview() {
    if (!storedPendingReview) return;
    const category = state.categories.find((item) => item.id === Number(storedPendingReview.categoryId));
    if (!category) {
      clearRememberedPendingReview();
      onInvalidResumePendingReview?.();
      return;
    }
    setPendingReview({
      pattern: storedPendingReview.pattern,
      categoryId: Number(storedPendingReview.categoryId),
      categoryName: storedPendingReview.categoryName || category.name,
      ruleId: storedPendingReview.ruleId || null,
    });
  }

  async function updateCategory(category, changes) {
    try {
      const nextType = changes.type ?? category.type;
      const payload = { ...category, ...changes, budget: nextType === "fijo" ? 0 : (changes.budget ?? category.budget) };
      const updated = await api.updateCategory(category.id, payload);
      setState((prev) => ({
        ...prev,
        categories: prev.categories.map((item) => (item.id === category.id ? { ...item, ...updated } : item)),
        rules: prev.rules.map((rule) => (
          rule.category_id === category.id
            ? { ...rule, category_name: updated.name, category_color: updated.color }
            : rule
        )),
      }));
      if (nextType === "fijo") {
        setLocalBudgets((prev) => ({ ...prev, [category.id]: "" }));
      } else if (changes.budget !== undefined) {
        setLocalBudgets((prev) => ({ ...prev, [category.id]: String(changes.budget) }));
      }
      return true;
    } catch (error) {
      addToast("error", error.message);
      await load({ silent: true });
      return false;
    }
  }
  async function handleCreateCategory(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const created = await api.createCategory({ ...catForm, budget: catForm.type === "fijo" ? 0 : Number(catForm.budget || 0) });
      setState((prev) => ({
        ...prev,
        categories: [...prev.categories, { ...created, usage_count: 0 }],
      }));
      setLocalBudgets((prev) => ({ ...prev, [created.id]: String(created.budget || 0) }));
      addToast("success", `Categoria "${catForm.name}" creada.`);
      setCatForm({ name: "", budget: "", type: "variable", color: PRESET_COLORS[0] });
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteCategory(id) {
    const key = `cat-${id}`;
    if (confirmDelete !== key) {
      setConfirmDelete(key);
      return;
    }
    setConfirmDelete(null);
    const category = state.categories.find((item) => item.id === id);
    try {
      await api.deleteCategory(id);
      setState((prev) => ({
        ...prev,
        categories: prev.categories.filter((item) => item.id !== id),
        rules: prev.rules.filter((rule) => rule.category_id !== id),
      }));
      setLocalBudgets((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      addToast("info", `Categoria "${category?.name}" eliminada.`);
    } catch (error) {
      addToast("error", error.message);
    }
  }

  async function handleCreateRule(event) {
    event.preventDefault();
    if (!ruleForm.pattern.trim() || !ruleForm.category_id || saving) {
      addToast("warning", "Completa el patron y la categoria.");
      return;
    }

    setSaving(true);
    try {
      const categoryId = Number(ruleForm.category_id);
      const categoryName = state.categories.find((category) => category.id === categoryId)?.name;
      const result = await api.createRule({ pattern: ruleForm.pattern, category_id: categoryId, mode: ruleForm.mode });
      setRuleForm({ pattern: "", category_id: "", mode: "suggest" });

      if (result?.duplicate) {
        addToast("info", "Esta regla ya existe.");
      } else if (result?.candidates_count > 0) {
        const nextRule = {
          ...result,
          category_name: categoryName,
          category_color: state.categories.find((category) => category.id === categoryId)?.color || null,
        };
        setState((prev) => ({ ...prev, rules: [nextRule, ...prev.rules] }));
        const review = {
          pattern: result.pattern,
          categoryId,
          categoryName,
          ruleId: result.id || null,
        };
        setPendingReview(review);
        rememberPendingReview(review);
        addToast("info", `Regla creada: "${result.pattern}" -> ${categoryName || "categoria"}. Hay ${result.candidates_count} transacciones para revisar.`);
      } else {
        setState((prev) => ({
          ...prev,
          rules: [{
            ...result,
            category_name: categoryName,
            category_color: state.categories.find((category) => category.id === categoryId)?.color || null,
          }, ...prev.rules],
        }));
        addToast("success", "Regla creada correctamente.");
      }
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRule(id) {
    const key = `rule-${id}`;
    if (confirmDelete !== key) {
      setConfirmDelete(key);
      return;
    }
    setConfirmDelete(null);
    const rule = state.rules.find((item) => item.id === id);
    try {
      await api.deleteRule(id);
      setState((prev) => ({
        ...prev,
        rules: prev.rules.filter((item) => item.id !== id),
      }));
      addToast("info", `Regla "${rule?.pattern}" eliminada.`);
    } catch (error) {
      addToast("error", error.message);
    }
  }

  async function handleResetRules() {
    if (saving) return;
    if (!confirmResetRules) {
      setConfirmResetRules(true);
      return;
    }

    setSaving(true);
    setConfirmResetRules(false);
    try {
      const result = await api.resetRules();
      addToast("info", `Se resetearon ${result.deleted_count} reglas. Ahora quedaron ${result.rules_count}.`);
      await load({ silent: true });
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateRule(rule, changes) {
    try {
      const updated = await api.updateRule(rule.id, { ...changes });
      setState((prev) => ({
        ...prev,
        rules: prev.rules.map((item) => (item.id === rule.id ? { ...item, ...updated } : item)),
      }));
    } catch (error) {
      addToast("error", error.message);
    }
  }

  async function saveSetting(key, value, options = {}) {
    setState((prev) => ({
      ...prev,
      settings: { ...prev.settings, [key]: value },
    }));
    try {
      await api.updateSetting(key, value);
      if (options.toast) {
        addToast("success", options.toast);
      }
    } catch (error) {
      addToast("error", error.message);
      await load({ silent: true });
    }
  }

  const expenseCategories = state.categories.filter((category) => category.type !== "transferencia" && category.name !== "Ingreso");
  const recentLearnedRules = [...state.rules]
    .filter((rule) => !["seed", "manual"].includes(rule.source))
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, 6);

  if (state.loading) {
    return (
      <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">
        Cargando control de categorías...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">
        {state.error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[34px] border border-white/70 bg-white/88 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/88">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Control fino</p>
        <h1 className="mt-2 font-display text-4xl text-finance-ink dark:text-neutral-100">
          Categorías y reglas
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
          Acá podés corregir presupuesto, color, tipo de categoría y las reglas que afectan
          la categorización automática de los próximos resúmenes.
        </p>
      </section>

      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Aprendizaje automático</p>
            <h2 className="mt-1 font-display text-3xl text-finance-ink dark:text-neutral-100">
              Lo que la app está aprendiendo de vos
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
              Acá ves solo las reglas aprendidas automáticamente o por revisiones guiadas.
              Si alguna se puso rara, la podés desactivar sin tocar opciones técnicas.
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Resumen rápido</p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
                Las reglas base quedan siempre activas. Lo que aparece abajo es lo aprendido después,
                incluyendo revisiones guiadas y cualquier ayuda automática del motor.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-finance-ink dark:bg-neutral-900 dark:text-neutral-100">
              {recentLearnedRules.length} reciente{recentLearnedRules.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {recentLearnedRules.length > 0 ? recentLearnedRules.map((rule) => (
              <div key={`recent-${rule.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 dark:bg-neutral-900/80">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm text-finance-ink dark:text-neutral-100">{rule.pattern}</p>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                    {rule.category_name} · {formatRuleSource(rule.source)} · {describeThreshold(rule.confidence, rule.mode === "auto" ? "auto" : "suggest")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => updateRule(rule, { mode: "disabled" })}
                  className="rounded-full bg-finance-redSoft px-3 py-1.5 text-xs font-semibold text-finance-red transition hover:bg-finance-red hover:text-white"
                >
                  Desactivar
                </button>
              </div>
            )) : (
              <p className="text-sm text-neutral-400">Todavia no hay reglas aprendidas recientes.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Categorías</p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
              Ajustá color y tipo sin depender del gráfico. En categorías fijas, el monto del mes se toma como referencia automática.
              Si una categoría predefinida no te sirve, también la podés borrar desde acá.
            </p>
          </div>
          {(storedPendingReview || pendingCount > 0) && (
            <button
              type="button"
              onClick={storedPendingReview ? openStoredPendingReview : (onResumePendingAction || onOpenPendingReminder)}
              className="shrink-0 rounded-full bg-finance-purple px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              {storedPendingReview ? "Retomar categorizacion pendiente" : "Resolver pendientes de categorizacion"}
            </button>
          )}
        </div>

        <div className="mt-5 space-y-3">
          {expenseCategories.map((category) => (
            <div
              key={category.id}
              className="rounded-[26px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: category.color || "#888780" }} />
                  <span className="truncate font-semibold text-finance-ink dark:text-neutral-100">{category.name}</span>
                </div>

                <div className="grid gap-3 sm:grid-cols-[140px_150px_auto] lg:items-center">
                  <select
                    className="rounded-2xl border border-neutral-200 px-4 py-2.5 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    value={category.type}
                    onChange={(e) => updateCategory(category, { type: e.target.value, ...(e.target.value === "fijo" ? { budget: 0 } : {}) })}
                  >
                    <option value="fijo">fijo</option>
                    <option value="variable">variable</option>
                  </select>

                  {category.type === "fijo" ? (
                    <div className="rounded-2xl border border-neutral-200 bg-finance-cream/70 px-4 py-2.5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                      Presupuesto automático
                    </div>
                  ) : (
                    <input
                      className="rounded-2xl border border-neutral-200 px-4 py-2.5 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                      type="number"
                      placeholder="Presupuesto"
                      value={localBudgets[category.id] ?? category.budget}
                      onChange={(e) => setLocalBudgets((prev) => ({ ...prev, [category.id]: e.target.value }))}
                      onBlur={(e) => {
                        const rawValue = String(e.target.value || "").trim();
                        if (!rawValue) {
                          setLocalBudgets((prev) => ({ ...prev, [category.id]: String(category.budget) }));
                          addToast("warning", "El presupuesto no puede quedar vacío.");
                          return;
                        }
                        const nextBudget = Number(rawValue);
                        if (!Number.isFinite(nextBudget)) {
                          setLocalBudgets((prev) => ({ ...prev, [category.id]: String(category.budget) }));
                          addToast("warning", "Ingresá un presupuesto válido.");
                          return;
                        }
                        if (nextBudget === Number(category.budget)) return;
                        updateCategory(category, { budget: nextBudget });
                      }}
                    />
                  )}

                  <button
                    onClick={() => handleDeleteCategory(category.id)}
                    className="rounded-full bg-finance-redSoft px-3 py-2 text-xs font-semibold text-finance-red transition hover:bg-finance-red hover:text-white dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-700 dark:hover:text-white"
                  >
                    {confirmDelete === `cat-${category.id}` ? "Confirmar" : "Borrar"}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={`${category.id}-${color}`}
                      type="button"
                      onClick={() => updateCategory(category, { color })}
                      className={`h-6 w-6 rounded-full transition ${
                        (category.color || "#888780") === color
                          ? "ring-2 ring-finance-purple ring-offset-2 dark:ring-offset-neutral-900"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  color personalizado
                  <input
                    type="color"
                    className="h-8 w-8 cursor-pointer rounded-lg border border-neutral-200 bg-transparent p-0 dark:border-neutral-700"
                    value={category.color || "#888780"}
                    onChange={(e) => updateCategory(category, { color: e.target.value })}
                  />
                </label>
              </div>
            </div>
          ))}

          {expenseCategories.length === 0 && (
            <p className="py-4 text-center text-neutral-400">Sin categorías todavía.</p>
          )}
        </div>
      </section>

      <form onSubmit={handleCreateCategory} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva categoria</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_130px_130px_60px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Nombre"
            value={catForm.name}
            onChange={(e) => setCatForm((prev) => ({ ...prev, name: e.target.value }))}
            required
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={catForm.type}
            onChange={(e) => setCatForm((prev) => ({ ...prev, type: e.target.value }))}
          >
            <option value="fijo">fijo</option>
            <option value="variable">variable</option>
          </select>
          {catForm.type === "fijo" ? (
            <div className="rounded-2xl border border-neutral-200 bg-finance-cream/70 px-4 py-3 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              Presupuesto automático
            </div>
          ) : (
            <input
              className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              type="number"
              placeholder="Presupuesto"
              value={catForm.budget}
              onChange={(e) => setCatForm((prev) => ({ ...prev, budget: e.target.value }))}
            />
          )}
          <input
            type="color"
            className="h-12 w-12 cursor-pointer rounded-2xl border border-neutral-200 p-1 dark:border-neutral-700"
            value={catForm.color}
            onChange={(e) => setCatForm((prev) => ({ ...prev, color: e.target.value }))}
          />
          <button
            disabled={saving}
            className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
      </form>

      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Opciones avanzadas</p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
              Ollama, sensibilidad del motor y reset general del aprendizaje automático.
            </p>
          </div>
          <span className="text-sm font-semibold text-finance-purple">{showAdvanced ? "Ocultar" : "Mostrar"}</span>
        </button>

        {showAdvanced && (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Ollama</p>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                    Fallback semantico solo para casos ambiguos y siempre fuera del camino principal.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => saveSetting("categorizer_ollama_enabled", state.settings.categorizer_ollama_enabled === "1" ? "0" : "1")}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    state.settings.categorizer_ollama_enabled === "1"
                      ? "bg-finance-purple text-white"
                      : "bg-white text-finance-ink hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  }`}
                >
                  {state.settings.categorizer_ollama_enabled === "1" ? "Activo" : "Inactivo"}
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-xs leading-6 text-sky-800 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-100">
                En la web pública, Ollama necesita un endpoint accesible desde el worker.
                Si corrés la app self-hosted, podés usar tu instancia propia.
              </div>

              <div className="mt-4 grid gap-3">
                <input
                  className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  placeholder="URL Ollama (ej: http://127.0.0.1:11434)"
                  value={state.settings.categorizer_ollama_url || ""}
                  onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, categorizer_ollama_url: e.target.value } }))}
                  onBlur={(e) => saveSetting("categorizer_ollama_url", e.target.value)}
                />
                <input
                  className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  placeholder="Modelo (ej: qwen2.5:3b)"
                  value={state.settings.categorizer_ollama_model || ""}
                  onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, categorizer_ollama_model: e.target.value } }))}
                  onBlur={(e) => saveSetting("categorizer_ollama_model", e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Sensibilidad del motor</p>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <div className="flex items-center justify-between gap-3 text-sm text-finance-ink dark:text-neutral-100">
                      <span>Auto-categorizacion</span>
                      <strong>{describeThreshold(state.settings.categorizer_auto_threshold, "auto")}</strong>
                    </div>
                    <input
                      className="mt-3 w-full accent-finance-purple"
                      type="range"
                      min="0.5"
                      max="0.98"
                      step="0.01"
                      value={state.settings.categorizer_auto_threshold || "0.88"}
                      onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, categorizer_auto_threshold: e.target.value } }))}
                      onMouseUp={(e) => saveSetting("categorizer_auto_threshold", e.currentTarget.value)}
                      onTouchEnd={(e) => saveSetting("categorizer_auto_threshold", e.currentTarget.value)}
                    />
                    <p className="mt-2 text-xs leading-6 text-neutral-500 dark:text-neutral-300">
                      Solo deja que el motor categorice solo cuando la coincidencia se vea realmente clara.
                    </p>
                  </label>

                  <label className="block">
                    <div className="flex items-center justify-between gap-3 text-sm text-finance-ink dark:text-neutral-100">
                      <span>Sugerencias</span>
                      <strong>{describeThreshold(state.settings.categorizer_suggest_threshold, "suggest")}</strong>
                    </div>
                    <input
                      className="mt-3 w-full accent-finance-purple"
                      type="range"
                      min="0.4"
                      max="0.9"
                      step="0.01"
                      value={state.settings.categorizer_suggest_threshold || "0.68"}
                      onChange={(e) => setState((prev) => ({ ...prev, settings: { ...prev.settings, categorizer_suggest_threshold: e.target.value } }))}
                      onMouseUp={(e) => saveSetting("categorizer_suggest_threshold", e.currentTarget.value)}
                      onTouchEnd={(e) => saveSetting("categorizer_suggest_threshold", e.currentTarget.value)}
                    />
                    <p className="mt-2 text-xs leading-6 text-neutral-500 dark:text-neutral-300">
                      Debajo de este nivel, una transaccion deberia quedar sin categoria antes que adivinar mal.
                    </p>
                  </label>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Reset de aprendizaje automático</p>
                <p className="mt-1 max-w-sm text-xs leading-6 text-neutral-500 dark:text-neutral-300">
                  Limpiá reglas aprendidas, revisiones confirmadas y categorizaciones automáticas para volver a un estado limpio.
                </p>
                <button
                  type="button"
                  onClick={handleResetRules}
                  disabled={saving}
                  className={`mt-3 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    confirmResetRules
                      ? "bg-finance-red text-white hover:opacity-90"
                      : "bg-white text-finance-ink hover:bg-neutral-100 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  } disabled:opacity-50`}
                >
                  {confirmResetRules ? "Confirmar reset" : "Resetear aprendizaje"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <form onSubmit={handleCreateRule} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva regla de categorizacion</p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
          El patron se compara contra la descripcion bancaria, pero ahora las coincidencias se revisan antes
          de aplicar cambios viejos.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_160px_160px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Patron (ej: PEDIDOSYA)"
            value={ruleForm.pattern}
            onChange={(e) => setRuleForm((prev) => ({ ...prev, pattern: e.target.value }))}
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={ruleForm.category_id}
            onChange={(e) => setRuleForm((prev) => ({ ...prev, category_id: e.target.value }))}
          >
            <option value="">Categoria</option>
            {state.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={ruleForm.mode}
            onChange={(e) => setRuleForm((prev) => ({ ...prev, mode: e.target.value }))}
          >
            <option value="suggest">suggest</option>
            <option value="auto">auto</option>
            <option value="disabled">disabled</option>
          </select>
          <button
            disabled={saving}
            className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            Crear regla
          </button>
        </div>
      </form>

      <section className="rounded-[32px] border border-white/70 bg-white/90 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="px-6 pb-4 pt-6">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Reglas activas</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
            {state.rules.length} regla{state.rules.length !== 1 ? "s" : ""} activas. Aqui decides que se
            automatiza y que no.
          </p>
        </div>
        <div className="grid grid-cols-[1fr_180px_110px_120px_96px] gap-4 border-y border-neutral-100 px-6 py-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
          <span>Patron</span>
          <span>Categoria</span>
          <span>Modo</span>
          <span>Confianza</span>
          <span></span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {state.rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[1fr_180px_110px_120px_96px] items-center gap-4 px-6 py-4">
              <div className="min-w-0">
                <span className="truncate font-mono text-sm text-finance-ink dark:text-neutral-100">{rule.pattern}</span>
                <p className="mt-1 truncate text-xs text-neutral-400">
                  {rule.account_name ? `Cuenta: ${rule.account_name}` : "Todas las cuentas"} · {rule.direction || "any"} · {formatRuleSource(rule.source)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: rule.category_color || "#888780" }} />
                <span className="text-sm text-finance-ink dark:text-neutral-100">{rule.category_name}</span>
              </div>
              <select
                className="rounded-2xl border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={rule.mode || "suggest"}
                onChange={(e) => updateRule(rule, { mode: e.target.value, confidence: Number(rule.confidence || 0.72) })}
              >
                <option value="auto">auto</option>
                <option value="suggest">suggest</option>
                <option value="disabled">disabled</option>
              </select>
              <div className="space-y-1">
                <input
                  className="w-full accent-finance-purple"
                  type="range"
                  min="0.4"
                  max="0.99"
                  step="0.01"
                  defaultValue={Number(rule.confidence || 0.72)}
                  onMouseUp={(e) => updateRule(rule, { mode: rule.mode || "suggest", confidence: Number(e.currentTarget.value) })}
                  onTouchEnd={(e) => updateRule(rule, { mode: rule.mode || "suggest", confidence: Number(e.currentTarget.value) })}
                />
                <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-300">
                  {describeThreshold(rule.confidence, rule.mode === "auto" ? "auto" : "suggest")} · {rule.match_count} coincidencia{Number(rule.match_count || 0) === 1 ? "" : "s"}
                </span>
              </div>
              <button
                onClick={() => handleDeleteRule(rule.id)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-finance-red transition hover:bg-finance-redSoft dark:hover:bg-red-900/30"
              >
                {confirmDelete === `rule-${rule.id}` ? "Confirmar" : "Borrar"}
              </button>
            </div>
          ))}
          {state.rules.length === 0 && (
            <p className="px-6 py-8 text-center text-neutral-400">
              Sin reglas todavia. Puedes crear algunas manualmente o dejar que aparezcan al categorizar.
            </p>
          )}
        </div>
      </section>

      {pendingReview && (
        <CandidateReview
          pattern={pendingReview.pattern}
          categoryId={pendingReview.categoryId}
          categoryName={pendingReview.categoryName}
          ruleId={pendingReview.ruleId}
          onDone={() => {
            setPendingReview(null);
            clearRememberedPendingReview();
            onConsumeResumePendingReview?.();
            load({ silent: true });
          }}
          onClose={() => {
            setPendingReview(null);
          }}
        />
      )}
    </div>
  );
}
