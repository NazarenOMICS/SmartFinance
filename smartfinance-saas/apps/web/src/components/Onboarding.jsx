import { useState } from "react";
import { api } from "../api";
import BrandMark from "./BrandMark";

const PRESETS = [
  { label: "Cuenta bancaria", hint: "Caja de ahorro o cuenta sueldo", currency: "UYU", accent: "bg-finance-purpleSoft text-finance-purple" },
  { label: "Tarjeta de crédito", hint: "Para ver compras y vencimientos", currency: "UYU", accent: "bg-finance-blueSoft text-finance-blue" },
  { label: "Efectivo", hint: "Gastos rápidos y movimientos manuales", currency: "UYU", accent: "bg-finance-amberSoft text-finance-amber" },
  { label: "Cuenta USD", hint: "Ahorro o caja en dólares", currency: "USD", accent: "bg-finance-greenSoft text-finance-green" },
  { label: "Cuenta EUR", hint: "Ahorro o caja en euros", currency: "EUR", accent: "bg-finance-tealSoft text-finance-teal" },
];

const HERO_POINTS = [
  {
    title: "PDF, CSV o carga manual",
    body: "Subís el archivo de tu banco y se extraen las transacciones.",
  },
  {
    title: "Categorizás una vez",
    body: "Asignás la categoría y queda como regla para los meses siguientes.",
  },
  {
    title: "Controlás el mes entero",
    body: "Gastos, presupuestos, cuotas y ahorro en un solo lugar.",
  },
];

const NEXT_STEPS = [
  {
    title: "Subir archivo bancario",
    body: "Importá movimientos desde PDF, CSV o TXT y empezá con datos reales.",
    tone: "border-finance-purple/30 bg-finance-purpleSoft/70",
    accent: "from-finance-purple to-finance-blue",
  },
  {
    title: "Cargar movimiento manual",
    body: "Ideal para efectivo, gastos chicos o ajustes que no vienen en un resumen.",
    tone: "border-neutral-200 bg-white/90 dark:border-neutral-700 dark:bg-neutral-800/90",
    accent: "from-finance-amber to-finance-coral",
  },
];

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" fill="currentColor" />
      <circle cx="18.5" cy="5.5" r="1.5" fill="currentColor" opacity="0.55" />
      <circle cx="6" cy="17.5" r="1.5" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

function LedgerIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10h8M8 14h5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ArrowBurstIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path d="M7 15L17 5M11 5h6v6" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M6 6l2 2M4 12h3M6 18l2-2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" opacity="0.55" />
    </svg>
  );
}

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", currency: "UYU", balance: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdAccount, setCreatedAccount] = useState(null);

  function applyPreset(preset) {
    setForm((prev) => ({ ...prev, name: preset.label, currency: preset.currency }));
  }

  async function handleCreateAccount(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) {
      setError("Ingresá un nombre para la cuenta.");
      return;
    }
    setSaving(true);
    try {
      const account = await api.createAccount({
        name: form.name.trim(),
        currency: form.currency,
        balance: Number(form.balance || 0),
      });
      setCreatedAccount(account);
      setStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-finance-cream px-4 py-12 dark:bg-neutral-950">
      <div className="mb-8 flex gap-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={`h-1.5 rounded-full transition-all ${index <= step ? "w-10 bg-finance-purple" : "w-4 bg-neutral-200 dark:bg-neutral-700"}`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="w-full max-w-5xl rounded-[40px] border border-white/70 bg-white/85 p-6 shadow-panel backdrop-blur md:p-8 dark:border-white/10 dark:bg-neutral-900/85">
          <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full border border-white/80 bg-white/90 px-3 py-2 shadow-sm dark:border-white/10 dark:bg-neutral-800/90">
                <BrandMark size="sm" />
                <div className="text-left">
                  <p className="text-[10px] uppercase tracking-[0.34em] text-neutral-400">SmartFinance</p>
                  <p className="text-sm font-semibold text-finance-ink dark:text-neutral-100">Importá, categorizá, controlá</p>
                </div>
              </div>

              <h1 className="mt-6 max-w-xl font-display text-5xl leading-tight text-finance-ink md:text-6xl dark:text-neutral-100">
                Tus finanzas en orden, mes a mes.
              </h1>
              <p className="mt-4 max-w-xl text-base leading-7 text-neutral-500 dark:text-neutral-300">
                Subís tu extracto bancario, categorizás los gastos una vez y la app aprende para los meses siguientes.
              </p>

              <div className="mt-8 grid gap-3 md:grid-cols-3">
                {HERO_POINTS.map((point, index) => (
                  <div key={point.title} className="rounded-[26px] border border-neutral-200/80 bg-finance-cream/65 p-4 dark:border-neutral-800 dark:bg-neutral-800/70">
                    <div className="mb-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white text-finance-purple shadow-sm dark:bg-neutral-900">
                      {index === 0 ? <ArrowBurstIcon /> : index === 1 ? <SparkIcon /> : <LedgerIcon />}
                    </div>
                    <p className="font-semibold text-finance-ink dark:text-neutral-100">{point.title}</p>
                    <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-300">{point.body}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={() => setStep(1)}
                className="mt-8 inline-flex w-full items-center justify-center rounded-full bg-finance-purple px-6 py-4 text-lg font-semibold text-white transition hover:opacity-90 md:w-auto md:min-w-[220px]"
              >
                Crear cuenta
              </button>
            </div>

            <div className="relative overflow-hidden rounded-[34px] border border-finance-purple/15 bg-[linear-gradient(155deg,_rgba(83,74,183,0.12),_rgba(29,158,117,0.08)_55%,_rgba(255,255,255,0.6))] p-6 dark:border-finance-purple/10 dark:bg-[linear-gradient(155deg,_rgba(83,74,183,0.22),_rgba(29,158,117,0.12)_55%,_rgba(19,19,31,0.88))]">
              <div className="absolute -right-8 top-8 h-28 w-28 rounded-full bg-finance-purple/10 blur-2xl" />
              <div className="absolute -left-10 bottom-0 h-32 w-32 rounded-full bg-finance-teal/10 blur-2xl" />
              <div className="relative">
                <p className="text-xs uppercase tracking-[0.32em] text-neutral-400">Qué resuelve</p>
                <div className="mt-5 space-y-4">
                  {[
                    { kicker: "01", title: "Dejás de armar planillas", body: "La app parsea tu extracto y arma la tabla de movimientos." },
                    { kicker: "02", title: "No repetís trabajo", body: "Las reglas que creás categorizan automático los meses siguientes." },
                    { kicker: "03", title: "Ves dónde estás parado", body: "Presupuestos, tendencias y proyección de ahorro al día." },
                  ].map((item) => (
                    <div key={item.title} className="rounded-[26px] border border-white/70 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-neutral-900/70">
                      <p className="text-[10px] uppercase tracking-[0.28em] text-finance-purple">{item.kicker}</p>
                      <p className="mt-1 font-semibold text-finance-ink dark:text-neutral-100">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-300">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="w-full max-w-5xl rounded-[40px] border border-white/70 bg-white/88 p-6 shadow-panel md:p-8 dark:border-white/10 dark:bg-neutral-900/88">
          <div className="grid gap-8 lg:grid-cols-[0.88fr_1.12fr]">
            <div>
              <div className="inline-flex items-center gap-3 rounded-full bg-finance-purpleSoft/80 px-3 py-2 text-finance-purple dark:bg-purple-900/30 dark:text-purple-300">
                <BrandMark size="sm" className="shadow-none ring-0" />
                <span className="text-xs font-semibold uppercase tracking-[0.24em]">Primer paso</span>
              </div>
              <h2 className="mt-5 font-display text-4xl text-finance-ink dark:text-neutral-100">Definí de dónde sale tu plata.</h2>
              <p className="mt-3 max-w-md text-sm leading-7 text-neutral-500 dark:text-neutral-300">
                Elegí una cuenta base para arrancar. Podés sumar más después, pero con una sola ya alcanza para importar.
              </p>

              <div className="mt-6 rounded-[28px] border border-neutral-200 bg-finance-cream/70 p-5 dark:border-neutral-800 dark:bg-neutral-800/70">
                <p className="text-xs uppercase tracking-[0.22em] text-neutral-400">Consejo</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-300">
                  Si tu primer archivo va a ser una tarjeta, creá primero esa tarjeta. Si venís de banco o sueldo, empezá por la cuenta principal.
                </p>
              </div>
            </div>

            <div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {PRESETS.map((preset, index) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className={`rounded-[26px] border px-4 py-4 text-left transition ${
                      form.name === preset.label
                        ? "border-finance-purple bg-finance-purpleSoft/70 shadow-sm dark:bg-purple-900/30"
                        : "border-neutral-200 bg-white hover:border-finance-purple/35 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-finance-purple/35"
                    }`}
                  >
                    <span className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold ${preset.accent}`}>
                      {index === 0 ? <LedgerIcon /> : index === 1 ? <SparkIcon /> : index === 2 ? <ArrowBurstIcon /> : "$"}
                    </span>
                    <p className="mt-3 font-semibold text-finance-ink dark:text-neutral-100">{preset.label}</p>
                    <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-300">{preset.hint}</p>
                    <p className="mt-3 text-[11px] uppercase tracking-[0.24em] text-neutral-400">{preset.currency}</p>
                  </button>
                ))}
              </div>

              <form onSubmit={handleCreateAccount} className="mt-5 space-y-4 rounded-[28px] border border-neutral-200 bg-white/90 p-5 dark:border-neutral-800 dark:bg-neutral-900/80">
                <input
                  className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  placeholder="Nombre de la cuenta"
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    value={form.currency}
                    onChange={(e) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
                  >
                    <option value="UYU">UYU - Pesos</option>
                    <option value="USD">USD - Dólares</option>
                    <option value="ARS">ARS - Pesos AR</option>
                    <option value="EUR">EUR - Euros</option>
                  </select>
                  <input
                    className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    type="number"
                    placeholder="Balance actual"
                    value={form.balance}
                    onChange={(e) => setForm((prev) => ({ ...prev, balance: e.target.value }))}
                  />
                </div>
                {error && (
                  <p className="rounded-xl bg-finance-redSoft px-4 py-2 text-sm text-finance-red dark:bg-red-900/30 dark:text-red-300">
                    {error}
                  </p>
                )}
                <button
                  disabled={saving}
                  className="w-full rounded-full bg-finance-purple py-4 font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Creando..." : "Crear primera cuenta"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="w-full max-w-4xl rounded-[40px] border border-white/70 bg-white/88 p-6 text-center shadow-panel md:p-8 dark:border-white/10 dark:bg-neutral-900/88">
          <BrandMark size="lg" />
          <p className="mt-5 text-[11px] uppercase tracking-[0.34em] text-finance-purple">Listo para arrancar</p>
          <h2 className="mt-3 font-display text-4xl text-finance-ink dark:text-neutral-100">
            {createdAccount?.name || "Cuenta"} creada
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-neutral-500 dark:text-neutral-300">
            Ahora importá un resumen bancario o cargá algo manual para ver datos reales.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {NEXT_STEPS.map((item, index) => (
              <button
                key={item.title}
                onClick={() => onComplete(index === 0 ? "upload" : "dashboard")}
                className={`group rounded-[30px] border p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${item.tone}`}
              >
                <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm ${item.accent}`}>
                  {index === 0 ? <ArrowBurstIcon /> : <LedgerIcon />}
                </span>
                <p className="mt-4 text-lg font-semibold text-finance-ink dark:text-neutral-100">{item.title}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500 dark:text-neutral-300">{item.body}</p>
                <p className="mt-4 text-xs font-semibold uppercase tracking-[0.24em] text-finance-purple dark:text-purple-300">
                  {index === 0 ? "Importar primero" : "Entrar al dashboard"}
                </p>
              </button>
            ))}
          </div>

          <button
            onClick={() => onComplete("dashboard")}
            className="mt-6 text-sm text-neutral-400 transition hover:text-neutral-500"
          >
            Ir al dashboard sin cargar nada por ahora
          </button>
        </div>
      )}
    </div>
  );
}
