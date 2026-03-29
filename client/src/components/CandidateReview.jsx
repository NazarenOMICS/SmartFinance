import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney, shortDate } from "../utils";

/**
 * Tinder-style candidate review modal.
 * Shows uncategorized transactions matching a rule pattern one by one.
 * User confirms (tick) or rejects (cross) each one.
 *
 * Props:
 *  - pattern: string (rule pattern to match)
 *  - categoryId: number
 *  - categoryName: string
 *  - onDone: () => void (called when review is finished or dismissed)
 */
export default function CandidateReview({ pattern, categoryId, categoryName, ruleId = null, onDone }) {
  const { addToast } = useToast();
  const [candidates, setCandidates] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [confirmed, setConfirmed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    async function fetchCandidates() {
      try {
        const data = await api.getCandidates(pattern, categoryId);
        setCandidates(data);
      } catch {
        onDone?.();
      } finally {
        setLoading(false);
      }
    }
    fetchCandidates();
  }, [pattern, categoryId, onDone]);

  useEffect(() => {
    if (!loading && candidates.length === 0) {
      onDone?.();
    }
  }, [loading, candidates.length, onDone]);

  function finish(totalConfirmed = confirmed) {
    if (totalConfirmed > 0) {
      addToast("success", `${totalConfirmed} transaccion${totalConfirmed !== 1 ? "es" : ""} categorizada${totalConfirmed !== 1 ? "s" : ""} como "${categoryName}".`);
    }
    onDone?.();
  }

  function advance({ confirmedDelta = 0 } = {}) {
    if (currentIndex + 1 >= candidates.length) {
      finish(confirmed + confirmedDelta);
    } else {
      setCurrentIndex((prev) => prev + 1);
    }
  }

  async function handleConfirm() {
    const tx = candidates[currentIndex];
    if (!tx) return;
    try {
      await api.confirmCategory([tx.id], categoryId);
      setConfirmed((prev) => prev + 1);
      setHistory((prev) => [...prev, { type: "confirm", transactionId: tx.id }]);
      advance({ confirmedDelta: 1 });
    } catch {
      addToast("error", "No se pudo categorizar la transaccion.");
      advance();
    }
  }

  async function handleSkip() {
    const tx = candidates[currentIndex];
    if (!tx) return;
    try {
      if (ruleId) {
        await api.rejectCategory(tx.id, ruleId);
      }
      setSkipped((prev) => prev + 1);
      setHistory((prev) => [...prev, { type: "reject", transactionId: tx.id }]);
      advance();
    } catch {
      addToast("error", "No se pudo guardar el rechazo.");
    }
  }

  function handleConfirmAll() {
    const remaining = candidates.slice(currentIndex).map((tx) => tx.id);
    if (remaining.length === 0) {
      finish();
      return;
    }

    api.confirmCategory(remaining, categoryId)
      .then((result) => {
        const added = result?.confirmed || remaining.length;
        setConfirmed((prev) => prev + added);
        finish(confirmed + added);
      })
      .catch(() => {
        addToast("error", "Error al categorizar en lote.");
        finish();
      });
  }

  async function handleBack() {
    if (history.length === 0 || currentIndex === 0) return;
    const lastAction = history[history.length - 1];
    try {
      if (lastAction.type === "confirm") {
        await api.undoConfirmCategory(lastAction.transactionId, categoryId);
        setConfirmed((prev) => Math.max(prev - 1, 0));
      } else if (lastAction.type === "reject" && ruleId) {
        await api.undoRejectCategory(lastAction.transactionId, ruleId);
        setSkipped((prev) => Math.max(prev - 1, 0));
      }
      setHistory((prev) => prev.slice(0, -1));
      setCurrentIndex((prev) => Math.max(prev - 1, 0));
    } catch {
      addToast("error", "No se pudo volver a la tarjeta anterior.");
    }
  }

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="rounded-[28px] bg-white p-8 shadow-2xl dark:bg-neutral-900">
          <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-finance-purple border-t-transparent" />
          <p className="mt-3 text-sm text-neutral-500">Buscando transacciones similares...</p>
        </div>
      </div>
    );
  }

  const current = candidates[currentIndex];
  if (!current) return null;

  const remaining = candidates.length - currentIndex;
  const progress = (currentIndex / candidates.length) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) finish(); }}>
      <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Confirmar categorias</p>
            <h3 className="font-display text-xl text-finance-ink dark:text-neutral-100">
              Regla: "{pattern}" {"->"} {categoryName}
            </h3>
          </div>
          <button
            onClick={() => finish()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            x
          </button>
        </div>

        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div
            className="h-full rounded-full bg-finance-purple transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mb-4 text-xs text-neutral-400">
          {remaining} restante{remaining !== 1 ? "s" : ""} · {confirmed} confirmada{confirmed !== 1 ? "s" : ""} · {skipped} saltada{skipped !== 1 ? "s" : ""}
        </p>

        <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-finance-ink dark:text-neutral-100">{current.desc_banco}</p>
              <p className="mt-1 text-xs text-neutral-400">
                {shortDate(current.fecha)}
                {current.account_name ? ` · ${current.account_name}` : ""}
              </p>
            </div>
            <p className={`shrink-0 font-semibold ${current.monto > 0 ? "text-finance-teal" : "text-finance-ink dark:text-neutral-100"}`}>
              {current.monto > 0 ? "+" : ""}{fmtMoney(current.monto, current.moneda)}
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={handleBack}
            disabled={history.length === 0 || currentIndex === 0}
            className="rounded-2xl border border-neutral-200 px-3 py-3 text-sm font-semibold text-neutral-400 transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700"
          >
            Atras
          </button>
          <button
            onClick={handleSkip}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-neutral-200 py-3 font-semibold text-neutral-500 transition hover:border-finance-red hover:text-finance-red dark:border-neutral-700 dark:hover:border-red-500 dark:hover:text-red-400"
          >
            x No
          </button>
          <button
            onClick={handleConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-finance-purple py-3 font-semibold text-white transition hover:opacity-90"
          >
            Si, es {categoryName}
          </button>
        </div>

        {remaining > 1 && (
          <div className="mt-3 flex justify-center gap-3">
            <button
              onClick={handleConfirmAll}
              className="text-xs font-semibold text-finance-purple transition hover:underline dark:text-purple-300"
            >
              Confirmar todas las restantes ({remaining})
            </button>
            <span className="text-neutral-300">|</span>
            <button
              onClick={() => finish()}
              className="text-xs text-neutral-400 transition hover:text-neutral-600"
            >
              Terminar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
