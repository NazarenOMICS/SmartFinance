import { useState } from "react";
import { api } from "../api";

const PRESETS = [
  { label: "Cuenta bancaria", icon: "🏦", currency: "UYU", idSuffix: "banco" },
  { label: "Tarjeta de crédito", icon: "💳", currency: "UYU", idSuffix: "tc" },
  { label: "Efectivo", icon: "💵", currency: "UYU", idSuffix: "efectivo" },
  { label: "Cuenta USD", icon: "🌐", currency: "USD", idSuffix: "usd" },
];

function slugify(str) {
  return str.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 24) || "cuenta";
}

export default function Onboarding({ onComplete }) {
  const [step, setStep] = useState(0); // 0=welcome, 1=account, 2=done
  const [form, setForm] = useState({ name: "", currency: "UYU", balance: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [createdAccount, setCreatedAccount] = useState(null);

  function applyPreset(preset) {
    setForm((p) => ({ ...p, name: preset.label, currency: preset.currency }));
  }

  async function handleCreateAccount(e) {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError("Ingresá un nombre para la cuenta."); return; }
    setSaving(true);
    try {
      const id = slugify(form.name) + "_" + Date.now().toString(36);
      const account = await api.createAccount({
        id,
        name: form.name.trim(),
        currency: form.currency,
        balance: Number(form.balance || 0)
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
      {/* Progress */}
      <div className="mb-10 flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`h-1.5 rounded-full transition-all ${i <= step ? "w-10 bg-finance-purple" : "w-4 bg-neutral-200"}`} />
        ))}
      </div>

      {/* Step 0 — Welcome */}
      {step === 0 && (
        <div className="w-full max-w-md text-center">
          <p className="text-5xl">◈</p>
          <h1 className="mt-4 font-display text-5xl text-finance-ink">SmartFinance</h1>
          <p className="mt-4 text-lg text-neutral-500">Tu mapa financiero personal. Empezamos desde cero — vos cargás los datos, la app aprende.</p>
          <ul className="mt-8 space-y-3 text-left text-sm text-neutral-600">
            {[
              "Subís un PDF o agregás gastos a mano",
              "Categorizás una vez — la app aprende para siempre",
              "Ves en qué gastás, cuánto ahorrás, cuándo llegás a tu meta",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2">
                <span className="mt-0.5 text-finance-purple">✓</span> {line}
              </li>
            ))}
          </ul>
          <button
            onClick={() => setStep(1)}
            className="mt-10 w-full rounded-full bg-finance-purple py-4 font-semibold text-white text-lg hover:opacity-90 transition"
          >
            Empezar →
          </button>
        </div>
      )}

      {/* Step 1 — Create first account */}
      {step === 1 && (
        <div className="w-full max-w-md">
          <p className="text-center text-3xl">◎</p>
          <h2 className="mt-3 text-center font-display text-4xl text-finance-ink">Tu primera cuenta</h2>
          <p className="mt-2 text-center text-neutral-500">Donde tenés tu plata. Podés agregar más después.</p>

          {/* Presets */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.idSuffix}
                onClick={() => applyPreset(preset)}
                className={`rounded-2xl border-2 px-4 py-3 text-left transition ${
                  form.name === preset.label ? "border-finance-purple bg-finance-purpleSoft" : "border-neutral-200 bg-white hover:border-finance-purple/40"
                }`}
              >
                <span className="text-xl">{preset.icon}</span>
                <p className="mt-1 text-sm font-semibold text-finance-ink">{preset.label}</p>
                <p className="text-xs text-neutral-400">{preset.currency}</p>
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleCreateAccount} className="mt-6 space-y-4">
            <input
              className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3"
              placeholder="Nombre (ej: BROU Caja de Ahorro)"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <select
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3"
                value={form.currency}
                onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
              >
                <option value="UYU">UYU — Pesos</option>
                <option value="USD">USD — Dólares</option>
                <option value="ARS">ARS — Pesos AR</option>
              </select>
              <input
                className="rounded-2xl border border-neutral-200 bg-white px-4 py-3"
                type="number"
                placeholder="Balance actual"
                value={form.balance}
                onChange={(e) => setForm((p) => ({ ...p, balance: e.target.value }))}
              />
            </div>
            {error && <p className="rounded-xl bg-finance-redSoft px-4 py-2 text-sm text-finance-red">{error}</p>}
            <button
              disabled={saving}
              className="w-full rounded-full bg-finance-purple py-4 font-semibold text-white hover:opacity-90 transition disabled:opacity-60"
            >
              {saving ? "Creando…" : "Crear cuenta →"}
            </button>
          </form>
        </div>
      )}

      {/* Step 2 — Done, choose next action */}
      {step === 2 && (
        <div className="w-full max-w-md text-center">
          <p className="text-5xl">◉</p>
          <h2 className="mt-4 font-display text-4xl text-finance-ink">
            {createdAccount?.name || "Cuenta"} creada
          </h2>
          <p className="mt-3 text-neutral-500">Ahora cargá tus primeras transacciones. Podés subir un PDF bancario o agregar gastos a mano.</p>

          <div className="mt-8 grid gap-4">
            <button
              onClick={() => onComplete("upload")}
              className="flex items-center gap-4 rounded-[24px] border-2 border-finance-purple bg-finance-purpleSoft px-6 py-5 text-left hover:bg-finance-purple/20 transition"
            >
              <span className="text-3xl">◱</span>
              <div>
                <p className="font-semibold text-finance-ink">Subir PDF o imagen</p>
                <p className="text-sm text-neutral-500">La app extrae las transacciones automáticamente</p>
              </div>
            </button>
            <button
              onClick={() => onComplete("upload")}
              className="flex items-center gap-4 rounded-[24px] border-2 border-neutral-200 bg-white px-6 py-5 text-left hover:border-finance-purple/40 transition"
            >
              <span className="text-3xl">✏</span>
              <div>
                <p className="font-semibold text-finance-ink">Cargar gasto manualmente</p>
                <p className="text-sm text-neutral-500">Para efectivo, gastos sueltos o sin resumen</p>
              </div>
            </button>
            <button
              onClick={() => onComplete("dashboard")}
              className="text-sm text-neutral-400 hover:text-neutral-600 transition mt-2"
            >
              Ir al Dashboard sin cargar nada por ahora
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
