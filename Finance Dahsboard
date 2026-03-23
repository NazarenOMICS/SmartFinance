import { useState, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart
} from "recharts";

// ─── COLORS ───
const C = {
  purple: "#534AB7", teal: "#1D9E75", coral: "#D85A30", blue: "#378ADD",
  gray: "#888780", red: "#E24B4A", amber: "#BA7517", green: "#639922",
  purpleL: "#EEEDFE", tealL: "#E1F5EE", coralL: "#FAECE7", blueL: "#E6F1FB",
  grayL: "#F1EFE8", amberL: "#FAEEDA", greenL: "#EAF3DE", redL: "#FCEBEB",
};

const CAT_COLORS = {
  Supermercado: { color: C.purple, bg: C.purpleL, text: "#534AB7" },
  Transporte: { color: C.teal, bg: C.tealL, text: "#0F6E56" },
  Suscripciones: { color: C.coral, bg: C.coralL, text: "#993C1D" },
  Restaurantes: { color: C.blue, bg: C.blueL, text: "#185FA5" },
  Servicios: { color: C.amber, bg: C.amberL, text: "#854F0B" },
  Alquiler: { color: C.green, bg: C.greenL, text: "#3B6D11" },
  Salud: { color: C.red, bg: C.redL, text: "#A32D2D" },
  Otros: { color: C.gray, bg: C.grayL, text: "#5F5E5A" },
  Ingreso: { color: "#639922", bg: "#EAF3DE", text: "#3B6D11" },
};

// ─── INITIAL DATA ───
const INIT_ACCOUNTS = [
  { id: "brou_uyu", name: "BROU Caja de Ahorro", currency: "UYU", balance: 48320 },
  { id: "visa_gold", name: "Visa Gold BROU", currency: "UYU", balance: -12500 },
  { id: "brou_usd", name: "BROU USD", currency: "USD", balance: 1240 },
  { id: "itau_uyu", name: "Itau Cuenta Corriente", currency: "UYU", balance: 22100 },
];

const INIT_CATEGORIES = [
  { name: "Alquiler", budget: 18000, type: "fijo" },
  { name: "Supermercado", budget: 12000, type: "variable" },
  { name: "Transporte", budget: 6000, type: "variable" },
  { name: "Suscripciones", budget: 5000, type: "fijo" },
  { name: "Restaurantes", budget: 8000, type: "variable" },
  { name: "Servicios", budget: 7000, type: "fijo" },
  { name: "Salud", budget: 4000, type: "variable" },
  { name: "Otros", budget: 5000, type: "variable" },
];

const INIT_INSTALLMENTS = [
  { id: 1, desc: "Heladera Samsung", total: 45000, cuotas: 12, cuotaActual: 4, montoCuota: 3750, account: "visa_gold", startMonth: "2025-12" },
  { id: 2, desc: "Notebook Lenovo", total: 28000, cuotas: 6, cuotaActual: 2, montoCuota: 4667, account: "visa_gold", startMonth: "2026-02" },
  { id: 3, desc: "Aire acondicionado", total: 32000, cuotas: 10, cuotaActual: 7, montoCuota: 3200, account: "itau_uyu", startMonth: "2025-09" },
];

function makeTx(id, fecha, desc, monto, moneda, cat, account, esCuota = false) {
  return { id, fecha, desc, monto, moneda, cat, account, esCuota };
}

