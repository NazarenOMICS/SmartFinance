import { Suspense, lazy, useEffect, useState } from "react";
import { api } from "./api";
import Onboarding from "./components/Onboarding";
import PeriodSelector from "./components/PeriodSelector";
import Tutorial from "./components/Tutorial";
import { isoMonth } from "./utils";

const Dashboard    = lazy(() => import("./pages/Dashboard"));
const Upload       = lazy(() => import("./pages/Upload"));
const Savings      = lazy(() => import("./pages/Savings"));
const Accounts     = lazy(() => import("./pages/Accounts"));
const Installments = lazy(() => import("./pages/Installments"));
const Rules        = lazy(() => import("./pages/Rules"));

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload",    label: "Upload" },
  { id: "savings",   label: "Ahorro" },
  { id: "accounts",  label: "Cuentas" },
  { id: "installments", label: "Cuotas" },
  { id: "rules",     label: "Reglas" },
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(isoMonth());
  const [settings, setSettings] = useState({});
  const [showTutorial, setShowTutorial] = useState(false);

  // null = checking, false = no accounts (show onboarding), true = has accounts
  const [hasAccounts, setHasAccounts] = useState(null);

  async function refreshSettings() {
    const s = await api.getSettings();
    setSettings(s);
  }

  async function checkSetup() {
    try {
      const accounts = await api.getAccounts();
      setHasAccounts(accounts.length > 0);
    } catch {
      setHasAccounts(false);
    }
  }

  useEffect(() => {
    refreshSettings();
    checkSetup();
  }, []);

  function handleOnboardingComplete(goTo = "dashboard") {
    setHasAccounts(true);
    setTab(goTo);
  }

  function navigate(tabId) {
    setTab(tabId);
  }

  // Loading
  if (hasAccounts === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream">
        <p className="text-neutral-400">Cargando…</p>
      </div>
    );
  }

  // Onboarding — no accounts yet
  if (!hasAccounts) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  // Main app
  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}

      <header className="mb-8 rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">SmartFinance</p>
            <h1 className="mt-2 font-display text-5xl text-finance-ink">Tu mapa financiero mensual</h1>
            <p className="mt-3 max-w-2xl text-sm text-neutral-500">
              PDFs, deduplicación, reglas aprendidas y una vista clara del mes para decidir rápido.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTutorial(true)}
              title="Ayuda"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white font-bold text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple"
            >
              ?
            </button>
            <PeriodSelector month={month} onChange={setMonth} />
          </div>
        </div>
        <nav className="mt-6 flex flex-wrap gap-3">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === item.id
                  ? "bg-finance-purple text-white"
                  : "bg-finance-cream text-finance-ink hover:bg-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <Suspense fallback={<div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando vista…</div>}>
        {tab === "dashboard"    && <Dashboard    month={month} settings={settings} refreshSettings={refreshSettings} onNavigate={navigate} />}
        {tab === "upload"       && <Upload       month={month} onDone={() => setTab("dashboard")} />}
        {tab === "savings"      && <Savings      month={month} settings={settings} refreshSettings={refreshSettings} />}
        {tab === "accounts"     && <Accounts     settings={settings} refreshSettings={refreshSettings} onAccountDeleted={checkSetup} />}
        {tab === "installments" && <Installments month={month} />}
        {tab === "rules"        && <Rules />}
      </Suspense>
    </div>
  );
}
