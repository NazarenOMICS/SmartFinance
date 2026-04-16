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
  if (source === "session_learned") return "Aprendido recien";
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

function cleanDescription(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isWeakDescription(value) {
  const text = cleanDescription(value);
  if (!text) return true;
  if (text.length < 3) return true;

  const withoutCurrency = text
    .replace(/[$UuSsAaRrYy .,\-+()]/g, "")
    .trim();
  const mostlyNumeric = /^[\d.,\s$()+\-]+$/.test(text);
  return mostlyNumeric || withoutCurrency.length === 0;
}

function getPrimaryDescription(transaction) {
  const userDescription = cleanDescription(transaction?.desc_usuario);
  if (!isWeakDescription(userDescription)) return userDescription;

  const bankDescription = cleanDescription(transaction?.desc_banco);
  if (!isWeakDescription(bankDescription)) return bankDescription;

  const counterparty = cleanDescription(transaction?.counterparty_key);
  if (!isWeakDescription(counterparty)) return counterparty;

  return "Movimiento sin descripcion";
}

function getTransactionId(transaction) {
  const id = Number(transaction?.transaction_id ?? transaction?.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeBatchKey(value) {
  return cleanDescription(value).toLowerCase();
}

function getMerchantBatchKey(transaction) {
  return normalizeBatchKey(
    transaction?.merchant_key
      || transaction?.counterparty_key
      || transaction?.suggested_rule_pattern
      || transaction?.rule_pattern
      || ""
  );
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
  const [completedIds, setCompletedIds] = useState(() => new Set());
  const [sessionLearnedCategories, setSessionLearnedCategories] = useState(() => new Map());

  const otherCategory = useMemo(
    () => categories.find((category) => String(category.name || "").toLowerCase() === "otros") || null,
    [categories]
  );
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [String(category.id), category])),
    [categories]
  );

  const reviewItems = useMemo(
    () => items
      .map((item) => {
        const merchantKey = getMerchantBatchKey(item);
        const learned = merchantKey ? sessionLearnedCategories.get(merchantKey) : null;
        if (!learned || item?.internal_operation_kind) return item;
        return {
          ...item,
          suggested_category_id: learned.categoryId,
          suggested_category_name: learned.categoryName,
          suggestion_source: "session_learned",
          suggestion_reason: `Aprendido en esta revision: ${learned.displayName} va a ${learned.categoryName}.`,
          category_confidence: Math.max(Number(item.category_confidence || 0), 0.99),
        };
      })
      .filter((item) => {
        const id = getTransactionId(item);
        return !id || !completedIds.has(id);
      }),
    [items, completedIds, sessionLearnedCategories]
  );

  const current = reviewItems[index] || null;
  const currentTransactionId = getTransactionId(current);
  const progress = useMemo(() => {
    if (items.length === 0) return 0;
    const completedCount = Math.max(0, items.length - reviewItems.length);
    return ((completedCount + (current ? 1 : 0)) / items.length) * 100;
  }, [current, items.length, reviewItems.length]);
  const isInternalOperationActive = Boolean(current?.internal_operation_kind) && !dismissedInternalIds.includes(currentTransactionId);
  const availableCounterpartyAccounts = useMemo(
    () => accounts.filter((account) => account.id !== current?.internal_operation_from_account_id && account.id !== current?.account_id),
    [accounts, current?.internal_operation_from_account_id, current?.account_id]
  );

  useEffect(() => {
    setCompletedIds(new Set());
    setSessionLearnedCategories(new Map());
    setHistory([]);
    setIndex(0);
  }, [items]);

  useEffect(() => {
    if (index >= reviewItems.length && reviewItems.length > 0) {
      setIndex(reviewItems.length - 1);
    }
    if (reviewItems.length === 0) {
      setIndex(0);
    }
  }, [reviewItems.length, index]);

  useEffect(() => {
    setSelectedCategoryId(current?.suggested_category_id ? String(current.suggested_category_id) : "");
  }, [currentTransactionId, current?.suggested_category_id]);

  useEffect(() => {
    setSelectedTargetAccountId(current?.internal_operation_to_account_id ? String(current.internal_operation_to_account_id) : "");
  }, [currentTransactionId, current?.internal_operation_to_account_id]);

  function next() {
    if (index + 1 >= reviewItems.length) {
      onDone?.();
    } else {
      setIndex((prev) => prev + 1);
    }
  }

  function advanceAfterCompleting(transactionIds) {
    const completed = new Set(transactionIds);
    const nextItems = reviewItems.filter((item) => {
      const id = getTransactionId(item);
      return !id || !completed.has(id);
    });
    setCompletedIds((prev) => {
      const nextSet = new Set(prev);
      transactionIds.forEach((id) => nextSet.add(id));
      return nextSet;
    });

    if (nextItems.length === 0) {
      onDone?.();
      return;
    }
    setIndex((prev) => Math.min(prev, nextItems.length - 1));
  }

  async function applyCategory(categoryId, options = {}) {
    if (!current || saving || !categoryId) return;
    const transactionId = getTransactionId(current);
    if (!transactionId) {
      addToast("error", "No pudimos identificar esta transaccion. Cerrá la revision y volvé a abrirla.");
      return;
    }
    setSaving(true);
    try {
      const targets = options.batch ? batchItems : [current];
      const transactionIds = Array.from(new Set(targets.map(getTransactionId).filter(Boolean)));
      if (transactionIds.length === 0) {
        addToast("error", "No pudimos identificar estos movimientos. Cerra la revision y volve a abrirla.");
        return;
      }

      let result = null;
      if (transactionIds.length === 1) {
        result = await api.updateTransaction(transactionIds[0], { category_id: Number(categoryId) });
      } else {
        result = await api.assignCategoryToTransactions(transactionIds, categoryId, { ruleScope: "account" });
      }

      const category = categoryById.get(String(categoryId));
      const categoryName = category?.name || "esta categoria";
      const learnedEntries = targets
        .map((target) => getMerchantBatchKey(target))
        .filter(Boolean);
      if (learnedEntries.length > 0) {
        setSessionLearnedCategories((prev) => {
          const nextMap = new Map(prev);
          learnedEntries.forEach((merchantKey) => {
            nextMap.set(merchantKey, {
              categoryId: Number(categoryId),
              categoryName,
              displayName: merchantKey.replace(/\b\w/g, (letter) => letter.toUpperCase()),
            });
          });
          return nextMap;
        });
      }

      setHistory((prev) => [...prev, {
        type: "apply",
        transactionId: transactionIds[0],
        transactionIds,
        completedIds: transactionIds,
        previousCategoryId: current.category_id ?? null,
        previousDescription: current.desc_usuario ?? null,
        previousItems: targets,
        previousIndex: index,
        learnedEntries,
        createdRuleId: result?.rule?.created ? result?.rule?.rule?.id : null,
        createdCategoryId: options.createdCategoryId || null,
      }]);
      addToast("success", transactionIds.length > 1
        ? `${transactionIds.length} movimientos categorizados juntos.`
        : "Categoria aplicada.");
      advanceAfterCompleting(transactionIds);
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmInternalOperation(kindOverride) {
    if (!current || saving || !current.internal_operation_kind) return;
    const transactionId = getTransactionId(current);
    if (!transactionId) {
      addToast("error", "No pudimos identificar esta transaccion. Cerrá la revision y volvé a abrirla.");
      return;
    }
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
        source_transaction_id: transactionId,
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
    const transactionId = getTransactionId(current);
    if (!transactionId) {
      addToast("error", "No pudimos identificar esta transaccion. Cerrá la revision y volvé a abrirla.");
      return;
    }
    setSaving(true);
    try {
      await api.rejectInternalOperation({ source_transaction_id: transactionId });
      setDismissedInternalIds((prev) => [...prev, transactionId]);
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
    if (selectedCategoryId && String(selectedCategoryId) !== String(current.suggested_category_id || "")) {
      await applyCategory(selectedCategoryId, { batch: batchItems.length > 1 });
      return;
    }
    if (current.suggested_category_id) {
      await applyCategory(current.suggested_category_id, { batch: batchItems.length > 1 });
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
        await applyCategory(created.id, { createdCategoryId: created.id, batch: batchItems.length > 1 });
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
    const transactionId = getTransactionId(current);
    setHistory((prev) => [...prev, { type: "skip", transactionIds: transactionId ? [transactionId] : [], previousIndex: index }]);
    if (transactionId) {
      advanceAfterCompleting([transactionId]);
    } else {
      next();
    }
  }

  async function handleBack() {
    if (index === 0 || history.length === 0 || saving) return;
    const last = history[history.length - 1];
    setSaving(true);
    try {
      if (last.type === "apply") {
        await Promise.all(
          (last.transactionIds || [last.transactionId]).map((transactionId) => {
            const previousItem = (last.previousItems || []).find((item) => getTransactionId(item) === transactionId) || current || {};
            return api.updateTransaction(transactionId, {
              category_id: previousItem.category_id ?? last.previousCategoryId,
              desc_usuario: previousItem.desc_usuario ?? last.previousDescription,
            });
          })
        );
        if (last.createdRuleId) {
          await api.deleteRule(last.createdRuleId);
        }
        if (last.createdCategoryId) {
          await api.deleteCategory(last.createdCategoryId).catch(() => {});
          onCategoryCreated?.();
        }
      }
      if (last.transactionIds?.length) {
        setCompletedIds((prev) => {
          const nextSet = new Set(prev);
          last.transactionIds.forEach((id) => nextSet.delete(id));
          return nextSet;
        });
      }
      if (last.learnedEntries?.length) {
        setSessionLearnedCategories((prev) => {
          const nextMap = new Map(prev);
          last.learnedEntries.forEach((merchantKey) => nextMap.delete(merchantKey));
          return nextMap;
        });
      }
      setHistory((prev) => prev.slice(0, -1));
      setIndex(Math.max(last.previousIndex ?? index - 1, 0));
    } catch (error) {
      addToast("error", error.message);
    } finally {
      setSaving(false);
    }
  }

  const selectedCategoryOverridesSuggestion = Boolean(selectedCategoryId) && String(selectedCategoryId) !== String(current?.suggested_category_id || "");
  const targetCategoryId = selectedCategoryId || current?.suggested_category_id || "";
  const currentBatchKey = getMerchantBatchKey(current);
  const batchItems = useMemo(() => {
    if (!current || isInternalOperationActive || !currentBatchKey || !targetCategoryId) return current ? [current] : [];
    const isManualOverride = Boolean(selectedCategoryId) && String(selectedCategoryId) !== String(current.suggested_category_id || "");
    return reviewItems.filter((item) => {
      const id = getTransactionId(item);
      if (!id) return false;
      if (Boolean(item?.internal_operation_kind)) return false;
      if (getMerchantBatchKey(item) !== currentBatchKey) return false;
      if (isManualOverride) return true;
      return String(item.suggested_category_id || "") === String(targetCategoryId);
    });
  }, [current, currentBatchKey, isInternalOperationActive, reviewItems, selectedCategoryId, targetCategoryId]);
  const batchCount = batchItems.length;
  const batchLabel = currentBatchKey ? currentBatchKey.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "movimientos parecidos";

  if (!current) return null;

  const primaryDescription = getPrimaryDescription(current);
  const rawBankDescription = cleanDescription(current.desc_banco);
  const hasWeakBankDescription = isWeakDescription(rawBankDescription);
  const accountLabel = cleanDescription(current.account_name) || cleanDescription(current.account_id) || "Sin cuenta";

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

          <div className="mt-5 rounded-2xl bg-white/80 px-4 py-4 dark:bg-neutral-900/80">
            <p className="text-[11px] uppercase tracking-[0.16em] text-neutral-400">Movimiento</p>
            <p
              className="mt-2 text-2xl font-semibold leading-tight text-finance-ink dark:text-neutral-100"
              data-testid="review-transaction-description"
              title={primaryDescription}
            >
              {primaryDescription}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-neutral-500 dark:text-neutral-300">
              <span className="rounded-full bg-finance-cream px-3 py-1 dark:bg-neutral-800">
                Cuenta: {accountLabel}
              </span>
              <span className="rounded-full bg-finance-cream px-3 py-1 dark:bg-neutral-800">
                Moneda: {current.moneda || "UYU"}
              </span>
            </div>
            {rawBankDescription && rawBankDescription !== primaryDescription ? (
              <p
                className="mt-3 break-words text-xs text-neutral-500 dark:text-neutral-300"
                data-testid="review-transaction-raw-description"
              >
                Banco: {rawBankDescription}
              </p>
            ) : null}
            {hasWeakBankDescription ? (
              <p className="mt-3 rounded-2xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                El banco no mando una descripcion clara. Escribi un nombre abajo para recordarlo despues.
              </p>
            ) : null}
          </div>

          <p className="mt-4 text-4xl font-semibold tracking-tight text-finance-ink dark:text-neutral-100">
            {fmtMoney(current.monto, current.moneda)}
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
              {batchCount > 1 ? (
                <p className="mt-3 rounded-2xl bg-finance-purpleSoft px-3 py-2 text-xs font-semibold text-finance-purple dark:bg-purple-900/30 dark:text-purple-200">
                  Hay {batchCount} movimientos de {batchLabel}. Podes aprobarlos juntos.
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

          <p className="mt-5 text-xs uppercase tracking-[0.18em] text-neutral-400">Cambiar categoria</p>
          {otherCategory ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => applyCategory(otherCategory.id, { batch: batchCount > 1 })}
                disabled={saving}
                className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-600 transition hover:border-finance-purple hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
              >
                {batchCount > 1 ? `Mandar ${batchCount} a Otros` : "Mandar a Otros"}
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
              onClick={() => applyCategory(selectedCategoryId, { batch: batchCount > 1 })}
              disabled={saving || !selectedCategoryId}
              className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-finance-ink transition hover:border-finance-purple hover:text-finance-purple disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-100"
            >
              {batchCount > 1 ? `Usar en ${batchCount}` : "Usar esta otra"}
            </button>
            {batchCount > 1 ? (
              <button
                type="button"
                onClick={() => applyCategory(selectedCategoryId)}
                disabled={saving || !selectedCategoryId}
                className="rounded-2xl border border-neutral-200 px-4 py-3 text-sm font-semibold text-neutral-500 transition hover:border-neutral-300 hover:text-finance-ink disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300"
              >
                Solo este
              </button>
            ) : null}
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
              : selectedCategoryOverridesSuggestion
                ? (batchCount > 1 ? `Usar categoria en ${batchCount}` : "Usar categoria elegida")
                : (current.suggested_category_id
                  ? (batchCount > 1 ? `Aceptar ${batchCount} de ${batchLabel}` : "Aceptar sugerencia")
                  : (batchCount > 1 ? `Crear y usar en ${batchCount}` : "Crear y usar sugerencia"))}
          </button>
        </div>
      </div>
    </div>
  );
}
