import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { fmtMoney, shortDate } from "../utils";

export default function SearchModal({ onClose, onNavigateToMonth }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const trimmedQuery = query.trim();
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmedQuery.length < 2) {
      setResults([]);
      setActiveIdx(0);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.searchTransactions(trimmedQuery, 25);
        if (!cancelled && requestIdRef.current === requestId) {
          setResults(data);
          setActiveIdx(0);
        }
      } catch (_) {
        if (!cancelled && requestIdRef.current === requestId) {
          setResults([]);
          setActiveIdx(0);
        }
      }
      finally {
        if (!cancelled && requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, 280);

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleKeyDown(e) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && results[activeIdx]) {
      pickResult(results[activeIdx]);
    }
  }

  function pickResult(tx) {
    const month = tx.fecha.slice(0, 7);
    onNavigateToMonth?.(month);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-finance-ink/40 backdrop-blur-sm dark:bg-black/60" />

      {/* Panel */}
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl dark:border-white/10 dark:bg-neutral-900">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-neutral-100 px-5 py-4 dark:border-neutral-800">
          <span className="text-lg text-neutral-400">⌕</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Buscar transacciones… (descripción o monto)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-lg text-finance-ink placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-600"
          />
          {loading && (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-finance-purple border-t-transparent" />
          )}
          <kbd className="rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-400 dark:border-neutral-700 dark:bg-neutral-800">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {results.length === 0 && query.trim().length >= 2 && !loading && (
            <p className="py-10 text-center text-sm text-neutral-400">Sin resultados para "{query}"</p>
          )}
          {results.length === 0 && query.trim().length < 2 && (
            <div className="px-5 py-6 text-sm text-neutral-400 space-y-2">
              <p className="font-semibold text-finance-ink dark:text-neutral-200">Búsqueda global</p>
              <p>Buscá en todas tus transacciones de todos los meses. Escribí al menos 2 caracteres.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {["supermercado", "oca", "netflix", "alquiler"].map((hint) => (
                  <button
                    key={hint}
                    onClick={() => setQuery(hint)}
                    className="rounded-full bg-finance-cream px-3 py-1 text-xs font-medium text-finance-ink transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-purple-900/30 dark:hover:text-purple-300"
                  >
                    {hint}
                  </button>
                ))}
              </div>
            </div>
          )}
          {results.map((tx, i) => (
            <button
              key={tx.id}
              onClick={() => pickResult(tx)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition ${
                i === activeIdx ? "bg-finance-purpleSoft dark:bg-purple-900/20" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`h-2 w-2 shrink-0 rounded-full`} style={{ backgroundColor: tx.category_color || "#888780" }} />
                <div className="min-w-0">
                  <p className="truncate font-medium text-finance-ink dark:text-neutral-100">
                    {tx.desc_usuario || tx.desc_banco}
                  </p>
                  {tx.desc_usuario && tx.desc_usuario !== tx.desc_banco && (
                    <p className="truncate text-xs text-neutral-400">{tx.desc_banco}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-sm">
                {tx.category_name && (
                  <span className="hidden rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 sm:inline dark:bg-neutral-800 dark:text-neutral-400">
                    {tx.category_name}
                  </span>
                )}
                <span className="text-xs text-neutral-400">{shortDate(tx.fecha)}</span>
                <span className={`font-semibold ${tx.monto > 0 ? "text-finance-teal" : "text-finance-ink dark:text-neutral-100"}`}>
                  {tx.monto > 0 ? "+" : ""}{fmtMoney(tx.monto, tx.moneda)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Footer */}
        {results.length > 0 && (
          <div className="flex items-center gap-4 border-t border-neutral-100 px-5 py-2 text-xs text-neutral-400 dark:border-neutral-800">
            <span><kbd className="rounded border border-neutral-200 px-1 dark:border-neutral-700">↑↓</kbd> navegar</span>
            <span><kbd className="rounded border border-neutral-200 px-1 dark:border-neutral-700">↵</kbd> ir al mes</span>
            <span className="ml-auto">{results.length} resultado{results.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
