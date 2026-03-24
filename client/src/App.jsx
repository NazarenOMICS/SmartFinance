import { Suspense, lazy, useEffect, useState } from "react";
import { api } from "./api";
import PeriodSelector from "./components/PeriodSelector";
import Tutorial from "./components/Tutorial";
import { isoMonth } from "./utils";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Upload = lazy(() => import("./pages/Upload"));
const Savings = lazy(() => import("./pages/Savings"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Installments = lazy(() => import("./pages/Installments"));
const Rules = lazy(() => import("./pages/Rules"));

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload", label: "Upload" },
  { id: "savings", label: "Ahorro" },
  { id: "accounts", label: "Cuentas" },
  { id: "installments", label: "Cuotas" },
  { id: "rules", label: "Reglas" }
];

const TUTORIAL_KEY = "sf_tutorial_done";

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(isoMonth());
  const [settings, setSettings] = useState({});
  const [showTutorial, setShowTutorial] = useState(false);

  async function refreshSettings() {
    const nextSettings = await api.getSettings();
    setSettings(nextSettings);
  }

  useEffect(() => {
    refreshSettings();
    // Show tutorial on first visit
    if (!localStorage.getItem(TUTORIAL_KEY)) {
      setShowTutorial(true);
    }
  }, []);

  function closeTutorial() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    setShowTutorial(false);
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      {showTutorial && <Tutorial onClose={closeTutorial} />}

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
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 hover:bg-finance-purpleSoft hover:text-finance-purple transition text-lg font-bold"
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
                tab === item.id ? "bg-finance-purple text-white" : "bg-finance-cream text-finance-ink hover:bg-white"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <Suspense fallback={<div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando vista…</div>}>
        {tab === "dashboard" ? <Dashboard month={month} settings={settings} refreshSettings={refreshSettings} /> : null}
        {tab === "upload" ? <Upload month={month} /> : null}
        {tab === "savings" ? <Savings month={month} settings={settings} refreshSettings={refreshSettings} /> : null}
        {tab === "accounts" ? <Accounts settings={settings} refreshSettings={refreshSettings} /> : null}
        {tab === "installments" ? <Installments month={month} /> : null}
        {tab === "rules" ? <Rules /> : null}
      </Suspense>
    </div>
  );
}
