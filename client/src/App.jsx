import { Suspense, lazy, useEffect, useRef, useState } from "react";
import {
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth,
} from "@clerk/clerk-react";
import { api, setTokenGetter } from "./api";
import { ToastProvider } from "./contexts/ToastContext";
import Onboarding from "./components/Onboarding";
import PeriodSelector from "./components/PeriodSelector";
import Tutorial from "./components/Tutorial";
import SearchModal from "./components/SearchModal";
import ShortcutsModal from "./components/ShortcutsModal";
import { SkeletonDashboard } from "./components/SkeletonLoader";
import { isoMonth } from "./utils";

const Dashboard    = lazy(() => import("./pages/Dashboard"));
const Upload       = lazy(() => import("./pages/Upload"));
const Savings      = lazy(() => import("./pages/Savings"));
const Accounts     = lazy(() => import("./pages/Accounts"));
const Installments = lazy(() => import("./pages/Installments"));
const Rules        = lazy(() => import("./pages/Rules"));
const Recurring    = lazy(() => import("./pages/Recurring"));

const TABS = [
  { id: "dashboard",    label: "Dashboard",   icon: "◈" },
  { id: "upload",       label: "Upload",      icon: "↑" },
  { id: "savings",      label: "Ahorro",      icon: "◆" },
  { id: "recurring",    label: "Recurrentes", icon: "↻" },
  { id: "accounts",     label: "Cuentas",     icon: "◎" },
  { id: "installments", label: "Cuotas",      icon: "⧗" },
  { id: "rules",        label: "Reglas",      icon: "⚙" },
];

// ── Injects getToken into the api module ───────────────────────────────────────
function AuthSync() {
  const { getToken } = useAuth();
  useEffect(() => { setTokenGetter(() => getToken()); }, [getToken]);
  return null;
}

// ── Clerk sign-in screen ───────────────────────────────────────────────────────
function AuthScreen() {
  const isDark = localStorage.getItem("sf_dark") === "true";
  return (
    <div className={`flex min-h-screen flex-col items-center justify-center gap-6 bg-finance-cream px-4 dark:bg-neutral-950 ${isDark ? "dark" : ""}`}>
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">SmartFinance</p>
        <h1 className="mt-1 font-display text-4xl text-finance-ink dark:text-neutral-100">
          Tu mapa financiero
        </h1>
        <p className="mt-2 text-sm text-neutral-500">Iniciá sesión para continuar</p>
      </div>
      <SignIn
        appearance={{
          elements: {
            card: "shadow-panel rounded-[28px] border border-white/70 dark:border-white/10",
            headerTitle: "font-display text-2xl text-finance-ink",
            formButtonPrimary: "bg-finance-purple hover:opacity-90 rounded-full",
            footer: "hidden",
          },
        }}
      />
    </div>
  );
}

