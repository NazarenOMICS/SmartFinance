import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import CategorySelect from "./CategorySelect";
import { useToast } from "../contexts/ToastContext";
import { fmtMoney } from "../utils";

function formatSuggestionSource(source) {
  if (source === "rule_auto") return "Regla automatica";
  if (source === "rule_suggest" || source === "regla") return "Regla";
  if (source === "amount_profile") return "Monto aprendido";
  if (source === "history") return "Historial";
  if (source === "heuristica" || source === "keyword") return "Heuristica";
  if (source === "cloudflare-ai") return "Cloudflare AI";
  if (source === "ollama") return "AI local";
  if (source === "ollama_new_category") return "Categoria nueva sugerida";
  if (source === "fallback_new_category") return "Nueva categoria sugerida";
  if (source === "fx_exchange") return "Cambio de moneda";
  if (source === "internal_transfer") return "Transferencia interna";
  return "Sugerencia";
}

function formatConfidence(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}% confianza`;
}

export default function TransactionReviewDeck({
  items,
  categories,
  accounts = [],
  onDone,
  onClose,
  onCategoryCreated,
}) {
  const { addToast } = useToast();
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedTargetAccountId, setSelectedTargetAccountId] = useState("");
  const [dismissedInternalIds, setDismissedInternalIds] = useState([]);

  const otherCategory = useMemo(
    () => categories.find((category) => String(category.name || "").toLowerCase() === "otros") || null,
    [categories]
  );

  const current = items[index] || null;
  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    return ((index + 1) / items.length) * 100;
  }, [items.length, index]);
  const isInternalOperationActive = Boolean(current?.internal_operation_kind) && !dismissedInternalIds.includes(current?.transaction_id);
  const availableCounterpartyAccounts = useMemo(
    () => accounts.filter((account) => account.id !== current?.internal_operation_from_account_id && account.id !== current?.account_id),
    [accounts, current?.internal_operation_from_account_id, current?.account_id]
  );

  useEffect(() => {
    if (index >= items.length && items.length > 0) {
      setIndex(items.length - 1);
    }
    if (items.length === 0) {
      setIndex(0);
    }
  }, [items.length, index]);

  useEffect(() => {
    setSelectedCategoryId(current?.suggested_category_id ? String(current.suggested_category_id) : "");
  }, [current?.transaction_id, current?.suggested_category_id]);

  useEffect(() => {
    setSelectedTargetAccountId(current?.internal_operation_to_account_id ? String(current.internal_operation_to_account_id) : "");
  }, [current?.transaction_id, current?.internal_operation_to_account_id]);

  function next() {
    if (index + 1 >= items.length) {
      onDone?.();
    } else {
      setIndex((prev) => prev + 1);
    }
  }

  async function applyCategory(categoryId, options = {}) {
    if (!current || saving || !categoryId) return;
    setSaving(true);
    try {
      const result = await api.updateTransaction(current.transaction_id, { category_id: Number(categoryId) });
      setHistory((prev) => [...prev, {
        type: "apply",
        transactionId: current.transaction_id,
        previousCategoryId: null,
        createdRuleId: result?.rule?.created ? result?.rule?.rule?.id : null,
        createdCategoryId: options.createdCategoryId || null,
      }]);
      addToast("success", "Categoria aplicada.");
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmInternalOperation(kindOverride) {
    if (!current || saving || !current.internal_operation_kind) return;
    const targetTransactionId = current.internal_operation_target_transaction_id || null;
    const toAccountId = selectedTargetAccountId || current.internal_operation_to_account_id || null;
    if (!targetTransactionId && !toAccountId) {
      addToast("warning", "Elegi la cuenta destino para guardar esta operacion.");
      return;
    }

    setSaving(true);
    try {
      await api.confirmInternalOperation({
        kind: kindOverride,
        source_transaction_id: current.transaction_id,
        target_transaction_id: targetTransactionId,
        from_account_id: current.internal_operation_from_account_id || current.account_id || null,
        to_account_id: toAccountId,
        effective_rate: current.internal_operation_effective_rate || null,
      });
      addToast("success", kindOverride === "fx_exchange" ? "Compra de moneda confirmada." : "Transferencia interna confirmada.");
      next();
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRejectInternalOperation() {
    if (!current || saving) return;
    setSaving(true);
    try {
      await api.rejectInternalOperation({ source_transaction_id: current.transaction_id });
      setDismissedInternalIds((prev) => [...prev, current.transaction_id]);
      addToast("info", "Perfecto. Ahora podes categorizarlo como un movimiento normal.");
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAcceptSuggestion() {
    if (!current || saving) return;
    if (isInternalOperationActive) {
      await handleConfirmInternalOperation(current.internal_operation_kind);
      return;
    }
    if (current.suggested_category_id) {
      await applyCategory(current.suggested_category_id);
      return;
    }

    if (current.proposed_new_category) {
      setSaving(true);
      try {
        const created = await api.createCategory({
          name: current.proposed_new_category.name,
          type: current.proposed_new_category.type || "variable",
          budget: 0,
          color: current.proposed_new_category.color,
        });
        onCategoryCreated?.();
        setSaving(false);
        await applyCategory(created.id, { createdCategoryId: created.id });
      } catch (error) {
        setSaving(false);
        addToast("error", error.message);
      }
      return;
    }

    addToast("warning", "No hay una categoria sugerida lista para aceptar.");
  }

  function handleSkip() {
    if (!current || saving) return;
    setHistory((prev) => [...prev, { type: "skip" }]);
    next();
  }

  async function handleBack() {
    if (index === 0 || history.length === 0 || saving) return;
    const last = history[history.length - 1];
    setSaving(true);
    try {
      if (last.type === "apply") {
        await api.updateTransaction(last.transactionId, { category_id: last.previousCategoryId });
        if (last.createdRuleId) {
          await api.deleteRule(last.createdRuleId);
        }
        if (last.createdCategoryId) {
          await api.deleteCategory(last.createdCategoryId).catch(() => {});
          onCategoryCreated?.();
        }
      }
      setHistory((prev) => prev.slice(0, -1));
      setIndex((prev) => Math.max(prev - 1, 0));
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!current) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-[32px] bg-white p-6 shadow-2xl dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Revision individual</p>
            <h3 className="mt-1 font-display text-3xl text-finance-ink dark:text-neutral-100">
              Ajustemos lo que todavia no quedo claro
            </h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500 dark:text-neutral-300">
              Cada movimiento sale con una sugerencia para que no quede enterrado bajo una categoria incorrecta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose?.()}
            className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800"
          >
            x
          </button>
        </div>

        <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
          <div className="h-full rounded-full bg-finance-purple transition-all" style={{ width: `${progress}%` }} />
        </div>

        <div className="mt-5 rounded-[28px] border border-neutral-200 bg-finance-cream/60 p-5 dark:border-neutral-700 dark:bg-neutral-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-finance-purple dark:bg-neutral-900/85 dark:text-purple-200">
              {formatSuggestionSource(current.suggestion_source)}
            </span>
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-300">
              {current.fecha}
            </span>
            {formatConfidence(current.category_confidence) ? (
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-neutral-500 dark:bg-neutral-900/70 dark:text-neutral-300">
                {formatConfidence(current.category_confidence)}
              </span>
            ) : null}
          </div>

          <p className="mt-4 text-4xl font-semibold tracking-tight text-finance-ink dark:text-neutral-100">
            {fmtMoney(current.monto, current.moneda)}
          </p>
          <p className="mt-3 text-lg font-semibold text-finance-ink dark:text-neutral-100">
            {current.desc_banco}
          </p>
          <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-300">
            {current.suggestion_reason || "Sugerencia del motor"}
          </p>

          {isInternalOperationActive ? (
            <div className="mt-4 rounded-2xl bg-white/85 px-4 py-4 dark:bg-neutral-900/85">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">
                {current.internal_operation_kind === "fx_exchange" ? "Cambio de moneda" : "Transferencia interna"}
              </p>
              <p className="mt-2 text-lg font-semibold text-finance-ink dark:text-neutral-100">
                {current.internal_operation_kind === "fx_exchange"
                  ? "Detectamos una compra de moneda entre tus cuentas"
                  : "Detectamos una transferencia entre tus cuentas"}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-finance-cream/70 px-4 py-3 dark:bg-neutral-800/80">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Origen</p>
                  <p className="mt-1 font-semibold text-finance-ink dark:text-neutral-100">
                    {current.internal_operation_from_account_name || "Cuenta actual"}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-300">
                    {current.internal_operation_from_currency || current.moneda}
                  </p>
                </div>
                <div className="rounded-2xl bg-finance-cream/70 px-4 py-3 dark:bg-neutral-800/80">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Destino</p>
                  <p className="mt-1 font-semibold text-finance-ink dark:text-neutral-100">
                    {current.internal_operation_to_account_name || "Pendiente de vincular"}
                  </p>
                  <p className="text-xs text-neutral-500 dark:text-neutral-300">
                    {current.internal_operation_to_currency
                      ? `${current.internal_operation_to_currency}${current.internal_operation_effective_rate ? ` · TC ${Number(current.internal_operation_effective_rate).toFixed(2)}` : ""}`
                      : "Falta la otra pata de la operacion"}
                  </p>
                </div>
              </div>
              {!current.internal_operation_target_transaction_id && (
                <div className="mt-4">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Elegi la otra cuenta</p>
                  <select
                    value={selectedTargetAccountId}
                    onChange={(event) => setSelectedTargetAccountId(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  >
                    <option value="">Seleccionar cuenta destino</option>
                    {availableCounterpartyAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.currency}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl bg-white/80 px-4 py-4 dark:bg-neutral-900/80">
              <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Categoria sugerida</p>
              {current.suggested_category_id ? (
                <p className="mt-1 text-lg font-semibold text-finance-ink dark:text-neutral-100">
                  {current.suggested_category_name}
                </p>
              ) : (
                <div className="mt-2">
                  <p className="text-lg font-semibold text-finance-ink dark:text-neutral-100">
                    {current.proposed_new_category?.name || current.suggested_category_name}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                    Categoria nueva sugerida en modo {current.proposed_new_category?.type || "variable"}
                  </p>
                </div>
              )}
              {formatConfidence(current.category_confidence) ? (
                <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-300">
                  Confianza estimada: {formatConfidence(current.category_confidence)}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-5 rounded-[26px] border border-neutral-200 bg-white/80 p-5 dark:border-neutral-700 dark:bg-neutral-950/60">
          {isInternalOperationActive && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleConfirmInternalOperation(current.internal_operation_kind)}
                disabled={saving}
                className="rounded-full bg-finance-purple px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {current.internal_operation_target_transaction_id
                  ? (current.internal_operation_kind === "fx_exchange" ? "Confirmar compra de moneda" : "Confirmar transferencia interna")
                  : "Guardar como incompleta"}
              </button>
              {current.internal_operation_kind === "fx_exchange" && (
                <button
                  type="button"
                  onClick={() => handleConfirmInternalOperation("internal_transfer")}
                  disabled={saving}
                  className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-finance-ink transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                >
                  Es transferencia entre mis cuentas
                </button>
              )}
              <button
                type="button"
                onClick={handleRejectInternalOperation}
                disabled={saving}
                className="rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-600 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                No, categorizar normal
              </button>
            </div>
          )}

          <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Cambiar categoria</p>
          {otherCategory ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyCategory(otherCategory.id)}
                disabled={saving}
                className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                Mandar a Otros
              </button>
            </div>
          ) : null}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1">
              <CategorySelect
                categories={categories}
                value={selectedCategoryId}
                onChange={(value) => setSelectedCategoryId(String(value))}
                onCategoryCreated={onCategoryCreated}
              />
            </div>
            <button
              type="button"
              onClick={() => applyCategory(selectedCategoryId)}
              disabled={saving || !selectedCategoryId}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-finance-ink transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
            >
              Usar esta otra
            </button>
          </div>
          <p className="mt-2 text-xs leading-6 text-neutral-500 dark:text-neutral-300">
            Si no existe, podes crear una desde el selector.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              disabled={index === 0 || saving}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-400 transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700"
            >
              Atras
            </button>
            <button
              type="button"
              onClick={handleSkip}
              disabled={saving}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-finance-ink dark:border-neutral-700"
            >
              Omitir
            </button>
          </div>

          <button
            type="button"
            onClick={handleAcceptSuggestion}
            disabled={saving}
            className="rounded-2xl bg-finance-purple px-5 py-3 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {isInternalOperationActive
              ? (current.internal_operation_target_transaction_id
                ? (current.internal_operation_kind === "fx_exchange" ? "Confirmar compra de moneda" : "Confirmar transferencia interna")
                : "Guardar como incompleta")
              : (current.suggested_category_id ? "Aceptar sugerencia" : "Crear y usar sugerencia")}
          </button>
        </div>
      </div>
    </div>
  );
}
