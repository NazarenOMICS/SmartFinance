import { useState } from "react";
import { api } from "../api";

const PRESETS = [
  { label: "Cuenta bancaria", icon: "CB", currency: "UYU", idSuffix: "banco" },
  { label: "Tarjeta de credito", icon: "TC", currency: "UYU", idSuffix: "tc" },
  { label: "Efectivo", icon: "EF", currency: "UYU", idSuffix: "efectivo" },
  { label: "Cuenta USD", icon: "US", currency: "USD", idSuffix: "usd" },
];

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 24) || "cuenta";
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
      setError("Ingresa un nombre para la cuenta.");
      return;
    }
    setSaving(true);
    try {
      const id = `${slugify(form.name)}_${Date.now().toString(36)}`;
      const account = await api.createAccount({
        id,
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-finance-cream px-4 py-12">
      <div className="mb-10 flex gap-2">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={`h-1.5 rounded-full transition-all ${index <= step ? "w-10 bg-finance-purple" : "w-4 bg-neutral-200 dark:bg-neutral-700"}`}
          />
        ))}
      </div>

      {step === 0 && (
        <div className="w-full max-w-md text-center">
          <p className="text-5xl">SF</p>
          <h1 className="mt-4 font-display text-5xl text-finance-ink">SmartFinance</h1>
          <p className="mt-4 text-lg text-neutral-500">
            Tu mapa financiero personal. Empezamos desde cero: vos cargas los datos, la app aprende.
          </p>
          <ul className="mt-8 space-y-3 text-left text-sm text-neutral-500">
            {[
              "Subis un PDF, CSV o TXT, o cargas gastos a mano",
              "Categorizas una vez y la app aprende para siempre",
              "Ves en que gastas, cuanto ahorras y cuando llegas a tu meta",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-0.5 text-finance-purple">OK</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={() => setStep(1)}
            className="mt-10 w-full rounded-full bg-finance-purple py-4 text-lg font-semibold text-white transition hover:opacity-90"
          >
            Empezar
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="w-full max-w-md">
          <p className="text-center text-3xl">01</p>
          <h2 className="mt-3 text-center font-display text-4xl text-finance-ink">Tu primera cuenta</h2>
          <p className="mt-2 text-center text-neutral-500">Donde tenes tu plata. Podes agregar mas despues.</p>

          <div className="mt-6 grid grid-cols-2 gap-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.idSuffix}
                onClick={() => applyPreset(preset)}
                className={`rounded-2xl border-2 px-4 py-3 text-left transition ${
                  form.name === preset.label
                    ? "border-finance-purple bg-finance-purpleSoft dark:bg-purple-900/30"
                    : "border-neutral-200 bg-white hover:border-finance-purple/40 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-finance-purple/40"
                }`}
              >
                <span className="text-xl font-semibold">{preset.icon}</span>
                <p className="mt-1 text-sm font-semibold text-finance-ink">{preset.label}</p>
                <p className="text-xs text-neutral-400">{preset.currency}</p>
              </button>
            ))}
          </div>

          <form onSubmit={handleCreateAccount} className="mt-6 space-y-4">
            <input
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-finance-ink dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              placeholder="Nombre (ej: BROU Caja de Ahorro)"
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
                <option value="USD">USD - Dolares</option>
                <option value="ARS">ARS - Pesos AR</option>
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
              {saving ? "Creando..." : "Crear cuenta"}
            </button>
          </form>
        </div>
      )}

      {step === 2 && (
        <div className="w-full max-w-md text-center">
          <p className="text-5xl">02</p>
          <h2 className="mt-4 font-display text-4xl text-finance-ink">
            {createdAccount?.name || "Cuenta"} creada
          </h2>
          <p className="mt-3 text-neutral-500">
            Ahora carga tus primeras transacciones. Podes subir un PDF, CSV o TXT bancario, o agregar gastos a mano.
          </p>

          <div className="mt-8 grid gap-4">
            <button
              onClick={() => onComplete("upload")}
              className="flex items-center gap-4 rounded-[24px] border-2 border-finance-purple bg-finance-purpleSoft px-6 py-5 text-left transition hover:bg-finance-purple/20 dark:bg-purple-900/30 dark:hover:bg-purple-900/40"
            >
              <span className="text-3xl">UP</span>
              <div>
                <p className="font-semibold text-finance-ink">Subir archivo bancario</p>
                <p className="text-sm text-neutral-500">Soporta PDF, CSV y TXT para extraer transacciones</p>
              </div>
            </button>
            <button
              onClick={() => onComplete("upload")}
              className="flex items-center gap-4 rounded-[24px] border-2 border-neutral-200 bg-white px-6 py-5 text-left transition hover:border-finance-purple/40 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-finance-purple/40"
            >
              <span className="text-3xl">+</span>
              <div>
                <p className="font-semibold text-finance-ink">Cargar gasto manualmente</p>
                <p className="text-sm text-neutral-500">Para efectivo, gastos sueltos o sin resumen</p>
              </div>
            </button>
            <button
              onClick={() => onComplete("dashboard")}
              className="mt-2 text-sm text-neutral-400 transition hover:text-neutral-500"
            >
              Ir al Dashboard sin cargar nada por ahora
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
