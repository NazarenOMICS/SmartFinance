import Badge from "./Badge";
import CategorySelect from "./CategorySelect";
import { fmtMoney, shortDate } from "../utils";

export default function TransactionTable({ transactions, categories, onCategorize }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 shadow-panel">
      <div className="grid grid-cols-[90px_1.5fr_120px_140px_180px] gap-4 border-b border-neutral-100 px-5 py-3 text-xs uppercase tracking-[0.18em] text-neutral-400">
        <span>Fecha</span>
        <span>Descripción</span>
        <span className="text-right">Monto</span>
        <span>Cuenta</span>
        <span>Categoría</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {transactions.map((tx) => (
          <div
            key={tx.id}
            className={`grid grid-cols-[90px_1.5fr_120px_140px_180px] gap-4 px-5 py-4 text-sm ${!tx.category_id ? "bg-finance-amberSoft/40" : ""}`}
          >
            <span className="text-neutral-500">{shortDate(tx.fecha)}</span>
            <div>
              <p className="font-medium text-finance-ink">{tx.desc_usuario || tx.desc_banco}</p>
              {tx.es_cuota ? <span className="text-xs text-finance-amber">(cuota)</span> : null}
            </div>
            <span className={`text-right font-semibold ${tx.monto > 0 ? "text-finance-teal" : "text-finance-ink"}`}>
              {tx.monto > 0 ? "+" : ""}
              {fmtMoney(tx.monto, tx.moneda)}
            </span>
            <span className="text-neutral-500">{tx.account_name || "—"}</span>
            {tx.category_name ? (
              <div className="flex items-center">
                <Badge>{tx.category_name}</Badge>
              </div>
            ) : (
              <CategorySelect categories={categories.filter((category) => category.name !== "Ingreso")} onChange={(value) => onCategorize(tx.id, value)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