const INIT_TX = [
  makeTx(1, "2026-03-01", "ALQUILER DEPTO MAR", -18000, "UYU", "Alquiler", "brou_uyu"),
  makeTx(2, "2026-03-02", "ANTEL *DEB AUTOMATICO", -2890, "UYU", "Servicios", "brou_uyu"),
  makeTx(3, "2026-03-03", "SPOTIFY PREMIUM", -490, "UYU", "Suscripciones", "visa_gold"),
  makeTx(4, "2026-03-03", "NETFLIX.COM", -850, "UYU", "Suscripciones", "visa_gold"),
  makeTx(5, "2026-03-04", "TATA *POS 2281", -3420, "UYU", "Supermercado", "visa_gold"),
  makeTx(6, "2026-03-05", "TRANSFERENCIA RECIBIDA", 65000, "UYU", "Ingreso", "brou_uyu"),
  makeTx(7, "2026-03-06", "UBER *TRIP 8821", -320, "UYU", "Transporte", "brou_uyu"),
  makeTx(8, "2026-03-07", "PEDIDOSYA *7732", -890, "UYU", "Restaurantes", "visa_gold"),
  makeTx(9, "2026-03-08", "FARMASHOP *POS", -1250, "UYU", "Salud", "visa_gold"),
  makeTx(10, "2026-03-10", "TATA *POS 2281", -2890, "UYU", "Supermercado", "visa_gold"),
  makeTx(11, "2026-03-11", "UTE *DEB AUTOMATICO", -3200, "UYU", "Servicios", "brou_uyu"),
  makeTx(12, "2026-03-12", "PEDIDOSYA *1192", -750, "UYU", "Restaurantes", "visa_gold"),
  makeTx(13, "2026-03-13", "STM RECARGA", -600, "UYU", "Transporte", "brou_uyu"),
  makeTx(14, "2026-03-14", "CUOTA HELADERA 4/12", -3750, "UYU", "Otros", "visa_gold", true),
  makeTx(15, "2026-03-14", "CUOTA NOTEBOOK 2/6", -4667, "UYU", "Otros", "visa_gold", true),
  makeTx(16, "2026-03-15", "CUOTA AIRE 7/10", -3200, "UYU", "Otros", "itau_uyu", true),
  makeTx(17, "2026-03-16", "DEVOTO *POS 1102", -4100, "UYU", "Supermercado", "brou_uyu"),
  makeTx(18, "2026-03-18", "POS COMPRA *4821", -2340, "UYU", null, "visa_gold"),
  makeTx(19, "2026-03-19", "TRANSFERENCIA RECIBIDA", 45000, "UYU", "Ingreso", "itau_uyu"),
  makeTx(20, "2026-03-20", "DEBITO AUTOMATICO SER", -1890, "UYU", null, "brou_uyu"),
  makeTx(21, "2026-03-21", "PEDIDOSYA *7732", -890, "UYU", "Restaurantes", "visa_gold"),
  makeTx(22, "2026-03-22", "UBER *TRIP 9031", -450, "UYU", "Transporte", "brou_uyu"),
  // February data for comparison
  makeTx(100, "2026-02-01", "ALQUILER DEPTO FEB", -18000, "UYU", "Alquiler", "brou_uyu"),
  makeTx(101, "2026-02-03", "ANTEL *DEB", -2890, "UYU", "Servicios", "brou_uyu"),
  makeTx(102, "2026-02-04", "TATA *POS", -5200, "UYU", "Supermercado", "visa_gold"),
  makeTx(103, "2026-02-05", "SUELDO", 62000, "UYU", "Ingreso", "brou_uyu"),
  makeTx(104, "2026-02-07", "UBER", -280, "UYU", "Transporte", "brou_uyu"),
  makeTx(105, "2026-02-08", "PEDIDOSYA", -670, "UYU", "Restaurantes", "visa_gold"),
  makeTx(106, "2026-02-10", "SPOTIFY", -490, "UYU", "Suscripciones", "visa_gold"),
  makeTx(107, "2026-02-12", "NETFLIX", -850, "UYU", "Suscripciones", "visa_gold"),
  makeTx(108, "2026-02-14", "UTE *DEB", -2950, "UYU", "Servicios", "brou_uyu"),
  makeTx(109, "2026-02-15", "DEVOTO *POS", -3800, "UYU", "Supermercado", "brou_uyu"),
  makeTx(110, "2026-02-18", "FARMASHOP", -980, "UYU", "Salud", "visa_gold"),
  makeTx(111, "2026-02-20", "PEDIDOSYA", -520, "UYU", "Restaurantes", "visa_gold"),
  makeTx(112, "2026-02-22", "STM RECARGA", -600, "UYU", "Transporte", "brou_uyu"),
  makeTx(113, "2026-02-25", "TRANSFERENCIA", 40000, "UYU", "Ingreso", "itau_uyu"),
];

const INIT_RULES = [
  { pattern: "PEDIDOSYA", cat: "Restaurantes", matches: 8 },
  { pattern: "UBER *TRIP", cat: "Transporte", matches: 14 },
  { pattern: "SPOTIFY", cat: "Suscripciones", matches: 3 },
  { pattern: "NETFLIX", cat: "Suscripciones", matches: 3 },
  { pattern: "TATA *POS", cat: "Supermercado", matches: 6 },
  { pattern: "DEVOTO *POS", cat: "Supermercado", matches: 4 },
  { pattern: "ANTEL *DEB", cat: "Servicios", matches: 5 },
  { pattern: "UTE *DEB", cat: "Servicios", matches: 5 },
  { pattern: "STM RECARGA", cat: "Transporte", matches: 3 },
  { pattern: "FARMASHOP", cat: "Salud", matches: 2 },
];

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// ─── HELPERS ───
function fmtMoney(v, currency = "UYU") {
  const prefix = currency === "USD" ? "US$" : "$";
  const abs = Math.abs(Math.round(v));
  const formatted = abs.toLocaleString("es-UY");
  return (v < 0 ? "-" : "") + prefix + formatted;
}

