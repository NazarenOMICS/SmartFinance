import { useEffect, useRef, useState } from "react";
import { api } from "../api";

const PRESET_COLORS = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780", "#9B59B6", "#2ECC71"];

export default function CategorySelect({ categories, value, onChange, onCategoryCreated }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  function nextUnusedColor() {
    const usedColors = new Set(categories.map((c) => c.color).filter(Boolean));
    return PRESET_COLORS.find((c) => !usedColors.has(c)) || PRESET_COLORS[0];
  }
  const [newCat, setNewCat] = useState({ name: "", type: "variable", color: nextUnusedColor() });
  const [saving, setSaving] = useState(false);
  const ref = useRef(null);
  const inputRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
        setCreating(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const selected = categories.find((c) => String(c.id) === String(value));
  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  function handleSelect(catId) {
    onChange(catId);
    setOpen(false);
    setCreating(false);
    setSearch("");
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newCat.name.trim() || saving) return;
    setSaving(true);
    try {
      const created = await api.createCategory({
        name: newCat.name.trim(),
        type: newCat.type,
        budget: 0,
        color: newCat.color,
      });
      setNewCat({ name: "", type: "variable", color: nextUnusedColor() });
      setCreating(false);
      setSearch("");
      onCategoryCreated?.();
      // Auto-select the new category
      if (created?.id) {
        onChange(created.id);
        setOpen(false);
      }
    } catch {
      // Toast will be handled by parent if needed
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition
          ${open
            ? "border-finance-purple bg-white shadow-sm dark:bg-neutral-800"
            : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-neutral-600"
          }
        `}
      >
        {selected ? (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: selected.color || "#888780" }} />
            <span className="flex-1 truncate text-finance-ink dark:text-neutral-100">{selected.name}</span>
          </>
        ) : (
          <span className="flex-1 text-neutral-400">Asignar categoría</span>
        )}
        <svg className={`h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          style={{ minWidth: "220px" }}
        >
          {/* Search */}
          {!creating && (
            <div className="border-b border-neutral-100 p-2 dark:border-neutral-800">
              <input
                ref={inputRef}
                type="text"
                placeholder="Buscar categoría…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg bg-neutral-50 px-3 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:outline-none dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
            </div>
          )}

          {/* Category list */}
          {!creating && (
            <div className="max-h-48 overflow-y-auto overscroll-contain">
              {filtered.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleSelect(cat.id)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-finance-cream/70 active:bg-finance-cream dark:hover:bg-neutral-800 dark:active:bg-neutral-700
                    ${String(cat.id) === String(value) ? "bg-finance-purpleSoft/50 dark:bg-purple-900/20" : ""}
                  `}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color || "#888780" }} />
                  <span className="flex-1 text-finance-ink dark:text-neutral-100">{cat.name}</span>
                  <span className="text-[10px] uppercase tracking-wider text-neutral-400">{cat.type}</span>
                </button>
              ))}
              {filtered.length === 0 && search && (
                <p className="px-3 py-3 text-center text-xs text-neutral-400">
                  No hay categorías con "{search}"
                </p>
              )}
            </div>
          )}

          {/* Create new category form */}
          {creating ? (
            <form onSubmit={handleCreate} className="border-t border-neutral-100 p-3 dark:border-neutral-800">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Nueva categoría</p>
              <input
                autoFocus
                type="text"
                placeholder="Nombre"
                value={newCat.name}
                onChange={(e) => setNewCat((p) => ({ ...p, name: e.target.value }))}
                className="mb-2 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-finance-ink focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                required
              />
              <div className="mb-3 flex items-center gap-2">
                <div className="flex gap-1">
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setNewCat((p) => ({ ...p, color }))}
                      className={`h-5 w-5 rounded-full transition ${newCat.color === color ? "ring-2 ring-finance-purple ring-offset-1 dark:ring-offset-neutral-900" : "hover:scale-110"}`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="ml-auto flex rounded-lg border border-neutral-200 text-xs dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => setNewCat((p) => ({ ...p, type: "variable" }))}
                    className={`rounded-l-lg px-2.5 py-1 transition ${newCat.type === "variable" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                  >
                    variable
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewCat((p) => ({ ...p, type: "fijo" }))}
                    className={`rounded-r-lg px-2.5 py-1 transition ${newCat.type === "fijo" ? "bg-finance-purple text-white" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
                  >
                    fijo
                  </button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving || !newCat.name.trim()}
                  className="flex-1 rounded-xl bg-finance-purple px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? "Creando…" : "Crear"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="rounded-xl px-3 py-2 text-sm text-neutral-500 transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setCreating(true); setSearch(""); }}
              className="flex w-full items-center gap-2 border-t border-neutral-100 px-3 py-2.5 text-left text-sm font-semibold text-finance-purple transition hover:bg-finance-purpleSoft/50 active:bg-finance-purpleSoft dark:border-neutral-800 dark:text-purple-300 dark:hover:bg-purple-900/20"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-finance-purple/10 text-finance-purple dark:bg-purple-900/40 dark:text-purple-300">+</span>
              Nueva categoría
            </button>
          )}
        </div>
      )}
    </div>
  );
}
