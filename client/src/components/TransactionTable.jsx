import { useEffect, useRef, useState } from "react";
import Badge from "./Badge";
import CategorySelect from "./CategorySelect";
import { fmtMoney, shortDate } from "../utils";

export default function TransactionTable({
  transactions, categories,
  onCategorize, onBulkCategorize, onDelete, onUpdateDesc, onUpdateFull,
  externalCatFilter, onClearExternalFilter,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingDesc, setEditingDesc] = useState({});
  const [editingRow, setEditingRow] = useState(null);
  const [editRowData, setEditRowData] = useState({});
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkCatId, setBulkCatId] = useState("");
  const searchRef = useRef(null);

  // Reset internal filters when external filter activates
  useEffect(() => {
    if (externalCatFilter) {
      setFilterCat("");
      setActiveFilter("all");
    }
  }, [externalCatFilter]);

  // Keyboard shortcut: / focuses the search input
  useEffect(() => {
    function onKey(e) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA" && document.activeElement?.tagName !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const catTypeMap = Object.fromEntries(categories.map((c) => [c.id, c.type]));

  const filtered = transactions.filter((tx) => {
    if (externalCatFilter) return tx.category_name === externalCatFilter;

    const q = search.toLowerCase();
    const matchesSearch = !q ||
      (tx.desc_banco || "").toLowerCase().includes(q) ||
      (tx.desc_usuario || "").toLowerCase().includes(q);

    const matchesCat = !filterCat ||
      String(tx.category_id) === filterCat ||
      (filterCat === "__none__" && !tx.category_id);

    let matchesQuick = true;
    if (activeFilter === "pending") matchesQuick = !tx.category_id;
    else if (activeFilter === "income") matchesQuick = tx.monto > 0;
    else if (activeFilter === "fijo") matchesQuick = catTypeMap[tx.category_id] === "fijo";
    else if (activeFilter === "variable") matchesQuick = catTypeMap[tx.category_id] === "variable";

    return matchesSearch && matchesCat && matchesQuick;
  });

  const pendingCount = transactions.filter((t) => !t.category_id).length;
  const uniqueCats = [...new Map(
    transactions.filter((t) => t.category_id).map((t) => [t.category_id, t.category_name])
  ).entries()];

  const PILLS = [
    { id: "all",      label: "Todos",       count: transactions.length },
    { id: "pending",  label: "Pendientes",  count: pendingCount },
    { id: "income",   label: "Ingresos",    count: transactions.filter((t) => t.monto > 0).length },
    { id: "fijo",     label: "Gastos fijos",count: transactions.filter((t) => catTypeMap[t.category_id] === "fijo").length },
    { id: "variable", label: "Variables",   count: transactions.filter((t) => catTypeMap[t.category_id] === "variable").length },
  ];

  const hasBulkSelect = pendingCount > 0;
  const uncatInFiltered = filtered.filter((t) => !t.category_id);
  const allUncatSelected = uncatInFiltered.length > 0 && uncatInFiltered.every((t) => selectedIds.has(t.id));

  // Grid template: with or without checkbox column
  const gridCls = hasBulkSelect
    ? "grid grid-cols-[20px_90px_1.5fr_120px_130px_170px_44px] gap-3"
    : "grid grid-cols-[90px_1.5fr_120px_130px_170px_44px] gap-3";

  function handleDeleteClick(id) {
    if (confirmDelete === id) {
      onDelete(id);
      setConfirmDelete(null);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } else {
      setConfirmDelete(id);
    }
  }

  function handleCategoryChange(txId, value) {
    onCategorize(txId, value);
    setEditingCategory(null);
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(txId); return next; });
  }

  function openEditRow(tx) {
    setEditingRow(tx.id);
    setEditRowData({ fecha: tx.fecha, monto: String(tx.monto) });
  }

  function saveEditRow(tx) {
    const fecha = editRowData.fecha;
    const monto = Number(editRowData.monto);
    if (fecha && !isNaN(monto) && (fecha !== tx.fecha || monto !== tx.monto)) {
      onUpdateFull?.(tx.id, { fecha, monto });
    }
    setEditingRow(null);
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleSelectAll() {
    const ids = uncatInFiltered.map((t) => t.id);
    if (allUncatSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  async function handleBulkSubmit() {
    if (!bulkCatId || selectedIds.size === 0) return;
    await onBulkCategorize?.([...selectedIds], bulkCatId);
    setSelectedIds(new Set());
    setBulkCatId("");
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">

      {/* Search + category dropdown */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <input
          ref={searchRef}
          type="search"
          placeholder="Buscar… (tecla /)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-[160px] flex-1 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-finance-ink placeholder:text-neutral-400 focus:border-finance-purple focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <select
          value={filterCat}
          onChange={(e) => { setFilterCat(e.target.value); onClearExternalFilter?.(); setActiveFilter("all"); }}
          className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
        >
          <option value="">Todas las categorías</option>
          <option value="__none__">Sin categorizar</option>
          {uniqueCats.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
        {(search || filterCat || externalCatFilter || activeFilter !== "all") && (
          <span className="text-xs text-neutral-400">{filtered.length} resultado{filtered.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Quick filter pills */}
      {!externalCatFilter && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none border-b border-neutral-100 px-5 py-2 dark:border-neutral-800">
          {PILLS.map((pill) => (
            <button
              key={pill.id}
              onClick={() => { setActiveFilter(pill.id); onClearExternalFilter?.(); }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                activeFilter === pill.id
                  ? "bg-finance-purple text-white"
                  : "bg-finance-cream text-finance-ink hover:bg-white dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              {pill.label}
              {pill.count > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                  activeFilter === pill.id
                    ? "bg-white/20 text-white"
                    : "bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400"
                }`}>{pill.count}</span>
              )}
            </button>
          ))}
          {hasBulkSelect && uncatInFiltered.length > 0 && (
            <button
              onClick={handleToggleSelectAll}
              className="ml-auto shrink-0 rounded-full border border-dashed border-neutral-300 px-3 py-1.5 text-xs text-neutral-500 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-600 dark:text-neutral-400 dark:hover:border-finance-purple dark:hover:text-purple-300"
            >
              {allUncatSelected ? "Deseleccionar" : "Seleccionar pendientes"}
            </button>
          )}
        </div>
      )}

      {/* External filter banner (from pie chart click) */}
      {externalCatFilter && (
        <div className="flex items-center justify-between border-b border-neutral-100 bg-finance-purpleSoft px-5 py-2 dark:border-neutral-800 dark:bg-purple-900/20">
          <span className="text-sm font-semibold text-finance-purple dark:text-purple-300">
            Filtrando por: {externalCatFilter}
          </span>
          <button
            onClick={onClearExternalFilter}
            className="text-xs text-finance-purple transition hover:underline dark:text-purple-300"
          >
            ✕ Limpiar filtro
          </button>
        </div>
      )}

      {/* ── Desktop: column headers (hidden on mobile) ── */}
      <div className={`hidden md:grid ${gridCls} border-b border-neutral-100 px-5 py-3 text-xs uppercase tracking-[0.18em] text-neutral-400 dark:border-neutral-800`}>
        {hasBulkSelect && <span />}
        <span>Fecha</span>
        <span>Descripción</span>
        <span className="text-right">Monto</span>
        <span>Cuenta</span>
        <span>Categoría</span>
        <span />
      </div>

      {/* ── Rows ── */}
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {filtered.map((tx) => {
          const availableCategories = tx.monto > 0
            ? categories
            : categories.filter((c) => c.name !== "Ingreso");
          const isEditingThis = editingRow === tx.id;
          const isSelected    = selectedIds.has(tx.id);
          const rowBg = !tx.category_id
            ? isSelected
              ? "bg-finance-purpleSoft dark:bg-purple-900/20"
              : "bg-finance-amberSoft/40 dark:bg-amber-900/15"
            : "";

          // ── Category cell content (shared between mobile and desktop) ──
          const categoryCellContent = (
            <>
              {tx.category_name && editingCategory !== tx.id ? (
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditingCategory(tx.id)} title="Clic para cambiar categoría" className="flex-1 text-left">
                    <Badge>{tx.category_name}</Badge>
                  </button>
                </div>
              ) : editingCategory !== tx.id && tx.suggestion ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleCategoryChange(tx.id, tx.suggestion.category_id)}
                      className="flex-1 rounded-full bg-finance-tealSoft px-3 py-1 text-left text-xs font-semibold text-finance-teal transition hover:bg-finance-teal hover:text-white dark:bg-teal-900/40 dark:text-teal-300 dark:hover:bg-teal-700 dark:hover:text-white"
                    >
                      ✓ {tx.suggestion.category_name}
                    </button>
                    <button
                      onClick={() => setEditingCategory(tx.id)}
                      className="shrink-0 text-xs text-neutral-400 transition hover:text-finance-purple"
                    >
                      cambiar
                    </button>
                  </div>
                  <span className="pl-1 text-[10px] text-neutral-400">{tx.suggestion.source}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <CategorySelect
                      categories={availableCategories}
                      onChange={(value) => handleCategoryChange(tx.id, value)}
                    />
                  </div>
                  {editingCategory === tx.id && (
                    <button onClick={() => setEditingCategory(null)} className="text-xs text-neutral-400 hover:text-neutral-600">✕</button>
                  )}
                </div>
              )}
            </>
          );

          return (
            <div key={tx.id}>
              {/* ── Mobile card layout (hidden on md+) ── */}
              <div className={`md:hidden px-4 py-3 text-sm ${rowBg}`}>
                <div className="flex items-start gap-3">
                  {/* Bulk select checkbox */}
                  {hasBulkSelect && !tx.category_id && (
                    <button
                      onClick={() => toggleSelect(tx.id)}
                      className={`mt-1 h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${
                        isSelected
                          ? "border-finance-purple bg-finance-purple text-white"
                          : "border-neutral-300 hover:border-finance-purple dark:border-neutral-600"
                      }`}
                    >
                      {isSelected && <span className="text-[8px] font-bold leading-none">✓</span>}
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    {/* Top row: description + amount */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <input
                          className="w-full bg-transparent font-medium text-finance-ink focus:outline-none dark:text-neutral-100"
                          value={editingDesc[tx.id] ?? (tx.desc_usuario || tx.desc_banco)}
                          onChange={(e) => setEditingDesc((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                          onBlur={(e) => {
                            const newDesc = e.target.value.trim();
                            if (newDesc && newDesc !== (tx.desc_usuario || tx.desc_banco)) onUpdateDesc?.(tx.id, newDesc);
                            setEditingDesc((prev) => { const next = { ...prev }; delete next[tx.id]; return next; });
                          }}
                        />
                        <p className="text-xs text-neutral-400">
                          {shortDate(tx.fecha)}
                          {tx.account_name ? ` · ${tx.account_name}` : ""}
                          {tx.es_cuota ? " · cuota" : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className={`font-semibold ${tx.monto > 0 ? "text-finance-teal" : "text-finance-ink dark:text-neutral-100"}`}>
                          {tx.monto > 0 ? "+" : ""}{fmtMoney(tx.monto, tx.moneda)}
                        </p>
                        <button
                          onClick={() => handleDeleteClick(tx.id)}
                          className={`mt-1 text-xs font-bold transition ${
                            confirmDelete === tx.id
                              ? "text-finance-red"
                              : "text-neutral-300 hover:text-finance-red"
                          }`}
                        >
                          {confirmDelete === tx.id ? "confirmar ×" : "×"}
                        </button>
                      </div>
                    </div>

                    {/* Category row */}
                    <div className="mt-2">
                      {categoryCellContent}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Desktop grid row (hidden on mobile) ── */}
              <div className={`hidden md:grid ${gridCls} px-5 py-4 text-sm ${rowBg}`}>
                {/* Checkbox for uncategorized rows */}
                {hasBulkSelect && (
                  <div className="flex items-center">
                    {!tx.category_id ? (
                      <button
                        onClick={() => toggleSelect(tx.id)}
                        title={isSelected ? "Deseleccionar" : "Seleccionar para categorizar en lote"}
                        className={`h-4 w-4 rounded border-2 flex items-center justify-center transition ${
                          isSelected
                            ? "border-finance-purple bg-finance-purple text-white"
                            : "border-neutral-300 hover:border-finance-purple dark:border-neutral-600"
                        }`}
                      >
                        {isSelected && <span className="text-[8px] font-bold leading-none">✓</span>}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                )}

                <span className="self-center text-neutral-500">{shortDate(tx.fecha)}</span>

                <div>
                  <input
                    className="w-full bg-transparent font-medium text-finance-ink focus:outline-none focus:underline focus:decoration-finance-purple/40 placeholder:text-neutral-400 dark:text-neutral-100"
                    value={editingDesc[tx.id] ?? (tx.desc_usuario || tx.desc_banco)}
                    onChange={(e) => setEditingDesc((prev) => ({ ...prev, [tx.id]: e.target.value }))}
                    onBlur={(e) => {
                      const newDesc = e.target.value.trim();
                      if (newDesc && newDesc !== (tx.desc_usuario || tx.desc_banco)) {
                        onUpdateDesc?.(tx.id, newDesc);
                      }
                      setEditingDesc((prev) => { const next = { ...prev }; delete next[tx.id]; return next; });
                    }}
                    title="Clic para editar descripción"
                  />
                  {tx.desc_usuario && tx.desc_usuario !== tx.desc_banco
                    ? <p className="truncate text-xs text-neutral-400">{tx.desc_banco}</p>
                    : null}
                  {tx.es_cuota ? <span className="text-xs text-finance-amber">(cuota)</span> : null}
                  <button
                    onClick={() => isEditingThis ? setEditingRow(null) : openEditRow(tx)}
                    className="mt-0.5 text-[10px] text-neutral-400 transition hover:text-finance-purple"
                    title="Editar fecha y monto"
                  >
                    {isEditingThis ? "▲ cerrar" : "✎ editar fecha/monto"}
                  </button>
                </div>

                <span className={`self-center text-right font-semibold ${tx.monto > 0 ? "text-finance-teal" : "text-finance-ink dark:text-neutral-100"}`}>
                  {tx.monto > 0 ? "+" : ""}{fmtMoney(tx.monto, tx.moneda)}
                </span>
                <span className="self-center text-neutral-500">{tx.account_name || "—"}</span>

                {/* Category cell */}
                {categoryCellContent}

                <button
                  onClick={() => handleDeleteClick(tx.id)}
                  title={confirmDelete === tx.id ? "Clic de nuevo para confirmar" : "Borrar transacción"}
                  className={`flex h-8 w-8 items-center justify-center self-center rounded-full text-xs font-bold transition ${
                    confirmDelete === tx.id
                      ? "bg-finance-red text-white"
                      : "text-neutral-300 hover:bg-finance-redSoft hover:text-finance-red"
                  }`}
                >
                  {confirmDelete === tx.id ? "!" : "×"}
                </button>
              </div>

              {/* Inline edit row — fecha + monto (desktop only) */}
              {isEditingThis && (
                <div className="hidden md:flex flex-wrap items-center gap-3 border-t border-dashed border-neutral-200 bg-finance-cream/40 px-5 py-3 dark:border-neutral-700 dark:bg-neutral-800/40">
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    Fecha
                    <input
                      type="date"
                      value={editRowData.fecha}
                      onChange={(e) => setEditRowData((p) => ({ ...p, fecha: e.target.value }))}
                      className="rounded-xl border border-neutral-200 px-3 py-1.5 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-neutral-500">
                    Monto
                    <input
                      type="number"
                      value={editRowData.monto}
                      onChange={(e) => setEditRowData((p) => ({ ...p, monto: e.target.value }))}
                      className="w-32 rounded-xl border border-neutral-200 px-3 py-1.5 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                      placeholder="negativo = gasto"
                    />
                  </label>
                  <button
                    onClick={() => saveEditRow(tx)}
                    className="rounded-full bg-finance-purple px-4 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => setEditingRow(null)}
                    className="text-xs text-neutral-400 hover:text-neutral-600"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-5 py-8 text-center text-neutral-400">
            {transactions.length === 0
              ? "No hay transacciones en este período."
              : "Sin resultados para ese filtro."}
          </p>
        )}
      </div>

      {/* Floating bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-finance-ink px-5 py-3 shadow-2xl dark:bg-neutral-900 dark:border dark:border-white/10">
          <span className="text-sm font-semibold text-white">
            {selectedIds.size} seleccionada{selectedIds.size !== 1 ? "s" : ""}
          </span>
          <select
            value={bulkCatId}
            onChange={(e) => setBulkCatId(e.target.value)}
            className="rounded-xl border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-finance-purple"
          >
            <option value="">Categoría…</option>
            {categories.filter((c) => c.name !== "Ingreso").map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleBulkSubmit}
            disabled={!bulkCatId}
            className="rounded-full bg-finance-purple px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Categorizar
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-neutral-400 transition hover:text-white"
            title="Cancelar selección"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
