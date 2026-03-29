import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import CandidateReview from "../components/CandidateReview";

const PRESET_COLORS = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780", "#9B59B6", "#2ECC71"];

export default function Rules() {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", categories: [], rules: [], settings: {}, accounts: [] });
  const [localBudgets, setLocalBudgets] = useState({});
  const [ruleForm, setRuleForm] = useState({ pattern: "", category_id: "", mode: "suggest" });
  const [catForm, setCatForm] = useState({ name: "", budget: "", type: "variable", color: PRESET_COLORS[0] });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetRules, setConfirmResetRules] = useState(false);
  const [pendingReview, setPendingReview] = useState(null);
  const [saving, setSaving] = useState(false);
  const loadRequestIdRef = useRef(0);

  async function load() {
    const requestId = ++loadRequestIdRef.current;
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [categories, rules, settings, accounts] = await Promise.all([
        api.getCategories(),
        api.getRules(),
        api.getSettings(),
        api.getAccounts(),
      ]);
      if (loadRequestIdRef.current !== requestId) return;
      setState({ loading: false, error: "", categories, rules, settings, accounts });
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
    if (!confirmResetRules) return;
    const timeoutId = setTimeout(() => setConfirmResetRules(false), 6000);
    return () => clearTimeout(timeoutId);
  }, [confirmResetRules]);

  async function updateCategory(category, changes) {
    try {
      await api.updateCategory(category.id, { ...category, ...changes });
      await load();
      return true;
    } catch (error) {
      addToast("error", error.message);
      await load();
      return false;
    }
  }

  async function handleCreateCategory(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.createCategory({ ...catForm, budget: Number(catForm.budget || 0) });
      addToast("success", `Categoria "${catForm.name}" creada.`);
      setCatForm({ name: "", budget: "", type: "variable", color: PRESET_COLORS[0] });
      await load();
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
      addToast("info", `Categoria "${category?.name}" eliminada.`);
      await load();
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
        setPendingReview({
          pattern: result.pattern,
          categoryId,
          categoryName,
        });
        addToast("info", `Regla creada: "${result.pattern}" -> ${categoryName || "categoria"}. Hay ${result.candidates_count} transacciones para revisar.`);
      } else {
        addToast("success", "Regla creada correctamente.");
      }

      await load();
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
      addToast("info", `Regla "${rule?.pattern}" eliminada.`);
      await load();
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
      await load();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateRule(rule, changes) {
    try {
      await api.updateRule(rule.id, { ...changes });
      await load();
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
      await load();
    }
  }

  const expenseCategories = state.categories.filter((category) => category.type !== "transferencia" && category.name !== "Ingreso");
  const recentLearnedRules = [...state.rules]
    .filter((rule) => rule.source !== "seed")
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .slice(0, 6);

  if (state.loading) {
    return (
      <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">
        Cargando control de categorias...
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
          Categorias y reglas bajo tu mando
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
          Aqui puedes corregir presupuesto, color, tipo de categoria y todas las reglas que terminan
          afectando la categorizacion automatica de los proximos resumenes.
        </p>
      </section>

      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Motor hibrido</p>
            <h2 className="mt-1 font-display text-3xl text-finance-ink dark:text-neutral-100">
              Reglas con confianza + fallback opcional a Ollama
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
              La idea ya no es categorizar todo a lo bruto. Las reglas pueden quedar en auto, sugerencia o desactivadas,
              y Ollama solo entra cuando activas un endpoint compatible y las reglas no alcanzan.
            </p>
          </div>
          <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-xs leading-6 text-sky-800 dark:border-sky-900/40 dark:bg-sky-900/10 dark:text-sky-100">
            En la web publica, Ollama necesita un endpoint accesible desde el worker.
            Si corres la app self-hosted, puedes usar tu instancia propia.
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <label className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
            <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">Auto threshold</span>
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
            <div className="mt-2 flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-300">
              <span>Solo auto-categoriza si supera esta confianza.</span>
              <strong>{Math.round(Number(state.settings.categorizer_auto_threshold || 0.88) * 100)}%</strong>
            </div>
          </label>

          <label className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
            <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">Suggest threshold</span>
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
            <div className="mt-2 flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-300">
              <span>Debajo de esto, la transaccion queda sin categoria.</span>
              <strong>{Math.round(Number(state.settings.categorizer_suggest_threshold || 0.68) * 100)}%</strong>
            </div>
          </label>

          <div className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Ollama</p>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
                  Fallback semantico solo para casos ambiguos.
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

          <div className="rounded-[24px] border border-neutral-200 bg-finance-cream/60 p-4 dark:border-neutral-800 dark:bg-neutral-950/50">
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Aprendido recientemente</p>
            <div className="mt-4 space-y-3">
              {recentLearnedRules.length > 0 ? recentLearnedRules.map((rule) => (
                <div key={`recent-${rule.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/80 px-3 py-3 dark:bg-neutral-900/80">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-finance-ink dark:text-neutral-100">{rule.pattern}</p>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                      {rule.category_name} · {rule.source || "manual"} · {Math.round(Number(rule.confidence || 0) * 100)}%
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
        </div>
      </section>

      <section className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Categorias</p>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">
              Ajusta presupuesto, color y tipo sin depender del grafico.
            </p>
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Reset de reglas</p>
            <p className="mt-1 max-w-sm text-xs leading-6 text-neutral-500 dark:text-neutral-300">
              Si la app empezo a categorizar demasiado automatico por reglas mal aprendidas, aqui limpias
              todo y vuelves a un estado sano.
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
              {confirmResetRules ? "Confirmar reset de reglas" : "Resetear reglas"}
            </button>
          </div>
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
                    onChange={(e) => updateCategory(category, { type: e.target.value })}
                  >
                    <option value="fijo">fijo</option>
                    <option value="variable">variable</option>
                  </select>

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
                        addToast("warning", "El presupuesto no puede quedar vacio.");
                        return;
                      }
                      const nextBudget = Number(rawValue);
                      if (!Number.isFinite(nextBudget)) {
                        setLocalBudgets((prev) => ({ ...prev, [category.id]: String(category.budget) }));
                        addToast("warning", "Ingresa un presupuesto valido.");
                        return;
                      }
                      if (nextBudget === Number(category.budget)) return;
                      updateCategory(category, { budget: nextBudget });
                    }}
                  />

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
            <p className="py-4 text-center text-neutral-400">Sin categorias todavia.</p>
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
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            type="number"
            placeholder="Presupuesto"
            value={catForm.budget}
            onChange={(e) => setCatForm((prev) => ({ ...prev, budget: e.target.value }))}
          />
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
                  {rule.account_name ? `Cuenta: ${rule.account_name}` : "Todas las cuentas"} · {rule.direction || "any"} · {rule.source || "manual"}
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
                  {Math.round(Number(rule.confidence || 0.72) * 100)}% · {rule.match_count} matches
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
          onDone={() => {
            setPendingReview(null);
            load();
          }}
        />
      )}
    </div>
  );
}
