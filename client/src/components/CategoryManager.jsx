import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";
import CategorySelect from "./CategorySelect";
import CandidateReview from "./CandidateReview";

const PRESET_COLORS = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780", "#9B59B6", "#2ECC71"];

export default function CategoryManager({ open, onClose, onDataChanged, month }) {
  const { addToast } = useToast();
  const [categories, setCategories] = useState([]);
  const [rules, setRules] = useState([]);
  const [spentMap, setSpentMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [localBudgets, setLocalBudgets] = useState({});
  const [tab, setTab] = useState("categories");
  const [catForm, setCatForm] = useState({ name: "", budget: "", type: "variable", color: PRESET_COLORS[0] });
  const [ruleForm, setRuleForm] = useState({ pattern: "", category_id: "" });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [confirmResetRules, setConfirmResetRules] = useState(false);
  const [pendingReview, setPendingReview] = useState(null);
  const [saving, setSaving] = useState(false);
  const panelRef = useRef(null);
  const loadRef = useRef(0);

  function nextUnusedColor() {
    const usedColors = new Set(categories.map((c) => c.color).filter(Boolean));
    return PRESET_COLORS.find((c) => !usedColors.has(c)) || PRESET_COLORS[0];
  }

  async function load() {
    const id = ++loadRef.current;
    setLoading(true);
    try {
      const [cats, rls, summary] = await Promise.all([
        api.getCategories(),
        api.getRules(),
        month ? api.getSummary(month).catch(() => null) : null,
      ]);
      if (loadRef.current !== id) return;
      setCategories(cats);
      setRules(rls);

      const map = {};
      cats.forEach((c) => { map[c.id] = String(c.budget); });
      setLocalBudgets(map);

      const spent = {};
      if (summary?.budgets) {
        summary.budgets.forEach((budget) => {
          spent[budget.id] = { spent: budget.spent, currency: summary.currency };
        });
      }
      setSpentMap(spent);
    } catch (e) {
      addToast("error", e.message);
    } finally {
      if (loadRef.current === id) setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (tab !== "rules" && confirmResetRules) {
      setConfirmResetRules(false);
    }
  }, [tab, confirmResetRules]);

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  async function updateCategory(category, changes) {
    try {
      await api.updateCategory(category.id, { ...category, ...changes });
      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
      await load();
    }
  }

  async function handleCreateCategory(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await api.createCategory({ ...catForm, budget: Number(catForm.budget || 0) });
      addToast("success", `Categoría "${catForm.name}" creada.`);
      setCatForm({ name: "", budget: "", type: "variable", color: nextUnusedColor() });
      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
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
    const cat = categories.find((c) => c.id === id);
    try {
      await api.deleteCategory(id);
      addToast("info", `Categoría "${cat?.name}" eliminada.`);
      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleCreateRule(e) {
    e.preventDefault();
    if (!ruleForm.pattern.trim() || !ruleForm.category_id || saving) return;
    setSaving(true);
    try {
      const categoryId = Number(ruleForm.category_id);
      const categoryName = categories.find((cat) => cat.id === categoryId)?.name;
      const result = await api.createRule({ pattern: ruleForm.pattern, category_id: categoryId });
      setRuleForm({ pattern: "", category_id: "" });

      if (result?.duplicate) {
        addToast("info", "Esta regla ya existe.");
      } else if (result?.candidates_count > 0) {
        setPendingReview({
          pattern: result.pattern,
          categoryId,
          categoryName,
        });
        addToast("info", `Regla creada: "${result.pattern}" → ${categoryName || "categoría"}. Hay ${result.candidates_count} transacciones similares para revisar.`);
      } else {
        addToast("success", "Regla creada.");
      }

      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
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
    const rule = rules.find((r) => r.id === id);
    try {
      await api.deleteRule(id);
      addToast("info", `Regla "${rule?.pattern}" eliminada.`);
      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleResetRules() {
    if (saving) return;
    if (!confirmResetRules) {
      setConfirmResetRules(true);
      return;
    }

    setConfirmResetRules(false);
    setSaving(true);
    try {
      const result = await api.resetRules();
      addToast("info", `Se resetearon ${result.deleted_count} reglas. Quedaron ${result.rules_count} reglas base.`);
      await load();
      onDataChanged?.();
    } catch (e) {
      addToast("error", e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const expenseCategories = categories.filter((c) => c.type !== "transferencia" && c.name !== "Ingreso");

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="animate-slide-in-right flex h-full w-full max-w-lg flex-col bg-white shadow-2xl dark:bg-neutral-950"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Gestión</p>
            <h2 className="font-display text-2xl text-finance-ink dark:text-neutral-100">Categorías y reglas</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            x
          </button>
        </div>

        <div className="flex border-b border-neutral-100 dark:border-neutral-800">
          <button
            onClick={() => setTab("categories")}
            className={`flex-1 py-3 text-center text-sm font-semibold transition ${
              tab === "categories"
                ? "border-b-2 border-finance-purple text-finance-purple"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            }`}
          >
            Categorías y presupuestos
          </button>
          <button
            onClick={() => setTab("rules")}
            className={`flex-1 py-3 text-center text-sm font-semibold transition ${
              tab === "rules"
                ? "border-b-2 border-finance-purple text-finance-purple"
                : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
            }`}
          >
            Reglas ({rules.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-7 w-7 animate-spin rounded-full border-2 border-finance-purple border-t-transparent" />
            </div>
          ) : tab === "categories" ? (
            <div className="space-y-4 p-4">
              {expenseCategories.map((category) => {
                const stats = spentMap[category.id];
                const spent = stats?.spent || 0;
                const budget = Number(category.budget) || 0;
                const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
                const isOver = budget > 0 && spent > budget;

                return (
                  <div key={category.id} className="rounded-2xl bg-neutral-50 p-4 dark:bg-neutral-900">
                    <div className="flex items-center gap-3">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: category.color || "#888780" }} />
                      <span className="flex-1 font-semibold text-finance-ink dark:text-neutral-100">{category.name}</span>
                      <button
                        onClick={() => handleDeleteCategory(category.id)}
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                          confirmDelete === `cat-${category.id}`
                            ? "bg-finance-red text-white"
                            : "text-neutral-400 hover:text-finance-red"
                        }`}
                      >
                        {confirmDelete === `cat-${category.id}` ? "¿Confirmar?" : "×"}
                      </button>
                    </div>

                    {stats && (
                      <div className="mt-2">
                        <div className="flex items-baseline justify-between text-xs">
                          <span className={isOver ? "font-semibold text-finance-red" : "text-neutral-500"}>
                            {fmtMoney(spent, stats.currency)}
                          </span>
                          {budget > 0 && (
                            <span className="text-neutral-400">
                              / {fmtMoney(budget, stats.currency)}
                            </span>
                          )}
                        </div>
                        {budget > 0 && (
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                            <div
                              className={`h-full rounded-full transition-all ${isOver ? "bg-finance-red" : "bg-finance-purple"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex rounded-xl border border-neutral-200 text-xs dark:border-neutral-700">
                        <button
                          onClick={() => updateCategory(category, { type: "variable" })}
                          className={`rounded-l-xl px-3 py-1.5 transition ${category.type === "variable" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                        >
                          variable
                        </button>
                        <button
                          onClick={() => updateCategory(category, { type: "fijo" })}
                          className={`rounded-r-xl px-3 py-1.5 transition ${category.type === "fijo" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                        >
                          fijo
                        </button>
                      </div>
                      <div className="flex flex-1 items-center gap-1.5">
                        <span className="text-xs text-neutral-400">$</span>
                        <input
                          className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                          type="number"
                          placeholder="Presupuesto"
                          value={localBudgets[category.id] ?? category.budget}
                          onChange={(e) => setLocalBudgets((prev) => ({ ...prev, [category.id]: e.target.value }))}
                          onBlur={(e) => {
                            const raw = String(e.target.value || "").trim();
                            if (!raw) {
                              setLocalBudgets((prev) => ({ ...prev, [category.id]: String(category.budget) }));
                              addToast("warning", "El presupuesto no puede quedar vacío.");
                              return;
                            }
                            const next = Number(raw);
                            if (!Number.isFinite(next)) {
                              setLocalBudgets((prev) => ({ ...prev, [category.id]: String(category.budget) }));
                              addToast("warning", "Ingresá un presupuesto válido.");
                              return;
                            }
                            if (next === Number(category.budget)) return;
                            updateCategory(category, { budget: next });
                          }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-1.5">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={`${category.id}-${color}`}
                            type="button"
                            onClick={() => updateCategory(category, { color })}
                            className={`h-5 w-5 rounded-full transition ${
                              (category.color || "#888780") === color
                                ? "ring-2 ring-finance-purple ring-offset-2 dark:ring-offset-neutral-900"
                                : "hover:scale-110"
                            }`}
                            style={{ backgroundColor: color }}
                            title={`Cambiar color a ${color}`}
                          />
                        ))}
                      </div>

                      <label className="flex items-center gap-2 text-xs text-neutral-400">
                        color
                        <input
                          type="color"
                          value={category.color || "#888780"}
                          onChange={(e) => updateCategory(category, { color: e.target.value })}
                          className="h-8 w-8 cursor-pointer rounded-lg border border-neutral-200 bg-transparent p-0 dark:border-neutral-700"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}

              {expenseCategories.length === 0 && (
                <p className="py-8 text-center text-neutral-400">Sin categorías todavía.</p>
              )}

              <form onSubmit={handleCreateCategory} className="rounded-2xl border-2 border-dashed border-neutral-200 p-4 dark:border-neutral-700">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-400">Nueva categoría</p>
                <input
                  className="mb-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  placeholder="Nombre"
                  value={catForm.name}
                  onChange={(e) => setCatForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setCatForm((prev) => ({ ...prev, color }))}
                        className={`h-6 w-6 rounded-full transition ${catForm.color === color ? "ring-2 ring-finance-purple ring-offset-2 dark:ring-offset-neutral-950" : "hover:scale-110"}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                  <input
                    type="color"
                    value={catForm.color}
                    onChange={(e) => setCatForm((prev) => ({ ...prev, color: e.target.value }))}
                    className="h-8 w-8 cursor-pointer rounded-lg border border-neutral-200 bg-transparent p-0 dark:border-neutral-700"
                    title="Elegir color personalizado"
                  />
                </div>
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex rounded-xl border border-neutral-200 text-xs dark:border-neutral-700">
                    <button
                      type="button"
                      onClick={() => setCatForm((prev) => ({ ...prev, type: "variable" }))}
                      className={`rounded-l-xl px-3 py-1.5 transition ${catForm.type === "variable" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                    >
                      variable
                    </button>
                    <button
                      type="button"
                      onClick={() => setCatForm((prev) => ({ ...prev, type: "fijo" }))}
                      className={`rounded-r-xl px-3 py-1.5 transition ${catForm.type === "fijo" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                    >
                      fijo
                    </button>
                  </div>
                  <input
                    className="flex-1 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    type="number"
                    placeholder="Presupuesto mensual"
                    value={catForm.budget}
                    onChange={(e) => setCatForm((prev) => ({ ...prev, budget: e.target.value }))}
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving || !catForm.name.trim()}
                  className="w-full rounded-xl bg-finance-purple py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? "Creando..." : "Crear categoría"}
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-4 p-4">
              <form onSubmit={handleCreateRule} className="rounded-2xl border-2 border-dashed border-neutral-200 p-4 dark:border-neutral-700">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">Nueva regla</p>
                <p className="mb-3 text-xs text-neutral-400">El patrón se compara contra la descripción del banco, sin aplicar cambios retroactivos sin confirmación.</p>
                <div className="mb-3">
                  <input
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    placeholder="Patrón (ej: PEDIDOSYA)"
                    value={ruleForm.pattern}
                    onChange={(e) => setRuleForm((prev) => ({ ...prev, pattern: e.target.value }))}
                  />
                </div>
                <div className="mb-3">
                  <CategorySelect
                    categories={categories}
                    value={ruleForm.category_id}
                    onChange={(value) => setRuleForm((prev) => ({ ...prev, category_id: value }))}
                    onCategoryCreated={() => load()}
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving || !ruleForm.pattern.trim() || !ruleForm.category_id}
                  className="w-full rounded-xl bg-finance-purple py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? "Creando..." : "Crear regla"}
                </button>
              </form>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Reset de reglas</p>
                <p className="mt-1 text-xs leading-6 text-neutral-500 dark:text-neutral-300">
                  Borra las reglas aprendidas o mal creadas y vuelve al set base de la app. Ideal si la
                  categorizacion automatica se fue de mambo.
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
                  {confirmResetRules ? "Confirmar reset total de reglas" : "Resetear reglas al estado base"}
                </button>
              </div>

              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-4 py-3 dark:bg-neutral-900">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm text-finance-ink dark:text-neutral-100">{rule.pattern}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: rule.category_color || "#888780" }} />
                      <span className="text-xs text-neutral-500">{rule.category_name}</span>
                      <span className="text-xs text-neutral-400">· {rule.match_count} matches</span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteRule(rule.id)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                      confirmDelete === `rule-${rule.id}`
                        ? "bg-finance-red text-white"
                        : "text-neutral-400 hover:text-finance-red"
                    }`}
                  >
                    {confirmDelete === `rule-${rule.id}` ? "¿Confirmar?" : "×"}
                  </button>
                </div>
              ))}

              {rules.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-neutral-400">Sin reglas todavía.</p>
                  <p className="mt-1 text-xs text-neutral-400">Las reglas se crean automáticamente al categorizar transacciones.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {pendingReview && (
        <CandidateReview
          pattern={pendingReview.pattern}
          categoryId={pendingReview.categoryId}
          categoryName={pendingReview.categoryName}
          onDone={() => {
            setPendingReview(null);
            load();
            onDataChanged?.();
          }}
        />
      )}
    </div>
  );
}