function fmtPct(v) {
  if (!isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return sign + Math.round(v) + "%";
}

function monthKey(y, m) {
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function Badge({ cat }) {
  const c = CAT_COLORS[cat] || CAT_COLORS.Otros;
  return (
    <span className="text-xs px-2.5 py-0.5 rounded-md font-medium inline-block" style={{ background: c.bg, color: c.text }}>
      {cat}
    </span>
  );
}

function MetricCard({ label, value, color, delta }) {
  return (
    <div className="bg-neutral-50 rounded-lg p-3.5 min-w-0">
      <p className="text-xs text-neutral-500 mb-1 truncate">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-xl font-semibold tracking-tight" style={{ color: color || "#18181b" }}>{value}</p>
        {delta !== undefined && delta !== null && (
          <span className={`text-xs font-medium ${delta >= 0 ? "text-red-500" : "text-green-600"}`}>
            {fmtPct(delta)}
          </span>
        )}
      </div>
    </div>
  );
}

function BudgetBar({ spent, budget, label, color }) {
  const pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const warn = pct >= 80 && pct < 100;
  const over = pct >= 100;
  const barColor = over ? C.red : warn ? C.amber : color;
  return (
    <div className="mb-2.5">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-medium text-neutral-700">{label}</span>
        <span className="text-xs text-neutral-500">
          {fmtMoney(spent)} / {fmtMoney(budget)}
          {over && <span className="text-red-500 ml-1 font-medium">({fmtPct(((spent - budget) / budget) * 100)} excedido)</span>}
          {warn && !over && <span className="text-amber-600 ml-1">({pct}%)</span>}
        </span>
      </div>
      <div className="w-full h-2 bg-neutral-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

function PeriodSelector({ year, month, onChange }) {
  const prev = () => {
    if (month === 0) onChange(year - 1, 11);
    else onChange(year, month - 1);
  };
  const next = () => {
    if (month === 11) onChange(year + 1, 0);
    else onChange(year, month + 1);
  };
  return (
    <div className="flex items-center gap-2">
      <button onClick={prev} className="w-7 h-7 flex items-center justify-center rounded-md border border-neutral-300 text-neutral-500 hover:bg-neutral-50 text-sm">&lt;</button>
      <span className="text-sm font-medium text-neutral-800 min-w-[100px] text-center">{MONTHS[month]} {year}</span>
      <button onClick={next} className="w-7 h-7 flex items-center justify-center rounded-md border border-neutral-300 text-neutral-500 hover:bg-neutral-50 text-sm">&gt;</button>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-neutral-200 rounded-lg px-3 py-2 shadow-sm text-xs">
      <p className="text-neutral-500 mb-1">{label}</p>
      {payload.filter(p => p.value != null).map((p, i) => (
        <p key={i} style={{ color: p.color || p.stroke }}>{p.name}: {fmtMoney(p.value)}</p>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───
export default function FinanceDashboard() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selYear, setSelYear] = useState(2026);
  const [selMonth, setSelMonth] = useState(2); // March = 2

  const [accounts, setAccounts] = useState(INIT_ACCOUNTS);
  const [categories, setCategories] = useState(INIT_CATEGORIES);
  const [transactions, setTransactions] = useState(INIT_TX);
  const [installments, setInstallments] = useState(INIT_INSTALLMENTS);
  const [rules] = useState(INIT_RULES);

  const [exchangeRate, setExchangeRate] = useState(42.5);
  const [displayCurrency, setDisplayCurrency] = useState("UYU");

  const [savingsGoal, setSavingsGoal] = useState(200000);
  const [savingsInitial, setSavingsInitial] = useState(50000);

  // New installment form
  const [newInst, setNewInst] = useState({ desc: "", total: "", cuotas: "", account: "visa_gold" });

  // ─── DERIVED DATA ───
  const currentMK = monthKey(selYear, selMonth);
  const prevMK = selMonth === 0 ? monthKey(selYear - 1, 11) : monthKey(selYear, selMonth - 1);

  const txForMonth = useMemo(() =>
    transactions.filter(t => t.fecha.startsWith(currentMK)),
    [transactions, currentMK]
  );
  const txForPrevMonth = useMemo(() =>
    transactions.filter(t => t.fecha.startsWith(prevMK)),
    [transactions, prevMK]
  );

  const toDisplay = (amount, fromCurrency) => {
    if (displayCurrency === fromCurrency) return amount;
    if (displayCurrency === "UYU" && fromCurrency === "USD") return amount * exchangeRate;
    if (displayCurrency === "USD" && fromCurrency === "UYU") return amount / exchangeRate;
    return amount;
  };

  // Spending by category for current month
  const spendingByCat = useMemo(() => {
    const map = {};
    txForMonth.filter(t => t.cat && t.cat !== "Ingreso" && t.monto < 0).forEach(t => {
      map[t.cat] = (map[t.cat] || 0) + Math.abs(t.monto);
    });
    return map;
  }, [txForMonth]);

  const prevSpendingByCat = useMemo(() => {
    const map = {};
    txForPrevMonth.filter(t => t.cat && t.cat !== "Ingreso" && t.monto < 0).forEach(t => {
      map[t.cat] = (map[t.cat] || 0) + Math.abs(t.monto);
    });
    return map;
  }, [txForPrevMonth]);

  const totalIncome = txForMonth.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const totalExpenses = txForMonth.filter(t => t.monto < 0).reduce((s, t) => s + Math.abs(t.monto), 0);
  const prevTotalExpenses = txForPrevMonth.filter(t => t.monto < 0).reduce((s, t) => s + Math.abs(t.monto), 0);
  const prevTotalIncome = txForPrevMonth.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);

  const totalFijos = categories.filter(c => c.type === "fijo").reduce((s, c) => s + (spendingByCat[c.name] || 0), 0);
  const totalVariables = categories.filter(c => c.type === "variable").reduce((s, c) => s + (spendingByCat[c.name] || 0), 0);
  const margen = totalIncome - totalFijos - totalVariables;

  // Consolidated balance
  const consolidatedUYU = accounts.filter(a => a.currency === "UYU").reduce((s, a) => s + a.balance, 0);
  const consolidatedUSD = accounts.filter(a => a.currency === "USD").reduce((s, a) => s + a.balance, 0);
  const patrimonioTotal = consolidatedUYU + consolidatedUSD * exchangeRate;

  // Installment commitments
  const futureCommitments = useMemo(() => {
    const months = [];
    for (let i = 0; i < 6; i++) {
      const m = (selMonth + 1 + i) % 12;
      const y = selYear + Math.floor((selMonth + 1 + i) / 12);
      let total = 0;
      installments.forEach(inst => {
        const remaining = inst.cuotas - inst.cuotaActual;
        if (i < remaining) total += inst.montoCuota;
      });
      months.push({ month: MONTHS[m], total });
    }
    return months;
  }, [installments, selMonth, selYear]);

  const currentMonthInstallmentTotal = installments.reduce((s, i) => s + (i.cuotaActual <= i.cuotas ? i.montoCuota : 0), 0);

  // Donut data
  const donutData = useMemo(() =>
    categories.filter(c => spendingByCat[c.name] > 0).map(c => ({
      name: c.name, value: spendingByCat[c.name] || 0
    })),
    [categories, spendingByCat]
  );

  // Monthly evolution (6 months back)
  const monthlyEvo = useMemo(() => {
    const data = [];
    for (let i = 5; i >= 0; i--) {
      const m = (selMonth - i + 12) % 12;
      const y = selYear - (selMonth - i < 0 ? 1 : 0);
      const mk = monthKey(y, m);
      const mtx = transactions.filter(t => t.fecha.startsWith(mk));
      data.push({
        month: MONTHS[m],
        ingresos: mtx.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0),
        gastos: mtx.filter(t => t.monto < 0).reduce((s, t) => s + Math.abs(t.monto), 0),
      });
    }
    return data;
  }, [transactions, selMonth, selYear]);

  // Pending count
  const pendingCount = txForMonth.filter(t => !t.cat).length;

  // Savings projection
  const avgMonthlySavings = useMemo(() => {
    let total = 0; let count = 0;
    for (let i = 0; i < 6; i++) {
      const m = (selMonth - i + 12) % 12;
      const y = selYear - (selMonth - i < 0 ? 1 : 0);
      const mk = monthKey(y, m);
      const mtx = transactions.filter(t => t.fecha.startsWith(mk));
      const inc = mtx.filter(t => t.monto > 0).reduce((s, t) => s + t.monto, 0);
      const exp = mtx.filter(t => t.monto < 0).reduce((s, t) => s + Math.abs(t.monto), 0);
      if (inc > 0 || exp > 0) { total += inc - exp; count++; }
    }
    return count > 0 ? Math.round(total / count) : 0;
  }, [transactions, selMonth, selYear]);

  const savingsChartData = useMemo(() => {
    const data = [];
    let accumulated = savingsInitial;
    for (let i = -5; i <= 6; i++) {
      const m = (selMonth + i + 12) % 12;
      const y = selYear + Math.floor((selMonth + i) / 12);
      const mk = monthKey(y, m);
      if (i <= 0) {
        const mtx = transactions.filter(t => t.fecha.startsWith(mk));
        const delta = mtx.reduce((s, t) => s + t.monto, 0);
        accumulated += delta;
        data.push({ month: MONTHS[m], real: Math.max(0, accumulated), proyeccion: i === 0 ? Math.max(0, accumulated) : null, objetivo: savingsGoal });
      } else {
        const projectedMonthly = avgMonthlySavings - (futureCommitments[i - 1]?.total || 0);
        accumulated += projectedMonthly;
        data.push({ month: MONTHS[m], real: null, proyeccion: Math.max(0, accumulated), objetivo: savingsGoal });
      }
    }
    return data;
  }, [savingsInitial, savingsGoal, transactions, selMonth, selYear, avgMonthlySavings, futureCommitments]);

  // Insights
  const insights = useMemo(() => {
    const result = [];
    // Most grown category vs prev month
    let maxGrowth = { cat: null, pct: -Infinity };
    categories.forEach(c => {
      const curr = spendingByCat[c.name] || 0;
      const prev = prevSpendingByCat[c.name] || 0;
      if (prev > 0) {
        const pct = ((curr - prev) / prev) * 100;
        if (pct > maxGrowth.pct) maxGrowth = { cat: c.name, pct, curr, prev };
      }
    });
    if (maxGrowth.cat) {
      result.push(maxGrowth.pct > 0
        ? `${maxGrowth.cat} creció ${Math.round(maxGrowth.pct)}% vs. mes anterior (${fmtMoney(maxGrowth.prev)} → ${fmtMoney(maxGrowth.curr)}).`
        : `${maxGrowth.cat} bajó ${Math.abs(Math.round(maxGrowth.pct))}% vs. mes anterior.`
      );
    }

    // Daily avg spend
    const dayOfMonth = Math.min(new Date().getDate(), daysInMonth(selYear, selMonth));
    const dailyAvg = dayOfMonth > 0 ? Math.round(totalExpenses / dayOfMonth) : 0;
    result.push(`Gasto promedio diario: ${fmtMoney(dailyAvg)}.`);

    // Days remaining vs budget
    const totalBudget = categories.reduce((s, c) => s + c.budget, 0);
    const daysLeft = daysInMonth(selYear, selMonth) - dayOfMonth;
    const remainingBudget = totalBudget - totalExpenses;
    if (remainingBudget > 0 && daysLeft > 0) {
      result.push(`Quedan ${daysLeft} días y ${fmtMoney(remainingBudget)} de presupuesto (${fmtMoney(Math.round(remainingBudget / daysLeft))}/día disponible).`);
    } else if (remainingBudget <= 0) {
      result.push(`Presupuesto mensual excedido por ${fmtMoney(Math.abs(remainingBudget))} con ${daysLeft} días restantes.`);
    }

    // Savings goal ETA
    if (avgMonthlySavings > 0) {
      const avgNetOfDebt = avgMonthlySavings - currentMonthInstallmentTotal;
      const currentAccum = savingsChartData.find(d => d.real !== null && d.proyeccion !== null);
      const remaining = savingsGoal - (currentAccum?.real || savingsInitial);
      if (avgNetOfDebt > 0 && remaining > 0) {
        const monthsToGoal = Math.ceil(remaining / avgNetOfDebt);
        const targetM = (selMonth + monthsToGoal) % 12;
        const targetY = selYear + Math.floor((selMonth + monthsToGoal) / 12);
        result.push(`Al ritmo actual (descontando cuotas), llegas al objetivo de ahorro en ${MONTHS[targetM]} ${targetY} (~${monthsToGoal} meses).`);
      }
    }

    return result;
  }, [spendingByCat, prevSpendingByCat, totalExpenses, categories, selYear, selMonth, avgMonthlySavings, savingsGoal, savingsInitial, savingsChartData, currentMonthInstallmentTotal]);

  // CSV export
  const exportCSV = () => {
    const header = "fecha,descripcion,monto,moneda,categoria,cuenta,es_cuota\n";
    const rows = txForMonth.map(t => {
      const accName = accounts.find(a => a.id === t.account)?.name || t.account;
      return `${t.fecha},"${t.desc}",${t.monto},${t.moneda},${t.cat || "sin categorizar"},${accName},${t.esCuota ? "si" : "no"}`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transacciones_${currentMK}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCategorize = (id, cat) => {
    setTransactions(prev => prev.map(t => t.id === id ? { ...t, cat } : t));
  };

  const handlePeriod = (y, m) => { setSelYear(y); setSelMonth(m); };

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "upload", label: "Cargar PDF" },
    { id: "savings", label: "Ahorro" },
    { id: "accounts", label: "Cuentas" },
    { id: "installments", label: "Cuotas" },
    { id: "rules", label: "Reglas" },
  ];

  // ═══════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto text-neutral-800" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* Header */}
      <div className="flex items-center gap-3 mb-4 pt-2">
        <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center text-sm font-semibold text-blue-700">N</div>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-neutral-900 leading-tight">Finanzas personales</h1>
        </div>
        <PeriodSelector year={selYear} month={selMonth} onChange={handlePeriod} />
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 mb-5 border-b border-neutral-200 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.id ? "border-neutral-900 text-neutral-900" : "border-transparent text-neutral-400 hover:text-neutral-600"
            }`}>
            {t.label}
            {t.id === "upload" && pendingCount > 0 && (
              <span className="ml-1 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-md">{pendingCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ DASHBOARD ═══ */}
      {activeTab === "dashboard" && (
        <div>
          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricCard
              label={`Patrimonio (${displayCurrency})`}
              value={fmtMoney(displayCurrency === "USD" ? patrimonioTotal / exchangeRate : patrimonioTotal, displayCurrency)}
            />
            <MetricCard
              label="Ingresos del mes"
              value={fmtMoney(totalIncome)}
              color={C.teal}
              delta={prevTotalIncome > 0 ? ((totalIncome - prevTotalIncome) / prevTotalIncome) * 100 : null}
            />
            <MetricCard
              label="Gastos del mes"
              value={fmtMoney(totalExpenses)}
              color={C.red}
              delta={prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : null}
            />
            <MetricCard label="Margen disponible" value={fmtMoney(margen)} color={margen >= 0 ? C.teal : C.red} />
          </div>

          {/* Currency toggle + export */}
          <div className="flex items-center gap-3 mb-5">
            <label className="text-xs text-neutral-500">Moneda display:</label>
            <select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}
              className="text-xs border border-neutral-300 rounded-md px-2 py-1 bg-white">
              <option value="UYU">UYU</option><option value="USD">USD</option>
            </select>
            <label className="text-xs text-neutral-500 ml-2">TC USD/UYU:</label>
            <input type="number" value={exchangeRate} onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)}
              className="text-xs border border-neutral-300 rounded-md px-2 py-1 bg-white w-16" step="0.1" />
            <button onClick={exportCSV} className="ml-auto text-xs border border-neutral-300 rounded-md px-3 py-1 text-neutral-600 hover:bg-neutral-50">
              Exportar CSV
            </button>
          </div>

          {/* Fixed vs Variable */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-neutral-50 rounded-lg p-3.5">
              <p className="text-xs text-neutral-500 mb-1">Gastos fijos</p>
              <p className="text-lg font-semibold" style={{ color: C.coral }}>{fmtMoney(totalFijos)}</p>
            </div>
            <div className="bg-neutral-50 rounded-lg p-3.5">
              <p className="text-xs text-neutral-500 mb-1">Gastos variables</p>
              <p className="text-lg font-semibold" style={{ color: C.blue }}>{fmtMoney(totalVariables)}</p>
            </div>
            <div className="bg-neutral-50 rounded-lg p-3.5">
              <p className="text-xs text-neutral-500 mb-1">Cuotas comprometidas</p>
              <p className="text-lg font-semibold" style={{ color: C.amber }}>{fmtMoney(currentMonthInstallmentTotal)}</p>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            <div>
              <p className="text-sm font-medium text-neutral-700 mb-2">Gastos por categoria</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2">
                {donutData.map(d => {
                  const cc = CAT_COLORS[d.name] || CAT_COLORS.Otros;
                  const totalCat = donutData.reduce((s, x) => s + x.value, 0);
                  return (
                    <span key={d.name} className="flex items-center gap-1 text-xs text-neutral-500">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: cc.color }} />
                      {d.name} {totalCat > 0 ? Math.round((d.value / totalCat) * 100) : 0}%
                    </span>
                  );
                })}
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} dataKey="value" stroke="none">
                    {donutData.map((d, i) => <Cell key={i} fill={(CAT_COLORS[d.name] || CAT_COLORS.Otros).color} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <p className="text-sm font-medium text-neutral-700 mb-2">Evolucion mensual</p>
              <div className="flex gap-3 mb-2">
                <span className="flex items-center gap-1 text-xs text-neutral-500">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: C.teal }} />Ingresos
                </span>
                <span className="flex items-center gap-1 text-xs text-neutral-500">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: C.coral }} />Gastos
                </span>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={monthlyEvo} barGap={2}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="ingresos" fill={C.teal} radius={[3, 3, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="gastos" fill={C.coral} radius={[3, 3, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Budget bars */}
          <div className="mb-5">
            <p className="text-sm font-medium text-neutral-700 mb-3">Presupuesto por categoria</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
              {categories.map(c => (
                <BudgetBar key={c.name} label={`${c.name} (${c.type})`} spent={spendingByCat[c.name] || 0} budget={c.budget} color={(CAT_COLORS[c.name] || CAT_COLORS.Otros).color} />
              ))}
            </div>
          </div>

          {/* Transactions */}
          <div className="mb-5">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-sm font-medium text-neutral-700">Transacciones</p>
              {pendingCount > 0 && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-md">{pendingCount} sin categorizar</span>}
            </div>
            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <div className="grid grid-cols-[68px_1fr_80px_100px_110px] bg-neutral-50 px-3 py-2 border-b border-neutral-200">
                <span className="text-xs text-neutral-400">Fecha</span>
                <span className="text-xs text-neutral-400">Descripcion</span>
                <span className="text-xs text-neutral-400 text-right">Monto</span>
                <span className="text-xs text-neutral-400 text-center">Cuenta</span>
                <span className="text-xs text-neutral-400 text-center">Categoria</span>
              </div>
              {txForMonth.map((tx, i) => {
                const acc = accounts.find(a => a.id === tx.account);
                return (
                  <div key={tx.id}
                    className={`grid grid-cols-[68px_1fr_80px_100px_110px] px-3 py-2 items-center ${
                      i < txForMonth.length - 1 ? "border-b border-neutral-100" : ""
                    } ${!tx.cat ? "bg-amber-50/40" : ""}`}>
                    <span className="text-xs text-neutral-400">{tx.fecha.slice(5).replace("-", "/")}</span>
                    <span className="text-xs text-neutral-800 truncate pr-2">
                      {tx.desc}
                      {tx.esCuota && <span className="text-xs text-amber-600 ml-1">(cuota)</span>}
                    </span>
                    <span className={`text-xs text-right font-medium ${tx.monto > 0 ? "text-green-700" : "text-neutral-800"}`}>
                      {tx.monto > 0 ? "+" : ""}{fmtMoney(tx.monto)}
                    </span>
                    <span className="text-xs text-neutral-500 text-center truncate">{acc?.name.split(" ")[0] || "—"}</span>
                    <span className="text-center">
                      {tx.cat ? <Badge cat={tx.cat} /> : (
                        <select className="text-xs border border-neutral-300 rounded-md px-1.5 py-0.5 bg-white text-neutral-800"
                          onChange={e => handleCategorize(tx.id, e.target.value)} defaultValue="">
                          <option value="" disabled>Asignar...</option>
                          {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                          <option value="Ingreso">Ingreso</option>
                        </select>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ═══ UPLOAD ═══ */}
      {activeTab === "upload" && (
        <div>
          <div className="border-2 border-dashed border-neutral-300 rounded-xl p-8 text-center mb-5">
            <p className="text-sm text-neutral-600 font-medium mb-1">Arrastra tu PDF o screenshot aca</p>
            <p className="text-xs text-neutral-400 mb-3">Si ya hay datos del mes, se mergean sin duplicar (matching por fecha + monto + descripcion).</p>
            <div className="flex items-center justify-center gap-3 mb-3">
              <label className="text-xs text-neutral-500">Cuenta de origen:</label>
              <select className="text-xs border border-neutral-300 rounded-md px-2 py-1 bg-white">
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </div>
            <button className="px-4 py-2 text-sm border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-50">
              Seleccionar archivo
            </button>
          </div>
          <div className="bg-neutral-50 rounded-xl p-5">
            <p className="text-sm font-medium text-neutral-700 mb-3">Uploads recientes</p>
            {[
              { name: "resumen_marzo_brou.pdf", date: "15/03/2026", txCount: 23, account: "BROU UYU", status: "ok" },
              { name: "screenshot_visa_mar20.png", date: "20/03/2026", txCount: 5, account: "Visa Gold", status: "pending" },
            ].map((f, i) => (
              <div key={i} className="flex items-center gap-3 bg-white rounded-lg px-4 py-3 border border-neutral-200 mb-2">
                <span className="text-xs font-mono text-neutral-500 bg-neutral-100 px-2 py-1 rounded">{f.name.endsWith(".pdf") ? "PDF" : "IMG"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-neutral-800 truncate">{f.name}</p>
                  <p className="text-xs text-neutral-400">{f.date} · {f.account} · {f.txCount} transacciones</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-md ${f.status === "ok" ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                  {f.status === "ok" ? "Procesado" : "Pendientes"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ AHORRO ═══ */}
      {activeTab === "savings" && (
        <div>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Capital inicial</label>
              <input type="number" value={savingsInitial} onChange={e => setSavingsInitial(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Objetivo</label>
              <input type="number" value={savingsGoal} onChange={e => setSavingsGoal(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white" />
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Moneda proyeccion</label>
              <select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white">
                <option value="UYU">UYU</option><option value="USD">USD</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            <MetricCard label="Ahorro mensual promedio" value={fmtMoney(avgMonthlySavings)} color={C.teal} />
            <MetricCard label="Cuotas mensuales" value={fmtMoney(currentMonthInstallmentTotal)} color={C.amber} />
            <MetricCard label="Ahorro neto (sin cuotas)" value={fmtMoney(avgMonthlySavings - currentMonthInstallmentTotal)} color={C.blue} />
          </div>

          {/* Savings chart */}
          <div className="mb-5">
            <div className="flex gap-4 mb-2">
              <span className="flex items-center gap-1 text-xs text-neutral-500">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: C.teal }} />Ahorro real
              </span>
              <span className="flex items-center gap-1 text-xs text-neutral-500">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: C.blue }} />Proyeccion (neta de cuotas)
              </span>
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={savingsChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="real" stroke={C.teal} fill={C.teal} fillOpacity={0.08} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                <Line type="monotone" dataKey="proyeccion" stroke={C.blue} strokeWidth={2} strokeDasharray="6 4" dot={{ r: 2 }} connectNulls={false} />
                <Line type="monotone" dataKey="objetivo" stroke="#d4d4d4" strokeWidth={1} strokeDasharray="3 3" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Commitment chart */}
          <div className="mb-5">
            <p className="text-sm font-medium text-neutral-700 mb-2">Compromiso en cuotas (proximos 6 meses)</p>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={futureCommitments}>
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#a3a3a3" }} axisLine={false} tickLine={false} tickFormatter={v => `$${Math.round(v / 1000)}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="total" fill={C.amber} radius={[3, 3, 0, 0]} maxBarSize={32} name="Cuotas" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Dynamic insights */}
          <div className="bg-blue-50 rounded-xl p-4">
            <p className="text-sm font-medium text-blue-800 mb-2">Insights</p>
            {insights.map((ins, i) => (
              <p key={i} className="text-sm text-blue-700 mb-1.5 last:mb-0">{ins}</p>
            ))}
          </div>
        </div>
      )}

      {/* ═══ CUENTAS ═══ */}
      {activeTab === "accounts" && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-neutral-50 rounded-lg p-4">
              <p className="text-xs text-neutral-500 mb-1">Patrimonio total (UYU)</p>
              <p className="text-xl font-semibold">{fmtMoney(patrimonioTotal)}</p>
            </div>
            <div className="bg-neutral-50 rounded-lg p-4">
              <p className="text-xs text-neutral-500 mb-1">TC USD/UYU</p>
              <div className="flex items-center gap-2">
                <input type="number" value={exchangeRate} onChange={e => setExchangeRate(parseFloat(e.target.value) || 0)}
                  className="text-lg font-semibold w-20 bg-transparent border-b border-neutral-300 outline-none" step="0.1" />
              </div>
            </div>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden mb-5">
            <div className="grid grid-cols-[1fr_80px_120px_100px] bg-neutral-50 px-4 py-2 border-b border-neutral-200">
              <span className="text-xs text-neutral-400">Cuenta</span>
              <span className="text-xs text-neutral-400">Moneda</span>
              <span className="text-xs text-neutral-400 text-right">Balance</span>
              <span className="text-xs text-neutral-400 text-right">En UYU</span>
            </div>
            {accounts.map((acc, i) => (
              <div key={acc.id} className={`grid grid-cols-[1fr_80px_120px_100px] px-4 py-3 items-center ${i < accounts.length - 1 ? "border-b border-neutral-100" : ""}`}>
                <span className="text-sm text-neutral-800 font-medium">{acc.name}</span>
                <span className="text-xs text-neutral-500">{acc.currency}</span>
                <span className={`text-sm text-right font-medium ${acc.balance < 0 ? "text-red-500" : "text-neutral-800"}`}>
                  {fmtMoney(acc.balance, acc.currency)}
                </span>
                <span className="text-sm text-right text-neutral-500">
                  {fmtMoney(acc.currency === "USD" ? acc.balance * exchangeRate : acc.balance)}
                </span>
              </div>
            ))}
          </div>

          {/* Edit account balances */}
          <div className="bg-neutral-50 rounded-xl p-5">
            <p className="text-sm font-medium text-neutral-700 mb-3">Ajustar balances</p>
            <div className="space-y-2">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-700 w-48 truncate">{acc.name}</span>
                  <input type="number" value={acc.balance}
                    onChange={e => setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, balance: parseFloat(e.target.value) || 0 } : a))}
                    className="text-sm border border-neutral-300 rounded-md px-2 py-1 bg-white w-32" />
                  <span className="text-xs text-neutral-400">{acc.currency}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ CUOTAS ═══ */}
      {activeTab === "installments" && (
        <div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <MetricCard label="Cuotas este mes" value={fmtMoney(currentMonthInstallmentTotal)} color={C.amber} />
            <MetricCard label="Deuda total restante"
              value={fmtMoney(installments.reduce((s, i) => s + i.montoCuota * (i.cuotas - i.cuotaActual), 0))}
              color={C.red} />
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden mb-5">
            <div className="grid grid-cols-[1fr_80px_80px_90px_90px_60px] bg-neutral-50 px-4 py-2 border-b border-neutral-200">
              <span className="text-xs text-neutral-400">Descripcion</span>
              <span className="text-xs text-neutral-400 text-right">Total</span>
              <span className="text-xs text-neutral-400 text-center">Cuota</span>
              <span className="text-xs text-neutral-400 text-right">Monto/mes</span>
              <span className="text-xs text-neutral-400 text-center">Cuenta</span>
              <span className="text-xs text-neutral-400 text-center">Accion</span>
            </div>
            {installments.map((inst, i) => {
              const acc = accounts.find(a => a.id === inst.account);
              return (
                <div key={inst.id} className={`grid grid-cols-[1fr_80px_80px_90px_90px_60px] px-4 py-2.5 items-center ${i < installments.length - 1 ? "border-b border-neutral-100" : ""}`}>
                  <span className="text-sm text-neutral-800">{inst.desc}</span>
                  <span className="text-xs text-neutral-500 text-right">{fmtMoney(inst.total)}</span>
                  <span className="text-xs text-neutral-800 text-center font-medium">{inst.cuotaActual}/{inst.cuotas}</span>
                  <span className="text-sm text-neutral-800 text-right font-medium">{fmtMoney(inst.montoCuota)}</span>
                  <span className="text-xs text-neutral-500 text-center">{acc?.name.split(" ")[0] || "—"}</span>
                  <span className="text-center">
                    <button onClick={() => setInstallments(prev => prev.filter(x => x.id !== inst.id))}
                      className="text-xs text-red-500 hover:text-red-700">Borrar</button>
                  </span>
                </div>
              );
            })}
          </div>

          {/* Add installment */}
          <div className="bg-neutral-50 rounded-xl p-5">
            <p className="text-sm font-medium text-neutral-700 mb-3">Agregar compra en cuotas</p>
            <div className="grid grid-cols-[1fr_100px_80px_120px_auto] gap-3 items-end">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Descripcion</label>
                <input type="text" value={newInst.desc} onChange={e => setNewInst(p => ({ ...p, desc: e.target.value }))}
                  placeholder="ej: Smart TV" className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Total</label>
                <input type="number" value={newInst.total} onChange={e => setNewInst(p => ({ ...p, total: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Cuotas</label>
                <input type="number" value={newInst.cuotas} onChange={e => setNewInst(p => ({ ...p, cuotas: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white" />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Cuenta</label>
                <select value={newInst.account} onChange={e => setNewInst(p => ({ ...p, account: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-neutral-300 rounded-lg bg-white">
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <button onClick={() => {
                if (!newInst.desc || !newInst.total || !newInst.cuotas) return;
                const total = parseFloat(newInst.total);
                const cuotas = parseInt(newInst.cuotas);
                setInstallments(prev => [...prev, {
                  id: Date.now(), desc: newInst.desc, total, cuotas, cuotaActual: 1,
                  montoCuota: Math.round(total / cuotas), account: newInst.account,
                  startMonth: currentMK,
                }]);
                setNewInst({ desc: "", total: "", cuotas: "", account: "visa_gold" });
              }} className="px-4 py-2 text-sm bg-neutral-900 text-white rounded-lg hover:bg-neutral-800">
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ REGLAS ═══ */}
      {activeTab === "rules" && (
        <div>
          <p className="text-sm font-medium text-neutral-700 mb-1">
            Reglas aprendidas <span className="text-xs font-normal text-neutral-400 ml-1">{rules.length} activas</span>
          </p>
          <p className="text-xs text-neutral-400 mb-4">Cada vez que categorizes una transaccion, la app guarda el patron. La proxima vez se asigna automaticamente.</p>

          {/* Budgets config */}
          <div className="bg-neutral-50 rounded-xl p-5 mb-5">
            <p className="text-sm font-medium text-neutral-700 mb-3">Presupuestos y tipo por categoria</p>
            <div className="space-y-2">
              {categories.map((c, ci) => (
                <div key={c.name} className="flex items-center gap-3">
                  <span className="text-sm text-neutral-700 w-32 truncate">{c.name}</span>
                  <select value={c.type} onChange={e => setCategories(prev => prev.map((x, i) => i === ci ? { ...x, type: e.target.value } : x))}
                    className="text-xs border border-neutral-300 rounded-md px-2 py-1 bg-white w-24">
                    <option value="fijo">Fijo</option><option value="variable">Variable</option>
                  </select>
                  <label className="text-xs text-neutral-500">Presupuesto:</label>
                  <input type="number" value={c.budget}
                    onChange={e => setCategories(prev => prev.map((x, i) => i === ci ? { ...x, budget: parseInt(e.target.value) || 0 } : x))}
                    className="text-sm border border-neutral-300 rounded-md px-2 py-1 bg-white w-24" />
                </div>
              ))}
            </div>
          </div>

          <div className="border border-neutral-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1fr_120px_80px_60px] bg-neutral-50 px-4 py-2 border-b border-neutral-200">
              <span className="text-xs text-neutral-400">Patron</span>
              <span className="text-xs text-neutral-400">Categoria</span>
              <span className="text-xs text-neutral-400 text-right">Matches</span>
              <span className="text-xs text-neutral-400 text-right">Accion</span>
            </div>
            {rules.map((r, i) => (
              <div key={i} className={`grid grid-cols-[1fr_120px_80px_60px] px-4 py-2.5 items-center ${i < rules.length - 1 ? "border-b border-neutral-100" : ""}`}>
                <span className="text-sm font-mono text-neutral-800">{r.pattern}</span>
                <span><Badge cat={r.cat} /></span>
                <span className="text-xs text-neutral-400 text-right">{r.matches}</span>
                <span className="text-right"><button className="text-xs text-red-500 hover:text-red-700">Borrar</button></span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