// ── Main app (authenticated) ──────────────────────────────────────────────────
function AppInner() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [tab, setTab]           = useState("dashboard");
  const [month, setMonth]       = useState(isoMonth());
  const [settings, setSettings] = useState({});
  const [showTutorial, setShowTutorial]   = useState(false);
  const [showSearch,   setShowSearch]     = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [dark, setDark]         = useState(() => localStorage.getItem("sf_dark") === "true");
  const [pendingCount, setPendingCount]   = useState(0);

  // Onboarding states
  // Initialize from localStorage so F5 doesn't re-show the wizard for returning users.
  const [onboardStatus, setOnboardStatus] = useState(null); // null=checking, "done", "no_accounts"

  function markDone() {
    if (userId) localStorage.setItem(`sf_onboard_${userId}`, "done");
    setOnboardStatus("done");
  }
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [claimingLegacy, setClaimingLegacy]   = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const settingsRequestIdRef = useRef(0);
  const pendingRequestIdRef = useRef(0);

  // Apply dark mode class
  useEffect(() => {
    if (dark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
    localStorage.setItem("sf_dark", dark);
  }, [dark]);

  // Dynamic page title
  useEffect(() => {
    const titles = { dashboard: "Dashboard", upload: "Upload", savings: "Ahorro", accounts: "Cuentas", installments: "Cuotas", rules: "Reglas", recurring: "Recurrentes" };
    document.title = `${titles[tab] || tab} — SmartFinance`;
  }, [tab]);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const inInput = ["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName);
      if (e.key === "Escape") {
        if (showSearch)    { setShowSearch(false);    return; }
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (showTutorial)  { setShowTutorial(false);  return; }
      }
      if (inInput) return;
      if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); setShowSearch(true); return; }
      if (e.key === "?" || e.key === "/h") { setShowShortcuts(true); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch, showShortcuts, showTutorial]);

  async function refreshSettings() {
    const requestId = ++settingsRequestIdRef.current;
    const s = await api.getSettings();
    if (settingsRequestIdRef.current !== requestId) return s;
    setSettings(s);
    return s;
  }

  async function refreshPendingCount(targetMonth = month) {
    const requestId = ++pendingRequestIdRef.current;
    try {
      const summary = await api.getSummary(targetMonth);
      if (pendingRequestIdRef.current !== requestId) return;
      setPendingCount(summary.pending_count || 0);
    } catch { /* silent */ }
  }

  // Called once after auth is ready — runs onboarding check
  async function initApp(attempt = 0) {
    const MAX_RETRIES = 3;
    const cachedDone = userId && localStorage.getItem(`sf_onboard_${userId}`) === "done";

    // Fast path: keep the app responsive for returning users, but still
    // reconcile with the API so stale local state does not hide onboarding
    // or mask a backend outage.
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
        const isNetworkError =
          e.message?.toLowerCase().includes("fetch") ||
          e.message?.toLowerCase().includes("network") ||
          e.message?.toLowerCase().includes("failed to fetch");

        if (isNetworkError) {
          setApiDown(true);
        } else if (attempt < MAX_RETRIES) {
          const delay = 500 * (attempt + 1);
          setTimeout(() => initApp(attempt + 1), delay);
        }
      }
      return;
    }

    try {
      // 1. Run onboard (creates default categories + settings if new user)
      const onboardResult = await api.onboard();

      // 2. Check if there's legacy (pre-auth) data to claim
      if (onboardResult.status === "created") {
        try {
          await api.claimLegacy();
          setLegacyAvailable(false);
        } catch { /* no legacy data, that's fine */ }
      }

      // 3. Load settings
      await refreshSettings();

      // 4. Check accounts to determine if we show onboarding wizard
      const accounts = await api.getAccounts();
      setApiDown(false);
      if (accounts.length > 0) {
        markDone();
      } else {
        setOnboardStatus("no_accounts");
      }
    } catch (e) {
      const isNetworkError =
        e.message?.toLowerCase().includes("fetch") ||
        e.message?.toLowerCase().includes("network") ||
        e.message?.toLowerCase().includes("failed to fetch");

      if (isNetworkError) {
        // True connectivity failure — show the "API down" screen
        setApiDown(true);
        setOnboardStatus("no_accounts");
      } else if (attempt < MAX_RETRIES) {
        // Likely a 401 token-not-ready race — retry with backoff
        const delay = 500 * (attempt + 1); // 500ms, 1000ms, 1500ms
        setTimeout(() => initApp(attempt + 1), delay);
      } else {
        // Exhausted retries — auth token likely not ready yet.
        // Fall through to the app rather than forcing the onboarding wizard.
        setApiDown(false);
        setOnboardStatus("done");
      }
    }
  }

  useEffect(() => {
    if (isLoaded && isSignedIn && userId) initApp();
  }, [isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if (onboardStatus === "done") refreshPendingCount();
  }, [month, tab, onboardStatus]);

  function handleNavigateToMonth(targetMonth) {
    setMonth(targetMonth);
    setTab("dashboard");
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (!isLoaded || onboardStatus === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream dark:bg-neutral-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-finance-purple border-t-transparent" />
          <p className="text-sm text-neutral-400">Conectando…</p>
        </div>
      </div>
    );
  }

  // ── API down ───────────────────────────────────────────────────────────
  if (apiDown) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-finance-cream px-4 dark:bg-neutral-950">
        <p className="text-4xl">⚠</p>
        <p className="text-xl font-semibold text-finance-ink">No se puede conectar al servidor</p>
        <p className="max-w-sm text-center text-neutral-500">Verificá tu conexión a internet e intentá de nuevo.</p>
        <button onClick={initApp} className="mt-2 rounded-full bg-finance-purple px-6 py-3 font-semibold text-white hover:opacity-90">
          Reintentar
        </button>
      </div>
    );
  }

  // ── Onboarding ─────────────────────────────────────────────────────────
  if (onboardStatus === "no_accounts") {
    return (
      <Onboarding onComplete={(nextTab = "dashboard") => {
        markDone();
        setTab(nextTab === "upload" ? "upload" : "dashboard");
        refreshSettings().catch(() => {});
      }} />
    );
  }

  // ── Main app ───────────────────────────────────────────────────────────
  return (
    <div className="mx-auto min-h-screen max-w-7xl px-4 py-8 md:px-6 lg:px-8">
      {showTutorial  && <Tutorial onClose={() => setShowTutorial(false)} />}
      {showSearch    && <SearchModal onClose={() => setShowSearch(false)} onNavigateToMonth={handleNavigateToMonth} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      <header className="mb-8 rounded-[36px] border border-white/70 bg-white/80 p-5 shadow-panel backdrop-blur md:p-6 dark:border-white/10 dark:bg-neutral-900/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">SmartFinance</p>
            <h1 className="mt-1.5 font-display text-4xl text-finance-ink md:text-5xl">Tu mapa financiero mensual</h1>
            <p className="mt-2 hidden max-w-2xl text-sm text-neutral-500 md:block">
              PDFs, deduplicación, reglas aprendidas y una vista clara del mes para decidir rápido.
            </p>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Global search */}
            <button
              onClick={() => setShowSearch(true)}
              title="Búsqueda global (Ctrl+K)"
              className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              <span>⌕</span>
              <span className="hidden sm:inline">Buscar</span>
              <kbd className="hidden rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-400 sm:inline dark:border-neutral-700 dark:bg-neutral-900">⌃K</kbd>
            </button>

            {/* Dark mode */}
            <button
              onClick={() => setDark(!dark)}
              title={dark ? "Modo claro" : "Modo oscuro"}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              {dark ? "☀" : "☽"}
            </button>

            {/* Help */}
            <button
              onClick={() => setShowTutorial(true)}
              title="Ayuda"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 bg-white font-bold text-neutral-500 transition hover:bg-finance-purpleSoft hover:text-finance-purple dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
            >
              ?
            </button>

            <PeriodSelector month={month} onChange={setMonth} />

            {/* Clerk user button (avatar + sign out) */}
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "h-10 w-10 rounded-full border border-neutral-200 dark:border-neutral-700",
                },
              }}
            />
          </div>
        </div>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1 scrollbar-none md:gap-3">
          {TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`relative shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
                tab === item.id
                  ? "bg-finance-purple text-white"
                  : "bg-finance-cream text-finance-ink hover:bg-white dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
              }`}
            >
              <span className="text-[11px] opacity-70">{item.icon}</span>
              {item.label}
              {item.id === "dashboard" && pendingCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-finance-amber text-[10px] font-bold text-white">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <Suspense fallback={<SkeletonDashboard />}>
        {tab === "dashboard"    && <Dashboard    month={month} settings={settings} refreshSettings={refreshSettings} onNavigate={setTab} onPendingChange={setPendingCount} />}
        {tab === "upload"       && <Upload       month={month} onDone={() => { setTab("dashboard"); refreshPendingCount(); }} />}
        {tab === "savings"      && <Savings      month={month} settings={settings} refreshSettings={refreshSettings} />}
        {tab === "accounts"     && <Accounts     settings={settings} refreshSettings={refreshSettings} onAccountDeleted={async () => {
          try {
            const remaining = await api.getAccounts();
            if (remaining.length === 0) setOnboardStatus("no_accounts");
          } catch { /* silent */ }
        }} />}
        {tab === "installments" && <Installments month={month} />}
        {tab === "rules"        && <Rules />}
        {tab === "recurring"    && <Recurring    month={month} />}
      </Suspense>

      {/* Floating keyboard shortcuts hint */}
      <button
        onClick={() => setShowShortcuts(true)}
        title="Atajos de teclado (?)"
        className="fixed bottom-5 right-5 z-40 hidden h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white/90 text-sm font-bold text-neutral-400 shadow-panel backdrop-blur transition hover:bg-finance-purpleSoft hover:text-finance-purple md:flex dark:border-neutral-700 dark:bg-neutral-900/90 dark:text-neutral-500 dark:hover:bg-neutral-800"
      >
        ?
      </button>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export default function App() {
  if (!PUBLISHABLE_KEY) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-finance-cream">
        <div className="max-w-md rounded-2xl border border-finance-red/30 bg-finance-redSoft p-8 text-center">
          <p className="text-2xl font-bold text-finance-red">Configuración pendiente</p>
          <p className="mt-3 text-sm text-finance-red/80">
            Falta <code className="rounded bg-finance-red/10 px-1">VITE_CLERK_PUBLISHABLE_KEY</code> en el archivo <code>.env</code>.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Copiá tu Publishable Key desde el dashboard de Clerk y agregala al archivo <code>client/.env</code>.
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
            subtitle: "Iniciá sesión para continuar",
          },
        },
        signUp: {
          start: {
            title: "SmartFinance",
            subtitle: "Creá tu cuenta para empezar",
          },
        },
      }}
    >
      <ToastProvider>
        {/* Inject token getter into api.js */}
        <SignedIn>
          <AuthSync />
        </SignedIn>

        {/* Sign-in screen */}
        <SignedOut>
          <AuthScreen />
        </SignedOut>

        {/* Main app (only renders when signed in) */}
        <SignedIn>
          <AppInner />
        </SignedIn>
      </ToastProvider>
    </ClerkProvider>
  );
}
