import { useState } from "react";

const steps = [
  {
    title: "Bienvenido a SmartFinance",
    icon: "◈",
    body: "Esta app te ayuda a entender en qué gastás cada mes. Subís el resumen bancario, categorizás los gastos una vez, y la app aprende para la próxima.",
    tip: null
  },
  {
    title: "1. Configurá tus cuentas",
    icon: "◎",
    body: "En la pestaña Cuentas agregá tus tarjetas y cuentas bancarias. Podés poner el balance actual de cada una. El patrimonio total se calcula automáticamente.",
    tip: "Los datos de ejemplo que ves al entrar los podés borrar uno a uno con el botón Borrar de cada cuenta."
  },
  {
    title: "2. Subí un PDF o cargá transacciones",
    icon: "◱",
    body: "En Upload podés arrastrar el PDF de tu resumen bancario. La app extrae las transacciones automáticamente. También podés cargar gastos manualmente (efectivo, notas, etc.).",
    tip: "Si subís el mismo resumen varias veces, los duplicados se detectan automáticamente y no se insertan de nuevo."
  },
  {
    title: "3. Categorizá los gastos",
    icon: "◉",
    body: "Las filas en fondo ámbar del Dashboard son transacciones sin categoría. Usá el selector al lado de cada una para asignarle una categoría. La app crea una regla para no tener que hacerlo la próxima vez.",
    tip: "Cuanto más usás la app, más transacciones se categorizan solas."
  },
  {
    title: "4. Configurá presupuestos y reglas",
    icon: "◈",
    body: "En Reglas configurás cuánto querés gastar por categoría cada mes. El Dashboard te muestra barras de progreso para ver en qué estás a tiempo y en qué te pasaste.",
    tip: "Los gastos fijos (alquiler, servicios) se separan de los variables para que puedas analizar ambos por separado."
  },
  {
    title: "5. Seguí tu ahorro",
    icon: "◌",
    body: "La pestaña Ahorro proyecta cuánto vas a ahorrar en los próximos meses descontando los pagos de cuotas comprometidos. Podés configurar tu objetivo y ver cuándo lo alcanzás.",
    tip: null
  }
];

export default function Tutorial({ onClose }) {
  const [step, setStep] = useState(0);
  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-finance-ink/40 backdrop-blur-sm px-4">
      <div className="w-full max-w-lg rounded-[32px] border border-white/70 bg-white/95 p-8 shadow-2xl">
        {/* Progress dots */}
        <div className="mb-6 flex gap-2">
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-2 rounded-full transition-all ${i === step ? "w-8 bg-finance-purple" : "w-2 bg-neutral-200"}`}
            />
          ))}
        </div>

        <p className="text-4xl">{current.icon}</p>
        <h2 className="mt-3 font-display text-3xl text-finance-ink">{current.title}</h2>
        <p className="mt-4 text-neutral-600 leading-relaxed">{current.body}</p>

        {current.tip && (
          <div className="mt-5 rounded-2xl bg-finance-purpleSoft px-4 py-3 text-sm text-finance-purple">
            <span className="font-semibold">Tip: </span>{current.tip}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between">
          <button
            onClick={onClose}
            className="text-sm text-neutral-400 hover:text-neutral-600 transition"
          >
            Saltar tutorial
          </button>
          <div className="flex gap-3">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="rounded-full border border-neutral-200 px-5 py-2.5 text-sm font-semibold text-finance-ink hover:bg-neutral-50 transition"
              >
                Atrás
              </button>
            )}
            <button
              onClick={() => isLast ? onClose() : setStep((s) => s + 1)}
              className="rounded-full bg-finance-purple px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition"
            >
              {isLast ? "Empezar" : "Siguiente"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
