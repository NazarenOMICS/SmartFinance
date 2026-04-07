import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { useToast } from "../contexts/ToastContext";
import ExportButton from "../components/ExportButton";
import MetricCard from "../components/MetricCard";
import MonthComparison from "../components/MonthComparison";
import TransactionTable from "../components/TransactionTable";
import CategoryManager from "../components/CategoryManager";
import CandidateReview from "../components/CandidateReview";
import { SkeletonDashboard } from "../components/SkeletonLoader";
import { fmtMoney, getExchangeRateMap, SUPPORTED_CURRENCY_OPTIONS } from "../utils";
import {
  clearPendingReviewSession,
  writePendingReviewSession,
} from "../utils/pendingReviewSession";

const chartColors = ["#534AB7", "#1D9E75", "#D85A30", "#378ADD", "#BA7517", "#639922", "#E24B4A", "#888780"];

export default function Dashboard({
  month,
  settings,
  refreshSettings,
  onNavigate,
  onPendingChange,
  userId,
  resumePendingReview = null,
  onConsumeResumePendingReview,
  onInvalidResumePendingReview,
  forcedQuickFilter = null,
  onConsumeForcedQuickFilter,
  onOpenPendingReminder,
  onResumePendingAction,
  hasPendingReminder = false,
}) {
  const { addToast } = useToast();
  const [state, setState] = useState({
    loading: true,
    error: "",
    summary: null,
    transactions: [],
    categories: [],
    evolution: [],
    trend: null,
    prevSummary: null,
  });
  const [clickedCategory, setClickedCategory] = useState(null);
  const [dismissedBudgetAlert, setDismissedBudgetAlert] = useState(false);
  const [drilldownFilter, setDrilldownFilter] = useState(null);
  const [showCatManager, setShowCatManager] = useState(false);
  const [categoryCandidates, setCategoryCandidates] = useState(null); // { pattern, category_id, category_name }
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [hoveredCatIndex, setHoveredCatIndex] = useState(null);
  const [includeSavings, setIncludeSavings] = useState(true);
  const [consolidated, setConsolidated] = useState(null);
  const [showUSD, setShowUSD] = useState(false);
  const loadRequestIdRef = useRef(0);
  const transactionsSectionRef = useRef(null);

  async function load(options = {}) {
    const { silent = false } = options;
    const requestId = ++loadRequestIdRef.current;
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true, error: "" }));
    }
    try {
      const [year, monthIndex] = month.split("-").map(Number);
      const prevMonthIndex = monthIndex === 1 ? 12 : monthIndex - 1;
      const prevYear = monthIndex === 1 ? year - 1 : year;
      const prevMonth = `${prevYear}-${String(prevMonthIndex).padStart(2, "0")}`;

      const [summary, transactions, categories, evolution, rawTrend, prevSummary, consolidatedData] = await Promise.all([
        api.getSummary(month),
        api.getTransactions(month),
        api.getCategories(),
        api.getEvolution(month, 6),
        api.getCategoryTrend(month, 4),
        api.getSummary(prevMonth).catch(() => null),
        api.getConsolidatedAccounts().catch(() => null),
      ]);

      const trend = {};
      (rawTrend || []).forEach(({ month: monthKey, byCategory }) => {
        Object.entries(byCategory || {}).forEach(([name, spent]) => {
          if (!trend[name]) trend[name] = [];
          trend[name].push({ month: monthKey, spent });
        });
      });

      if (loadRequestIdRef.current !== requestId) return;

      setState({
        loading: false,
        error: "",
        summary,
        transactions,
        categories,
        evolution,
        trend,
        prevSummary,
      });
      if (consolidatedData) setConsolidated(consolidatedData);
      onPendingChange?.(summary.pending_count || 0);
    } catch (error) {
      if (loadRequestIdRef.current !== requestId) return;
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
    }
  }

  useEffect(() => {
    setShowAllCategories(false);
    load();
  }, [month]);

  useEffect(() => {
    if (state.loading || !resumePendingReview) return;
    if (resumePendingReview.source !== "dashboard") return;

    const categoryId = Number(resumePendingReview.categoryId);
    const category = state.categories.find((item) => item.id === categoryId);

    if (!category) {
      clearPendingReviewSession(userId);
      onInvalidResumePendingReview?.();
      return;
    }

    setCategoryCandidates({
      pattern: resumePendingReview.pattern,
      category_id: categoryId,
      category_name: resumePendingReview.categoryName || category.name,
      rule_id: resumePendingReview.ruleId || null,
    });
    onConsumeResumePendingReview?.();
  }, [state.loading, state.categories, resumePendingReview, userId, onConsumeResumePendingReview, onInvalidResumePendingReview]);

  useEffect(() => {
    if (!forcedQuickFilter || state.loading) return;
    transactionsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [forcedQuickFilter, state.loading]);

  function rememberPendingReview(review) {
    if (!userId) return;
    writePendingReviewSession(userId, {
      source: "dashboard",
      pattern: review.pattern,
      categoryId: review.category_id,
      categoryName: review.category_name,
      ruleId: review.rule_id || null,
      createdAt: new Date().toISOString(),
    });
  }

  function clearRememberedPendingReview() {
    clearPendingReviewSession(userId);
  }

  async function handleCategorize(id, categoryId) {
    try {
      const result = await api.updateTransaction(id, { category_id: Number(categoryId) });
      const cat = state.categories.find((c) => c.id === Number(categoryId));
      const catName = cat?.name;

      // Optimistic local state update — avoids full page reload
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) =>
          tx.id === id
            ? {
                ...tx,
                category_id: Number(categoryId),
                category_name: catName,
                category_type: cat?.type,
                category_color: cat?.color,
                categorization_status: "categorized",
                category_source: "manual",
                category_confidence: null,
                category_rule_id: null,
              }
            : tx
        ),
      }));

      if (result?.rule?.conflict) {
        addToast("warning", `Ya existe una regla "${result.rule.rule?.pattern}" para otra categoría. Se categorizó sin modificar la regla.`);
      } else if (result?.rule?.created && result.rule.candidates_count > 0) {
        // Show candidates for Tinder-style confirmation
        const review = {
          pattern: result.rule.rule?.pattern,
          category_id: Number(categoryId),
          category_name: catName,
          rule_id: result.rule.rule?.id || null,
        };
        setCategoryCandidates(review);
        rememberPendingReview(review);
        addToast("info", `Regla creada: "${result.rule.rule?.pattern}" → ${catName}. Hay ${result.rule.candidates_count} transacciones similares para revisar.`);
      } else if (result?.rule?.created) {
        addToast("success", `Aprendido: las próximas transacciones con "${result.rule.rule?.pattern}" se categorizarán como ${catName || "esta categoría"}.`);
      }

      // Background refresh for summary/charts (non-blocking)
      load({ silent: true });
      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleBulkCategorize(ids, categoryId) {
    try {
      await Promise.all(ids.map((id) => api.updateTransaction(id, { category_id: Number(categoryId) })));
      addToast("success", `${ids.length} transacciones categorizadas.`);
      await load({ silent: true });
      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleDeleteTransaction(id) {
    try {
      const tx = state.transactions.find((item) => item.id === id);
      await api.deleteTransaction(id);
      await load({ silent: true });

      if (tx) {
        addToast("info", `"${(tx.desc_usuario || tx.desc_banco).slice(0, 32)}" eliminada`, {
          label: "Deshacer",
          fn: async () => {
            try {
              await api.createTransaction({
                fecha: tx.fecha,
                desc_banco: tx.desc_banco,
                ...(tx.desc_usuario && { desc_usuario: tx.desc_usuario }),
                monto: tx.monto,
                moneda: tx.moneda,
                ...(tx.category_id && { category_id: tx.category_id }),
                ...(tx.account_id && { account_id: tx.account_id }),
                ...(tx.es_cuota && { es_cuota: tx.es_cuota }),
                ...(tx.installment_id && { installment_id: tx.installment_id }),
              });
              await load({ silent: true });
              addToast("success", "Transacción restaurada.");
            } catch (error) {
              addToast("error", error.message);
            }
          },
        });
      }

      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleUpdateDesc(id, desc) {
    try {
      await api.updateTransaction(id, { desc_usuario: desc });
      await load({ silent: true });
      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleUpdateFull(id, changes) {
    try {
      await api.updateTransaction(id, changes);
      await load({ silent: true });
      return true;
    } catch (error) {
      addToast("error", error.message);
      return false;
    }
  }

  async function handleMarkMovement(id, kind) {
    try {
      const { transaction } = await api.markTransactionMovement(id, kind);
      setState((prev) => ({
        ...prev,
        transactions: prev.transactions.map((tx) =>
          tx.id === id ? { ...tx, movement_kind: transaction.movement_kind, category_id: transaction.category_id, category_name: transaction.category_name, categorization_status: transaction.categorization_status } : tx
        ),
      }));
    } catch (error) {
      addToast("error", error.message);
    }
  }

  async function handleDisplayCurrencyChange(value) {
    try {
      await api.updateSetting("display_currency", value);
      await refreshSettings();
      await load({ silent: true });
    } catch (error) {
      addToast("error", error.message);
    }
  }

  if (state.loading) return <SkeletonDashboard />;
  if (state.error) {
    return <div className="rounded-[28px] bg-finance-redSoft p-6 text-finance-red shadow-panel dark:bg-red-900/30">{state.error}</div>;
  }

  const { summary } = state;
  const money = (value) => fmtMoney(value, summary.currency);
  const tc = Number(settings.exchange_rate_usd_uyu) || 42.5;
  const cvt = (v) => showUSD ? v / tc : v;
  const fmt = (v) => showUSD ? fmtMoney(v / tc, "USD") : money(v);
  const evolutionData = showUSD
    ? state.evolution.map((d) => ({ ...d, ingresos: d.ingresos / tc, gastos: d.gastos / tc }))
    : state.evolution;
  const top5 = (summary.byCategory || []).slice(0, 5);
  const donutData = [...top5].reverse(); // smallest→largest arc order
  const hiddenCategories = Math.max(0, (summary.byCategory?.length || 0) - 5);
  // List also smallest→largest to match donut visual order
  const displayedCategories = showAllCategories
    ? [...(summary.byCategory || [])].reverse()
    : [...top5].reverse();
  const displayCurrency = settings.display_currency || "UYU";
  const exchangeRateValue = Number(getExchangeRateMap(settings)[displayCurrency] || 1);
  const exchangeRateDecimals = exchangeRateValue < 1 ? 3 : 1;

  if (state.transactions.length === 0) {
    const steps = [
      { icon: "↑", title: "Subí tus movimientos", desc: "PDF, CSV o TXT de tu banco", action: () => onNavigate?.("upload"), label: "Subir archivo" },
      { icon: "◎", title: "Configurá tus cuentas", desc: "Banco, tarjeta, efectivo", action: () => onNavigate?.("accounts"), label: "Ver cuentas" },
      { icon: "⚙", title: "Organizá categorías", desc: "Presupuestos y reglas automáticas", action: () => setShowCatManager(true), label: "Gestionar" },
    ];
    return (
      <>
        <div className="flex flex-col items-center rounded-[32px] border border-dashed border-finance-purple/30 bg-white/80 px-6 py-14 text-center shadow-panel dark:border-finance-purple/20 dark:bg-neutral-900/80">
          <h2 className="font-display text-3xl text-finance-ink dark:text-neutral-100">Sin transacciones este mes</h2>
          <p className="mt-2 max-w-md text-sm text-neutral-500">Empezá subiendo un extracto bancario. SmartFinance aprende de tus movimientos y categoriza automáticamente.</p>

          <div className="mt-10 grid w-full max-w-lg gap-4 md:grid-cols-3">
            {steps.map((step, i) => (
              <button
                key={i}
                onClick={step.action}
                className="group flex flex-col items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-5 transition hover:border-finance-purple hover:shadow-lg active:scale-[0.97] dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-purple-400"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-finance-purpleSoft text-lg text-finance-purple transition group-hover:bg-finance-purple group-hover:text-white dark:bg-purple-900/30 dark:text-purple-300">{step.icon}</span>
                <div>
                  <p className="font-semibold text-finance-ink dark:text-neutral-100">{step.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">{step.desc}</p>
                </div>
                <span className="mt-auto text-xs font-semibold text-finance-purple dark:text-purple-300">{step.label} →</span>
              </button>
            ))}
          </div>
        </div>
        <CategoryManager open={showCatManager} onClose={() => setShowCatManager(false)} onDataChanged={load} month={month} />
      </>
    );
  }

  function toggleCategory(name) {
    setClickedCategory((prev) => (prev === name ? null : name));
  }

  const overBudget = summary.budgets.filter((item) => item.budget > 0 && item.spent > item.budget);

  return (
    <div className="space-y-6">
      {overBudget.length > 0 && !dismissedBudgetAlert && (
        <div className="flex items-start justify-between gap-3 rounded-2xl bg-finance-redSoft px-5 py-4 dark:bg-red-900/25">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-xl">!</span>
            <div>
              <p className="font-semibold text-finance-red dark:text-red-300">
                {overBudget.length === 1
                  ? `"${overBudget[0].name}" superó el presupuesto mensual`
                  : `${overBudget.length} categorías superaron su presupuesto mensual`}
              </p>
              <p className="mt-1 text-sm text-finance-red/80 dark:text-red-400">
                {overBudget.map((item) => `${item.name} (${fmt(item.spent)} / ${fmt(item.budget)})`).join(" | ")}
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissedBudgetAlert(true)}
            className="shrink-0 text-finance-red/60 transition hover:text-finance-red dark:text-red-400"
          >
            x
          </button>
        </div>
      )}

      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowUSD((v) => !v)}
          className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            showUSD
              ? "border-finance-blue bg-finance-blue text-white"
              : "border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${showUSD ? "bg-white" : "bg-neutral-300 dark:bg-neutral-600"}`} />
          Ver en USD {showUSD ? `(TC ${tc})` : ""}
        </button>
      </div>

      {(() => {
        const savingsTarget = summary.totals.savings_monthly_target || 0;
        const netResult = summary.totals.margin - (includeSavings && savingsTarget > 0 ? savingsTarget : 0);
        const isPositive = netResult >= 0;
        const resultTone = isPositive ? "text-finance-teal" : "text-finance-red";
        const label = includeSavings && savingsTarget > 0 ? "Resultado tras ahorro" : "Margen del mes";
        return (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/85">
              <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">Saldo total</p>
              <p className="mt-3 font-display text-3xl text-finance-ink dark:text-neutral-100">
                {consolidated ? fmtMoney(consolidated.total, consolidated.currency) : "—"}
              </p>
              <p className="mt-1 text-xs text-neutral-400">En todas tus cuentas</p>
            </div>
            <div className="rounded-[28px] border border-white/70 bg-white/85 p-5 shadow-panel dark:border-white/10 dark:bg-neutral-900/85">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">{label}</p>
                {savingsTarget > 0 && (
                  <button
                    type="button"
                    onClick={() => setIncludeSavings((prev) => !prev)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                      includeSavings
                        ? "bg-finance-purple/10 text-finance-purple dark:bg-purple-900/30 dark:text-purple-300"
                        : "bg-neutral-100 text-neutral-400 dark:bg-neutral-800"
                    }`}
                    title={includeSavings ? "Descontar ahorro mensual del margen" : "Ver margen sin descontar ahorro"}
                  >
                    {includeSavings ? `− ${fmt(savingsTarget)} ahorro` : "Sin ahorro"}
                  </button>
                )}
              </div>
              <p className={`mt-3 font-display text-3xl ${resultTone}`}>{fmt(netResult)}</p>
              {includeSavings && savingsTarget > 0 && (
                <p className={`mt-2 text-xs font-semibold ${isPositive ? "text-finance-teal" : "text-finance-red"}`}>
                  {isPositive
                    ? `Ahorrando ${fmt(summary.totals.margin)} − ${fmt(savingsTarget)} objetivo`
                    : `${fmt(Math.abs(netResult))} por debajo del objetivo de ahorro`}
                </p>
              )}
            </div>
            <MetricCard
              label="Ingresos del mes"
              value={fmt(summary.totals.income)}
              delta={summary.deltas.income}
              tone="text-finance-teal"
              positiveIsGood
              onClick={() => setDrilldownFilter((prev) => (prev === "income" ? null : "income"))}
            />
            <MetricCard
              label="Gastos del mes"
              value={fmt(summary.totals.expenses)}
              delta={summary.deltas.expenses}
              tone="text-finance-red"
              onClick={() => setDrilldownFilter((prev) => (prev === "expenses" ? null : "expenses"))}
            />
          </div>
        );
      })()}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Distribucion mensual</p>
              <h2 className="font-display text-3xl text-finance-ink">Gastos por categoria</h2>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                className="rounded-full border border-neutral-200 bg-finance-cream px-4 py-2 text-sm text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                value={settings.display_currency || "UYU"}
                onChange={(e) => handleDisplayCurrencyChange(e.target.value)}
              >
                {SUPPORTED_CURRENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value}
                  </option>
                ))}
              </select>
              {displayCurrency !== "UYU" && (
                <span className="rounded-full bg-finance-cream px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" title="Tipo de cambio actualizado automáticamente">
                  1 {displayCurrency} = {exchangeRateValue.toFixed(exchangeRateDecimals)} UYU
                </span>
              )}
              <ExportButton month={month} />
            </div>
          </div>
          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="spent"
                    nameKey="name"
                    innerRadius={72}
                    outerRadius={106}
                    paddingAngle={2}
                    onClick={(entry) => toggleCategory(entry.name)}
                  >
                    {donutData.map((entry, index) => (
                      <Cell
                        key={entry.id}
                        fill={entry.color || chartColors[index % chartColors.length]}
                        opacity={
                          (hoveredCatIndex !== null && hoveredCatIndex !== index) ||
                          (clickedCategory && clickedCategory !== entry.name)
                            ? 0.3
                            : 1
                        }
                        style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                        onMouseEnter={() => setHoveredCatIndex(index)}
                        onMouseLeave={() => setHoveredCatIndex(null)}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => fmt(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => setShowCatManager(true)}
                className="flex w-full items-center justify-between rounded-2xl bg-finance-purpleSoft px-4 py-2.5 text-sm font-semibold text-finance-purple transition hover:bg-finance-purple hover:text-white dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-700 dark:hover:text-white"
              >
                <span>Gestionar categorías y presupuestos</span>
                <span className="text-xs">⚙</span>
              </button>
              {clickedCategory && (
                <button
                  onClick={() => setClickedCategory(null)}
                  className="flex w-full items-center justify-between rounded-2xl bg-finance-amberSoft px-3 py-2 text-xs font-semibold text-finance-amber transition hover:bg-finance-amber hover:text-white dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-700 dark:hover:text-white"
                >
                  <span>Filtrando: {clickedCategory}</span>
                  <span>x limpiar</span>
                </button>
              )}
              {displayedCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => toggleCategory(category.name)}
                  className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition ${
                    clickedCategory === category.name
                      ? "ring-1 ring-finance-purple/40 bg-finance-purple/10 dark:bg-purple-900/30"
                      : clickedCategory
                        ? "opacity-40 bg-finance-cream/50 dark:bg-neutral-800/50"
                        : "bg-finance-cream/70 hover:bg-finance-cream dark:bg-neutral-800/70 dark:hover:bg-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: category.color || "#888780" }} />
                    <div>
                      <p className="font-semibold text-finance-ink">{category.name}</p>
                      <p className="text-xs uppercase tracking-[0.16em] text-neutral-400">{category.type}</p>
                    </div>
                  </div>
                  <p className="font-semibold text-finance-ink">{fmt(category.spent)}</p>
                </button>
              ))}
              {hiddenCategories > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowAllCategories((prev) => {
                      const next = !prev;
                      // If collapsing and clicked category is not in top 5, clear it
                      if (!next && clickedCategory) {
                        const inTop5 = top5.some((c) => c.name === clickedCategory);
                        if (!inTop5) setClickedCategory(null);
                      }
                      return next;
                    });
                  }}
                  className="w-full rounded-2xl border border-dashed border-finance-purple/30 px-4 py-3 text-sm font-semibold text-finance-purple"
                >
                  {showAllCategories ? "Mostrar solo top 5" : `Ver ${hiddenCategories} categorias mas`}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel dark:border-white/10 dark:bg-neutral-900/90">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Evolución</p>
              <h2 className="font-display text-3xl text-finance-ink">Ultimos 6 meses</h2>
            </div>
            {summary.pending_count > 0 && (
              <span className="rounded-full bg-finance-amberSoft px-4 py-2 text-sm font-semibold text-finance-amber dark:bg-amber-900/30 dark:text-amber-300">
                {summary.pending_count} pendientes
              </span>
            )}
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evolutionData}>
                <XAxis dataKey="month" tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#737373", fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value) => money(value)} />
                <Bar dataKey="ingresos" fill="#1D9E75" radius={[10, 10, 0, 0]} name="Ingresos" />
                <Bar dataKey="gastos" fill="#534AB7" radius={[10, 10, 0, 0]} name="Gastos" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard label="Gastos fijos" value={fmt(summary.byType.fijo)} tone="text-finance-coral" />
        <MetricCard label="Gastos variables" value={fmt(summary.byType.variable)} tone="text-finance-blue" />
        <MetricCard label="Cuotas del mes" value={fmt(summary.totals.installments)} tone="text-finance-amber" onClick={() => onNavigate?.("installments")} />
      </div>
      <MonthComparison
        current={summary.byCategory}
        previous={state.prevSummary?.byCategory || []}
        currency={summary.currency}
      />

      {drilldownFilter && (
        <div className="flex items-center justify-between rounded-2xl bg-finance-purpleSoft px-5 py-3 dark:bg-purple-900/30">
          <p className="text-sm font-semibold text-finance-purple dark:text-purple-300">
            {drilldownFilter === "income" ? "Mostrando solo ingresos del mes" : "Mostrando solo gastos del mes"}
          </p>
          <button
            onClick={() => setDrilldownFilter(null)}
            className="text-finance-purple/60 transition hover:text-finance-purple dark:text-purple-400"
          >
            x limpiar
          </button>
        </div>
      )}

      <div ref={transactionsSectionRef} className="space-y-3">
        {hasPendingReminder && (
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-finance-purpleSoft/70 px-5 py-3 dark:bg-purple-900/20">
            <div>
              <p className="text-sm font-semibold text-finance-purple dark:text-purple-300">
                Segui categorizando lo que quedo pendiente
              </p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-300">
                Si cerraste el popup o dejaste cosas sin categoria, lo podes retomar desde aca.
              </p>
            </div>
            <button
              type="button"
              onClick={onResumePendingAction || onOpenPendingReminder}
              className="shrink-0 rounded-full bg-finance-purple px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              Revisar pendientes
            </button>
          </div>
        )}

        <TransactionTable
          key={month}
          transactions={
            drilldownFilter === "income"
              ? state.transactions.filter((item) => item.monto > 0 && item.category_type !== "transferencia" && item.movement_kind !== "internal_transfer" && item.movement_kind !== "fx_exchange")
              : drilldownFilter === "expenses"
                ? state.transactions.filter((item) => item.monto < 0 && item.category_type !== "transferencia" && item.movement_kind !== "internal_transfer" && item.movement_kind !== "fx_exchange")
                : state.transactions
          }
          categories={state.categories}
          onCategorize={handleCategorize}
          onBulkCategorize={handleBulkCategorize}
          onDelete={handleDeleteTransaction}
          onUpdateDesc={handleUpdateDesc}
          onUpdateFull={handleUpdateFull}
          onMarkMovement={handleMarkMovement}
          externalCatFilter={clickedCategory}
          onClearExternalFilter={() => setClickedCategory(null)}
          onCategoryCreated={() => load({ silent: true })}
          forcedQuickFilter={forcedQuickFilter}
          onConsumeForcedQuickFilter={onConsumeForcedQuickFilter}
        />
      </div>

      <CategoryManager
        open={showCatManager}
        onClose={() => setShowCatManager(false)}
        onDataChanged={() => load({ silent: true })}
        month={month}
      />

      {categoryCandidates && (
        <CandidateReview
          pattern={categoryCandidates.pattern}
          categoryId={categoryCandidates.category_id}
          categoryName={categoryCandidates.category_name}
          ruleId={categoryCandidates.rule_id}
          onDone={() => {
            setCategoryCandidates(null);
            clearRememberedPendingReview();
            onConsumeResumePendingReview?.();
            load({ silent: true });
          }}
          onClose={() => {
            setCategoryCandidates(null);
          }}
        />
      )}
    </div>
  );
}
