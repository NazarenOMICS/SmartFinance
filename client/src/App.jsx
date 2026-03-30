import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth,
  useUser,
} from "@clerk/clerk-react";
import { api, setTokenGetter } from "./api";
import { ToastProvider } from "./contexts/ToastContext";
import BrandMark from "./components/BrandMark";
import Onboarding from "./components/Onboarding";
import PeriodSelector from "./components/PeriodSelector";
import Tutorial from "./components/Tutorial";
import SearchModal from "./components/SearchModal";
import ShortcutsModal from "./components/ShortcutsModal";
import { SkeletonDashboard } from "./components/SkeletonLoader";
import { isoMonth } from "./utils";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Upload = lazy(() => import("./pages/Upload"));
const Savings = lazy(() => import("./pages/Savings"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Installments = lazy(() => import("./pages/Installments"));
const Recurring = lazy(() => import("./pages/Recurring"));
const Rules = lazy(() => import("./pages/Rules"));

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "upload", label: "Upload" },
  { id: "savings", label: "Ahorro" },
  { id: "recurring", label: "Recurrentes" },
  { id: "rules", label: "Categorias" },
  { id: "accounts", label: "Cuentas" },
  { id: "installments", label: "Cuotas" },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 16l4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function SunMoonIcon({ dark }) {
  if (dark) {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="4.5" fill="currentColor" />
        <path
          d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9L5.3 5.3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M19 15.5A7.5 7.5 0 0 1 8.5 5a8 8 0 1 0 10.5 10.5Z"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        d="M9.6 9a2.75 2.75 0 1 1 4.1 2.4c-.96.56-1.7 1.12-1.7 2.35"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="17.2" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function getGreeting(name) {
  const hour = new Date().getHours();

  if (hour < 6) {
    return {
      title: `Noche larga, ${name}`,
      subtitle: "Si seguimos mirando el mapa, al menos que se sienta claro y bajo control.",
    };
  }
  if (hour < 12) {
    return {
      title: `Buen dia, ${name}`,
      subtitle: "Arranca el dia con una vista limpia de tu plata y tus prioridades.",
    };
  }
  if (hour < 20) {
    return {
      title: `Buenas tardes, ${name}`,
      subtitle: "Todo el mes a la vista, para decidir rapido sin perder contexto.",
    };
  }
  return {
    title: `Buenas noches, ${name}`,
    subtitle: "Cierra el dia con tus numeros ordenados y menos ruido en la cabeza.",
  };
}

function AuthSync() {
  const { getToken } = useAuth();

  useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  return null;
}

function AuthScreen() {
  const isDark = localStorage.getItem("sf_dark") === "true";

  return (
    <div
      className={`min-h-screen bg-finance-cream px-4 py-8 dark:bg-neutral-950 ${
        isDark ? "dark" : ""
      }`}
    >
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl overflow-hidden rounded-[40px] border border-white/70 bg-white/78 shadow-[0_35px_90px_rgba(22,25,51,0.14)] backdrop-blur dark:border-white/10 dark:bg-neutral-900/80">
        <div className="relative flex flex-1 flex-col justify-between overflow-hidden bg-[linear-gradient(150deg,_rgba(83,74,183,0.12),_rgba(29,158,117,0.08)_56%,_rgba(255,255,255,0.84))] p-8 dark:bg-[linear-gradient(150deg,_rgba(83,74,183,0.22),_rgba(29,158,117,0.14)_56%,_rgba(18,18,30,0.92))] md:p-10">
          <div className="absolute -right-20 top-0 h-56 w-56 rounded-full bg-finance-purple/12 blur-3xl" />
          <div className="absolute -left-16 bottom-0 h-52 w-52 rounded-full bg-finance-teal/12 blur-3xl" />

          <div className="relative">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-800/80">
              <BrandMark size="sm" />
              <div>
                <p className="text-[10px] uppercase tracking-[0.34em] text-neutral-400">SmartFinance</p>
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Tus movimientos, por fin con criterio</p>
              </div>
            </div>

            <h1 className="mt-8 max-w-xl font-display text-5xl leading-tight text-finance-ink dark:text-neutral-100 md:text-6xl">
              Empeza el mes sabiendo donde estas parado.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-neutral-500 dark:text-neutral-300">
              Entra, importa tus movimientos y convierte gastos, ahorro y metas en un mapa mucho mas claro.
            </p>
          </div>

          <div className="relative mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                title: "Subes desde donde ya estas",
                body: "PDF, CSV, TXT o carga manual. Nada de rehacer todo tu flujo.",
              },
              {
                title: "Aprende tus decisiones",
                body: "Las categorias confirmadas se convierten en memoria util para el proximo mes.",
              },
              {
                title: "Miras el panorama real",
                body: "Dashboard, ahorro, recurrentes y cuotas en un lenguaje mas humano.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="rounded-[28px] border border-white/70 bg-white/78 p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900/70"
              >
                <p className="font-semibold text-finance-ink dark:text-neutral-100">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-300">{item.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex w-full items-center justify-center bg-white/88 p-6 dark:bg-neutral-950/72 md:max-w-[460px] md:p-10">
          <div className="w-full">
            <div className="mb-6 text-center md:text-left">
              <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">Acceso</p>
              <h2 className="mt-2 font-display text-3xl text-finance-ink dark:text-neutral-100">
                Inicia sesion para seguir ordenando tu mes
              </h2>
            </div>
            <SignIn
              appearance={{
                elements: {
                  card: "rounded-[30px] border border-white/80 bg-white/95 shadow-panel dark:border-white/10 dark:bg-neutral-900/95",
                  headerTitle: "font-display text-2xl text-finance-ink dark:text-neutral-100",
                  headerSubtitle: "text-neutral-500 dark:text-neutral-300",
                  socialButtonsBlockButton:
                    "rounded-2xl border border-neutral-200 bg-white hover:bg-finance-purpleSoft dark:border-neutral-700 dark:bg-neutral-800",
                  formFieldInput:
                    "rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800",
                  formButtonPrimary:
                    "rounded-full bg-finance-purple font-semibold hover:opacity-90 focus:shadow-none",
                  footer: "hidden",
                },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AppInner() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { user } = useUser();
  const [tab, setTab] = useState("dashboard");
  const [month, setMonth] = useState(isoMonth());
  const [settings, setSettings] = useState({});
  const [showTutorial, setShowTutorial] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("sf_dark") === "true");
  const [pendingCount, setPendingCount] = useState(0);
  const [onboardStatus, setOnboardStatus] = useState(null);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [claimingLegacy, setClaimingLegacy] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const [schemaStatus, setSchemaStatus] = useState(null);
  const settingsRequestIdRef = useRef(0);
  const pendingRequestIdRef = useRef(0);
  const displayName = user?.firstName || user?.fullName?.split(" ")[0] || "Naza";
  const greeting = getGreeting(displayName);

  function markDone() {
    if (userId) {
      localStorage.setItem(`sf_onboard_${userId}`, "done");
    }
    setOnboardStatus("done");
  }

  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("sf_dark", dark);
  }, [dark]);

  useEffect(() => {
    const titles = {
      dashboard: "Dashboard",
      upload: "Upload",
      savings: "Ahorro",
      rules: "Categorias",
      accounts: "Cuentas",
      installments: "Cuotas",
      recurring: "Recurrentes",
    };
    document.title = `${titles[tab] || tab} - SmartFinance`;
  }, [tab]);

  useEffect(() => {
    function onKey(e) {
      const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
      if (e.key === "Escape") {
        if (showSearch) {
          setShowSearch(false);
          return;
        }
        if (showShortcuts) {
          setShowShortcuts(false);
          return;
        }
        if (showTutorial) {
          setShowTutorial(false);
          return;
        }
      }
      if (inInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
        return;
      }
      if (e.key === "?" || e.key === "/h") {
        setShowShortcuts(true);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch, showShortcuts, showTutorial]);

  async function refreshSettings() {
    const requestId = ++settingsRequestIdRef.current;
    const nextSettings = await api.getSettings();
    if (settingsRequestIdRef.current !== requestId) return;
    setSettings(nextSettings);
    return nextSettings;
  }

  async function refreshPendingCount(targetMonth = month) {
    const requestId = ++pendingRequestIdRef.current;
    try {
      const summary = await api.getSummary(targetMonth);
      if (pendingRequestIdRef.current !== requestId) return;
      setPendingCount(summary.pending_count || 0);
    } catch {
      // Keep last known badge state.
    }
  }

  async function initApp(attempt = 0) {
    const maxRetries = 3;
    const cachedDone = userId && localStorage.getItem(`sf_onboard_${userId}`) === "done";

    try {
      const schema = await api.getSchemaStatus();
      setSchemaStatus(schema);
    } catch (error) {
      if (error.code === "SCHEMA_MISMATCH") {
        setSchemaStatus(error.schema);
        setApiDown(false);
        return;
      }
    }

    if (cachedDone) {
      setOnboardStatus("done");
      try {
        await api.onboard();
        const [accounts] = await Promise.all([
          api.getAccounts(),
          refreshSettings(),
          refreshPendingCount(month),
        ]);
        setApiDown(false);
        if (accounts.length === 0) {
          localStorage.removeItem(`sf_onboard_${userId}`);
          setOnboardStatus("no_accounts");
        }
      } catch (e) {
        if (e.code === "SCHEMA_MISMATCH") {
          setSchemaStatus(e.schema);
          setApiDown(false);
          return;
        }
        const message = e.message?.toLowerCase() || "";
        const isNetworkError =
          message.includes("fetch") || message.includes("network") || message.includes("failed to fetch");

        if (isNetworkError) {
          setApiDown(true);
        } else if (attempt < maxRetries) {
          const delay = 500 * (attempt + 1);
          setTimeout(() => initApp(attempt + 1), delay);
        }
      }
      return;
    }

    try {
      const onboardResult = await api.onboard();

      if (onboardResult.status === "created") {
        try {
          await api.claimLegacy();
          setLegacyAvailable(false);
        } catch {
          // No legacy data to claim.
        }
      }

      await refreshSettings();

      const accounts = await api.getAccounts();
      setApiDown(false);
      if (accounts.length > 0) {
        markDone();
      } else {
        setOnboardStatus("no_accounts");
      }
    } catch (e) {
      if (e.code === "SCHEMA_MISMATCH") {
        setSchemaStatus(e.schema);
        setApiDown(false);
        return;
      }
      const message = e.message?.toLowerCase() || "";
      const isNetworkError =
        message.includes("fetch") || message.includes("network") || message.includes("failed to fetch");

      if (isNetworkError) {
        setApiDown(true);
        setOnboardStatus("no_accounts");
      } else if (attempt < maxRetries) {
        const delay = 500 * (attempt + 1);
        setTimeout(() => initApp(attempt + 1), delay);
      } else {
        setApiDown(false);
        setOnboardStatus("done");
      }
    }
  }

  useEffect(() => {
    if (isLoaded && isSignedIn && userId) {
      initApp();
    }
  }, [isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (onboardStatus === "done") {
      refreshPendingCount();
    }
  }, [month, tab, onboardStatus]);

  function handleNavigateToMonth(targetMonth) {
    setMonth(targetMonth);
    setTab("dashboard");
  }

  if (!isLoaded || onboardStatus === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream px-4 dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-4 rounded-[32px] border border-white/70 bg-white/85 px-8 py-7 shadow-panel dark:border-white/10 dark:bg-neutral-900/85">
          <BrandMark size="md" className="animate-pulse" />
          <div className="text-center">
            <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Preparando tu espacio</p>
            <p className="mt-1 text-sm text-neutral-400">Conectando con tus datos...</p>
          </div>
        </div>
      </div>
    );
  }

  if (apiDown) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream px-4 dark:bg-neutral-950">
        <div className="max-w-lg rounded-[36px] border border-white/70 bg-white/88 p-8 text-center shadow-panel dark:border-white/10 dark:bg-neutral-900/88">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-finance-redSoft text-finance-red dark:bg-red-900/30 dark:text-red-300">
            <HelpIcon />
          </div>
          <h1 className="mt-6 font-display text-4xl text-finance-ink dark:text-neutral-100">
            No pudimos hablar con el servidor
          </h1>
          <p className="mt-3 text-sm leading-7 text-neutral-500 dark:text-neutral-300">
            Revisa tu conexion y vuelve a intentar. Cuando la API responda, retomamos donde estabas sin
            perder el contexto.
          </p>
          <button
            onClick={initApp}
            className="mt-6 rounded-full bg-finance-purple px-6 py-3 font-semibold text-white transition hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (schemaStatus && !schemaStatus.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream px-4 dark:bg-neutral-950">
        <div className="max-w-xl rounded-[36px] border border-white/70 bg-white/88 p-8 text-center shadow-panel dark:border-white/10 dark:bg-neutral-900/88">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-finance-purpleSoft text-finance-purple dark:bg-purple-900/30 dark:text-purple-300">
            <HelpIcon />
          </div>
          <h1 className="mt-6 font-display text-4xl text-finance-ink dark:text-neutral-100">
            La base necesita migraciones
          </h1>
          <p className="mt-3 text-sm leading-7 text-neutral-500 dark:text-neutral-300">
            La app detecto un desajuste entre el schema esperado y la base publicada. Cuando el deploy aplique
            la migracion correcta, todo vuelve a funcionar sin dejarte frente a errores SQL crudos.
          </p>
          <div className="mt-5 rounded-[24px] bg-finance-cream/80 px-5 py-4 text-left text-sm text-neutral-500 dark:bg-neutral-800/80 dark:text-neutral-300">
            <p><strong>Esperado:</strong> {schemaStatus.expected_version}</p>
            <p><strong>Actual:</strong> {schemaStatus.current_version || "sin version registrada"}</p>
            <p><strong>Motivo:</strong> {schemaStatus.blocking_reason}</p>
          </div>
          <button
            onClick={initApp}
            className="mt-6 rounded-full bg-finance-purple px-6 py-3 font-semibold text-white transition hover:opacity-90"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (onboardStatus === "no_accounts") {
    return (
      <Onboarding
        onComplete={(nextTab = "dashboard") => {
          markDone();
          setTab(nextTab === "upload" ? "upload" : "dashboard");
          refreshSettings().catch(() => {});
        }}
      />
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} onNavigateToMonth={handleNavigateToMonth} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      <header className="mb-8 overflow-hidden rounded-[38px] border border-white/70 bg-white/82 p-5 shadow-panel backdrop-blur dark:border-white/10 dark:bg-neutral-900/82 md:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-800/85">
              <BrandMark size="sm" />
              <div className="text-left">
                <p className="text-[10px] uppercase tracking-[0.34em] text-neutral-400">SmartFinance</p>
                <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Tu sistema financiero personal</p>
              </div>
            </div>

            <h1 className="mt-5 max-w-2xl font-display text-4xl leading-tight text-finance-ink dark:text-neutral-100 md:text-5xl">
              {greeting.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
              {greeting.subtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 md:gap-3">
            <button
              onClick={() => setShowSearch(true)}
              title="Busqueda global (Ctrl+K)"
              className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 py-2 text-sm text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <SearchIcon />
              <span className="hidden sm:inline">Buscar</span>
              <kbd className="hidden rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] text-neutral-400 sm:inline dark:border-neutral-700 dark:bg-neutral-900">
                Ctrl+K
              </kbd>
            </button>

            <button
              onClick={() => setDark(!dark)}
              title={dark ? "Modo claro" : "Modo oscuro"}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <SunMoonIcon dark={dark} />
            </button>

            <button
              onClick={() => setShowTutorial(true)}
              title="Ayuda"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <HelpIcon />
            </button>

            <PeriodSelector month={month} onChange={setMonth} />

            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-10 w-10 rounded-full border border-neutral-200 dark:border-neutral-700",
                },
              }}
            />
          </div>
        </div>

        <nav className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-none md:gap-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                tab === item.id
                  ? "bg-finance-purple text-white shadow-sm"
                  : "bg-finance-cream text-finance-ink hover:bg-white dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              <span>{item.label}</span>
              {item.id === "dashboard" && pendingCount > 0 && (
                <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-finance-amber px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <Suspense fallback={<SkeletonDashboard />}>
        {tab === "dashboard" && (
          <Dashboard
            month={month}
            settings={settings}
            refreshSettings={refreshSettings}
            onNavigate={setTab}
            onPendingChange={setPendingCount}
          />
        )}
        {tab === "upload" && (
          <Upload
            month={month}
            onDone={() => {
              setTab("dashboard");
              refreshPendingCount();
            }}
            onNavigate={setTab}
          />
        )}
        {tab === "savings" && (
          <Savings month={month} settings={settings} refreshSettings={refreshSettings} />
        )}
        {tab === "rules" && <Rules />}
        {tab === "accounts" && (
          <Accounts
            settings={settings}
            refreshSettings={refreshSettings}
            onAccountDeleted={async () => {
              try {
                const remaining = await api.getAccounts();
                if (remaining.length === 0) {
                  setOnboardStatus("no_accounts");
                }
              } catch {
                // Ignore refresh errors here.
              }
            }}
          />
        )}
        {tab === "installments" && <Installments month={month} />}
        {tab === "recurring" && <Recurring month={month} />}
      </Suspense>

      <button
        onClick={() => setShowShortcuts(true)}
        title="Atajos de teclado (?)"
        className="fixed bottom-5 right-5 z-40 hidden h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white/92 text-neutral-400 shadow-panel backdrop-blur transition hover:bg-finance-purpleSoft hover:text-finance-purple md:flex dark:border-neutral-700 dark:bg-neutral-900/92 dark:text-neutral-500 dark:hover:bg-neutral-800"
      >
        <HelpIcon />
      </button>
    </div>
  );
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream px-4">
        <div className="max-w-md rounded-[32px] border border-finance-red/30 bg-finance-redSoft p-8 text-center">
          <p className="text-2xl font-bold text-finance-red">Configuracion pendiente</p>
          <p className="mt-3 text-sm text-finance-red/80">
            Falta <code className="rounded bg-finance-red/10 px-1">VITE_CLERK_PUBLISHABLE_KEY</code> en
            el archivo <code>.env</code>.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Copia tu Publishable Key desde Clerk y agregala en <code>client/.env</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      localization={{
        signIn: {
          start: {
            title: "SmartFinance",
            subtitle: "Inicia sesion para continuar",
          },
        },
        signUp: {
          start: {
            title: "SmartFinance",
            subtitle: "Crea tu cuenta para empezar",
          },
        },
      }}
    >
      <ToastProvider>
        <SignedIn>
          <AuthSync />
        </SignedIn>

        <SignedOut>
          <AuthScreen />
        </SignedOut>

        <SignedIn>
          <AppInner />
        </SignedIn>
      </ToastProvider>
    </ClerkProvider>
  );
}
