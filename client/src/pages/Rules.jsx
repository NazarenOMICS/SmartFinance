import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";

export default function Rules() {
  const { addToast } = useToast();
  const [state, setState] = useState({ loading: true, error: "", categories: [], rules: [] });
  const [localBudgets, setLocalBudgets] = useState({});
  const [ruleForm, setRuleForm] = useState({ pattern: "", category_id: "" });
  const [catForm, setCatForm] = useState({ name: "", budget: "", type: "variable", color: "#888780" });

  async function load() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const [categories, rules] = await Promise.all([api.getCategories(), api.getRules()]);
      setState({ loading: false, error: "", categories, rules });
      const map = {};
      categories.forEach((c) => { map[c.id] = String(c.budget); });
      setLocalBudgets(map);
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => { load(); }, []);

  async function updateCategory(category, changes) {
    try {
      await api.updateCategory(category.id, { ...category, ...changes });
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleCreateCategory(event) {
    event.preventDefault();
    try {
      await api.createCategory({ ...catForm, budget: Number(catForm.budget || 0) });
      setCatForm({ name: "", budget: "", type: "variable", color: "#888780" });
      addToast("success", `Categoría "${catForm.name}" creada.`);
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleDeleteCategory(id) {
    const cat = state.categories.find((c) => c.id === id);
    try {
      await api.deleteCategory(id);
      addToast("info", `Categoría "${cat?.name}" eliminada.`);
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleCreateRule(event) {
    event.preventDefault();
    if (!ruleForm.pattern.trim() || !ruleForm.category_id) {
      addToast("warning", "Completá el patrón y la categoría.");
      return;
    }
    try {
      const result = await api.createRule({ pattern: ruleForm.pattern, category_id: Number(ruleForm.category_id) });
      setRuleForm({ pattern: "", category_id: "" });
      if (result?.retro_count > 0) {
        addToast("success", `Regla creada y aplicada a ${result.retro_count} transacciones sin categorizar.`);
      } else {
        addToast("success", "Regla creada correctamente.");
      }
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  async function handleDeleteRule(id) {
    const rule = state.rules.find((r) => r.id === id);
    try {
      await api.deleteRule(id);
      addToast("info", `Regla "${rule?.pattern}" eliminada.`);
      await load();
    } catch (e) {
      addToast("error", e.message);
    }
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel dark:bg-neutral-900/80">Cargando reglas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;

  return (
    <div className="space-y-6">

      {/* Presupuestos por categoría */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Categorías y presupuestos</p>
        <p className="mt-1 text-sm text-neutral-500">Editá el presupuesto mensual y el tipo de gasto de cada categoría.</p>
        <div className="mt-5 space-y-3">
          {state.categories.filter((c) => c.name !== "Ingreso").map((category) => (
            <div key={category.id} className="grid gap-3 md:grid-cols-[1fr_130px_130px_80px] items-center">
              <div className="flex items-center gap-3">
                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: category.color || "#888780" }} />
                <span className="font-semibold text-finance-ink">{category.name}</span>
              </div>
              <select
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={category.type}
                onChange={(e) => updateCategory(category, { type: e.target.value })}
              >
                <option value="fijo">fijo</option>
                <option value="variable">variable</option>
              </select>
              <input
                className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                type="number"
                placeholder="Presupuesto"
                value={localBudgets[category.id] ?? category.budget}
                onChange={(e) => setLocalBudgets((prev) => ({ ...prev, [category.id]: e.target.value }))}
                onBlur={(e) => updateCategory(category, { budget: Number(e.target.value) })}
              />
              <button
                onClick={() => handleDeleteCategory(category.id)}
                className="rounded-full bg-finance-redSoft px-3 py-2 text-xs font-semibold text-finance-red transition hover:bg-finance-red hover:text-white dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-700 dark:hover:text-white"
              >
                Borrar
              </button>
            </div>
          ))}
          {state.categories.filter((c) => c.name !== "Ingreso").length === 0 && (
            <p className="py-4 text-center text-neutral-400">Sin categorías todavía.</p>
          )}
        </div>
      </div>

      {/* Nueva categoría */}
      <form onSubmit={handleCreateCategory} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva categoría</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_130px_130px_60px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Nombre"
            value={catForm.name}
            onChange={(e) => setCatForm((p) => ({ ...p, name: e.target.value }))}
            required
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={catForm.type}
            onChange={(e) => setCatForm((p) => ({ ...p, type: e.target.value }))}
          >
            <option value="fijo">fijo</option>
            <option value="variable">variable</option>
          </select>
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            type="number"
            placeholder="Presupuesto"
            value={catForm.budget}
            onChange={(e) => setCatForm((p) => ({ ...p, budget: e.target.value }))}
          />
          <input
            type="color"
            className="h-12 w-12 cursor-pointer rounded-2xl border border-neutral-200 p-1 dark:border-neutral-700"
            value={catForm.color}
            onChange={(e) => setCatForm((p) => ({ ...p, color: e.target.value }))}
          />
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90">
            Agregar
          </button>
        </div>
      </form>

      {/* Nueva regla */}
      <form onSubmit={handleCreateRule} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva regla de categorización</p>
        <p className="mt-1 text-sm text-neutral-500">El patrón se compara contra la descripción del banco (sin distinguir mayúsculas).</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            placeholder="Patrón (ej: PEDIDOSYA)"
            value={ruleForm.pattern}
            onChange={(e) => setRuleForm((p) => ({ ...p, pattern: e.target.value }))}
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
            value={ruleForm.category_id}
            onChange={(e) => setRuleForm((p) => ({ ...p, category_id: e.target.value }))}
          >
            <option value="">Categoría</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90">
            Agregar
          </button>
        </div>
      </form>

      {/* Tabla de reglas */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
        <div className="px-6 pt-6 pb-4">
          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Reglas activas</p>
          <p className="mt-1 text-sm text-neutral-500">{state.rules.length} regla{state.rules.length !== 1 ? "s" : ""} · ordenadas por frecuencia de uso</p>
        </div>
        <div className="grid grid-cols-[1fr_180px_90px_80px] gap-4 border-y border-neutral-100 px-6 py-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800">
          <span>Patrón</span><span>Categoría</span><span className="text-right">Matches</span><span></span>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {state.rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[1fr_180px_90px_80px] gap-4 px-6 py-4 items-center">
              <span className="font-mono text-sm text-finance-ink">{rule.pattern}</span>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: rule.category_color || "#888780" }} />
                <span className="text-sm text-finance-ink">{rule.category_name}</span>
              </div>
              <span className="text-right text-sm font-semibold text-neutral-500">{rule.match_count}</span>
              <button
                onClick={() => handleDeleteRule(rule.id)}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-finance-red transition hover:bg-finance-redSoft dark:hover:bg-red-900/30"
              >
                Borrar
              </button>
            </div>
          ))}
          {state.rules.length === 0 && (
            <p className="px-6 py-8 text-center text-neutral-400">Sin reglas todavía. Las reglas se crean automáticamente al categorizar transacciones.</p>
          )}
        </div>
      </div>
    </div>
  );
}
