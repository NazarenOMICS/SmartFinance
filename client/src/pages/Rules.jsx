import { useEffect, useState } from "react";
import { api } from "../api";

export default function Rules() {
  const [state, setState] = useState({ loading: true, error: "", categories: [], rules: [] });
  const [localBudgets, setLocalBudgets] = useState({});
  const [form, setForm] = useState({ pattern: "", category_id: "" });

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

  useEffect(() => {
    load();
  }, []);

  async function updateCategory(category, changes) {
    await api.updateCategory(category.id, { ...category, ...changes });
    await load();
  }

  async function handleCreateRule(event) {
    event.preventDefault();
    await api.createRule({ pattern: form.pattern, category_id: Number(form.category_id) });
    setForm({ pattern: "", category_id: "" });
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
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Presupuestos</p>
        <div className="mt-4 space-y-4">
          {state.categories.filter((category) => category.name !== "Ingreso").map((category) => (
            <div key={category.id} className="grid gap-4 md:grid-cols-[1.2fr_130px_130px]">
              <span className="self-center font-semibold text-finance-ink">{category.name}</span>
              <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={category.type} onChange={(event) => updateCategory(category, { type: event.target.value })}>
                <option value="fijo">fijo</option>
                <option value="variable">variable</option>
              </select>
              <input
                className="rounded-2xl border border-neutral-200 px-4 py-3"
                type="number"
                value={localBudgets[category.id] ?? category.budget}
                onChange={(event) => setLocalBudgets((prev) => ({ ...prev, [category.id]: event.target.value }))}
                onBlur={(event) => updateCategory(category, { budget: Number(event.target.value) })}
              />
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleCreateRule} className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Nueva regla</p>
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_220px_auto]">
          <input className="rounded-2xl border border-neutral-200 px-4 py-3" placeholder="Patrón" value={form.pattern} onChange={(event) => setForm((prev) => ({ ...prev, pattern: event.target.value }))} />
          <select className="rounded-2xl border border-neutral-200 px-4 py-3" value={form.category_id} onChange={(event) => setForm((prev) => ({ ...prev, category_id: event.target.value }))}>
            <option value="">Categoría</option>
            {state.categories.filter((category) => category.name !== "Ingreso").map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white">Agregar</button>
        </div>
      </form>

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <div className="grid grid-cols-[1fr_180px_100px_80px] gap-4 border-b border-neutral-100 pb-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
          <span>Patrón</span>
          <span>Categoría</span>
          <span>Matches</span>
          <span>Acción</span>
        </div>
        <div className="divide-y divide-neutral-100">
          {state.rules.map((rule) => (
            <div key={rule.id} className="grid grid-cols-[1fr_180px_100px_80px] gap-4 py-4">
              <span className="font-mono text-finance-ink">{rule.pattern}</span>
              <span>{rule.category_name}</span>
              <span>{rule.match_count}</span>
              <button onClick={() => handleDeleteRule(rule.id)} className="text-finance-red">
                Borrar
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

