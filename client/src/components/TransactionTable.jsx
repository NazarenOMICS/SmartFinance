import { useState } from "react";
import Badge from "./Badge";
import CategorySelect from "./CategorySelect";
import { fmtMoney, shortDate } from "../utils";

export default function TransactionTable({ transactions, categories, onCategorize, onDelete, onUpdateDesc }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editingCategory, setEditingCategory] = useState(null);
  const [editingDesc, setEditingDesc] = useState({});

  function handleDeleteClick(id) {
    if (confirmDelete === id) {
      onDelete(id);
      setConfirmDelete(null);
    } else {
      setConfirmDelete(id);
    }
  }

  function handleCategoryChange(txId, value) {
    onCategorize(txId, value);
    setEditingCategory(null);
  }

  return (
    <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-panel">
      <div className="grid grid-cols-[90px_1.5fr_120px_130px_170px_44px] gap-3 border-b border-neutral-100 px-5 py-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
        <span>Fecha</span>
        <span>Descripción</span>
        <span className="text-right">Monto</span>
        <span>Cuenta</span>
        <span>Categoría</span>
        <span></span>
      </div>
      <div className="divide-y divide-neutral-100">
        {transactions.map((tx) => {
          // Income transactions can use Ingreso category; expense transactions filter it out
          const availableCategories = tx.monto > 0
            ? categories
            : categories.filter((c) => c.name !== "Ingreso");

          return (
            <div
              key={tx.id}
              className={`grid grid-cols-[90px_1.5fr_120px_130px_170px_44px] gap-3 px-5 py-4 text-sm ${!tx.category_id ? "bg-finance-amberSoft/40" : ""}`}
            >
              <span className="text-neutral-500">{shortDate(tx.fecha)}</span>
              <div>
                <input
                  className="w-full bg-transparent font-medium text-finance-ink focus:outline-none focus:underline focus:decoration-finance-purple/40 placeholder:text-neutral-400"
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
                  ? <p className="text-xs text-neutral-400 truncate">{tx.desc_banco}</p>
                  : null}
                {tx.es_cuota ? <span className="text-xs text-finance-amber">(cuota)</span> : null}
              </div>
              <span className={`text-right font-semibold ${tx.monto > 0 ? "text-finance-teal" : "text-finance-ink"}`}>
                {tx.monto > 0 ? "+" : ""}{fmtMoney(tx.monto, tx.moneda)}
              </span>
              <span className="text-neutral-500">{tx.account_name || "—"}</span>

              {/* Category: click badge to re-categorize */}
              {tx.category_name && editingCategory !== tx.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingCategory(tx.id)}
                    title="Clic para cambiar categoría"
                    className="flex-1"
                  >
                    <Badge>{tx.category_name}</Badge>
                  </button>
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
                    <button
                      onClick={() => setEditingCategory(null)}
                      className="text-xs text-neutral-400 hover:text-neutral-600"
                    >✕</button>
                  )}
                </div>
              )}

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
          );
        })}
        {transactions.length === 0 && (
          <p className="px-5 py-8 text-center text-neutral-400">No hay transacciones en este período.</p>
        )}
      </div>
    </div>
  );
}
