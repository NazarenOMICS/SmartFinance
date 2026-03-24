import { useEffect, useState } from "react";
import { api } from "../api";

export default function Rules() {
  const [state, setState] = useState({ loading: true, error: "", categories: [], rules: [] });
  const [localBudgets, setLocalBudgets] = useState({});
  const [ruleForm, setRuleForm] = useState({ pattern: "", category_id: "" });
  const [catForm, setCatForm] = useState({ name: "", budget: "", type: "variable", color: "#888780" });
  const [deleteError, setDeleteError] = useState("");

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
    await api.updateCategory(category.id, { ...category, ...changes });
    await load();
  }

  async function handleCreateCategory(event) {
    event.preventDefault();
    try {
      await api.createCategory({ ...catForm, budget: Number(catForm.budget || 0) });
      setCatForm({ name: "", budget: "", type: "variable", color: "#888780" });
      await load();
    } catch (e) {
      setDeleteError(e.message);
    }
  }

  async function handleDeleteCategory(id) {
    setDeleteError("");
    try {
      await api.deleteCategory(id);
      await load();
    } catch (e) {
      setDeleteError(e.message);
    }
  }

  async function handleCreateRule(event) {
    event.preventDefault();
    await api.createRule({ pattern: ruleForm.pattern, category_id: Number(ruleForm.category_id) });
    setRuleForm({ pattern: "", category_id: "" });
    await load();
  }

  async function handleDeleteRule(id) {
    await api.deleteRule(id);
    await load();
  }

  if (state.loading) return <div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando reglas…</div>;
  if (state.error) return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel">{state.error}</div>;

  return (
    <div className="space-y-6">
      {deleteError ? <div className="rounded-2xl bg-finance-redSoft px-4 py-3 text-sm text-finance-red">{deleteError}</div> : null}

      {/* Presupuestos por categoría */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Categorías y presupuestos</p>
        <div className="mt-4 space-y-3">
          {state.categories.filter((c) => c.name !== "Ingreso").map((category) => (
            <div key={category.id} className="grid gap-3 md:grid-cols-[1fr_130px_130px_80px]">
              <span className="self-center font-semibold text-finance-ink">{category.name}</span>
              <select
                className="rounded-2xl border border-neutral-200 px-4 py-3"
                value={category.type}
                onChange={(e) => updateCategory(category, { type: e.target.value })}
              >
                <option value="fijo">fijo</option>
                <option value="variable">variable</option>
              </select>
              <input
                className="rounded-2xl border border-neutral-200 px-4 py-3"
                type="number"
                placeholder="Presupuesto"
                value={localBudgets[category.id] ?? category.budget}
                onChange={(e) => setLocalBudgets((prev) => ({ ...prev, [category.id]: e.target.value }))}
                onBlur={(e) => updateCategory(category, { budget: Number(e.target.value) })}
              />
              <button
                onClick={() => handleDeleteCategory(category.id)}
                className="rounded-full bg-finance-redSoft px-3 py-2 text-xs font-semibold text-finance-red hover:bg-finance-red hover:text-white transition"
              >
                Borrar
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Nueva categoría */}
      <form onSubmit={handleCreateCategory} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva categoría</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_130px_130px_60px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3"
            placeholder="Nombre"
            value={catForm.name}
            onChange={(e) => setCatForm((p) => ({ ...p, name: e.target.value }))}
            required
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3"
            value={catForm.type}
            onChange={(e) => setCatForm((p) => ({ ...p, type: e.target.value }))}
          >
            <option value="fijo">fijo</option>
            <option value="variable">variable</option>
          </select>
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3"
            type="number"
            placeholder="Presupuesto"
            value={catForm.budget}
            onChange={(e) => setCatForm((p) => ({ ...p, budget: e.target.value }))}
          />
          <input
            type="color"
            className="h-12 w-12 cursor-pointer rounded-2xl border border-neutral-200 p-1"
            value={catForm.color}
            onChange={(e) => setCatForm((p) => ({ ...p, color: e.target.value }))}
          />
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>

      {/* Nueva regla */}
      <form onSubmit={handleCreateRule} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva regla de categorización</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px_auto]">
          <input
            className="rounded-2xl border border-neutral-200 px-4 py-3"
            placeholder="Patrón (ej: PEDIDOSYA)"
            value={ruleForm.pattern}
            onChange={(e) => setRuleForm((p) => ({ ...p, pattern: e.target.value }))}
          />
          <select
            className="rounded-2xl border border-neutral-200 px-4 py-3"
            value={ruleForm.category_id}
            onChange={(e) => setRuleForm((p) => ({ ...p, category_id: e.target.value }))}
          >
            <option value="">Categoría</option>
            {state.categories.filter((c) => c.name !== "Ingreso").map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>

      {/* Tabla de reglas */}
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Reglas activas</p>
        <div className="mt-4 grid grid-cols-[1fr_180px_100px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span>Patrón</span><span>Categoría</span><span>Matches</span><span>Acción</span>
        </div>
        <div className="divide-y divide-neutral-100">
          {state.rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[1fr_180px_100px_80px] gap-4 py-4">
              <span className="font-mono text-finance-ink">{rule.pattern}</span>
              <span>{rule.category_name}</span>
              <span>{rule.match_count}</span>
              <button onClick={() => handleDeleteRule(rule.id)} className="text-finance-red hover:underline">Borrar</button>
            </div>
          ))}
          {state.rules.length === 0 && <p className="py-6 text-center text-neutral-400">Sin reglas todavía.</p>}
        </div>
      </div>
    </div>
  );
}
