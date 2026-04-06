import { Suspense, lazy, useEffect, useState } from "react";
import { api } from "./api";
import PeriodSelector from "./components/PeriodSelector";
import { isoMonth } from "./utils";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Upload = lazy(() => import("./pages/Upload"));
const Savings = lazy(() => import("./pages/Savings"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Installments = lazy(() => import("./pages/Installments"));
const Rules = lazy(() => import("./pages/Rules"));
const Assistant = lazy(() => import("./pages/Assistant"));

const tabs = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload", label: "Upload" },
  { id: "savings", label: "Ahorro" },
  { id: "accounts", label: "Cuentas" },
  { id: "installments", label: "Cuotas" },
  { id: "rules", label: "Reglas" },
  { id: "assistant", label: "Asistente" }
];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState("");
  const [settings, setSettings] = useState({});
  const [dataVersion, setDataVersion] = useState(0);
  const [bootstrapped, setBootstrapped] = useState(false);

  async function refreshSettings() {
    try {
      const nextSettings = await api.getSettings();
      setSettings(nextSettings);
      setMonth((current) => current || nextSettings.default_month || isoMonth(new Date()));
    } catch (error) {
      setMonth((current) => current || isoMonth(new Date()));
    } finally {
      setBootstrapped(true);
    }
  }

  function invalidateData() {
    setDataVersion((current) => current + 1);
  }

  useEffect(() => {
    refreshSettings();
  }, []);

  if (!bootstrapped || !month) {
    return <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8"><div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando app...</div></div>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      <header className="mb-8 rounded-[36px] border border-white/70 bg-white/80 p-6 shadow-panel backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">SmartFinance</p>
            <h1 className="mt-2 font-display text-5xl text-finance-ink">Tu mapa financiero mensual</h1>
            <p className="mt-3 max-w-2xl text-sm text-neutral-500">
              PDFs, deduplicacion, reglas aprendidas y una vista clara del mes para decidir rapido.
            </p>
          </div>
          <PeriodSelector month={month} onChange={setMonth} />
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

      <Suspense fallback={<div className="rounded-[28px] bg-white/80 p-10 text-center text-neutral-500 shadow-panel">Cargando vista...</div>}>
        {tab === "dashboard" ? <Dashboard month={month} settings={settings} dataVersion={dataVersion} /> : null}
        {tab === "upload" ? <Upload month={month} dataVersion={dataVersion} invalidateData={invalidateData} /> : null}
        {tab === "savings" ? <Savings month={month} settings={settings} refreshSettings={refreshSettings} dataVersion={dataVersion} /> : null}
        {tab === "accounts" ? <Accounts settings={settings} refreshSettings={refreshSettings} dataVersion={dataVersion} invalidateData={invalidateData} /> : null}
        {tab === "installments" ? <Installments month={month} dataVersion={dataVersion} invalidateData={invalidateData} /> : null}
        {tab === "rules" ? <Rules dataVersion={dataVersion} invalidateData={invalidateData} /> : null}
        {tab === "assistant" ? <Assistant month={month} dataVersion={dataVersion} /> : null}
      </Suspense>
    </div>
  );
}
