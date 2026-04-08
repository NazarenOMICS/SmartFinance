import { useEffect, useState } from "react";
import { api } from "../api";
import MetricCard from "../components/MetricCard";
import { fmtMoney } from "../utils";

const suggestedQuestions = [
  "Como viene mi mes?",
  "Cuanto puedo gastar sin pasarme?",
  "Cual es mi runway?",
  "Que categoria se me esta yendo?"
];

export default function Assistant({ month, dataVersion }) {
  const [question, setQuestion] = useState(suggestedQuestions[0]);
  const [messages, setMessages] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setMessages([]);
    setMetrics(null);
    setError("");
  }, [month, dataVersion]);

  async function handleAsk(nextQuestion) {
    const trimmed = String(nextQuestion || "").trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    setMessages((current) => [...current, { role: "user", text: trimmed }]);

    try {
      const response = await api.assistantChat({ month, question: trimmed });
      setMessages((current) => [...current, { role: "assistant", text: response.answer, provider: response.provider }]);
      setMetrics(response.metrics);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Runway assistant</p>
        <h2 className="font-display text-3xl text-finance-ink">Preguntale al mes</h2>
        <div className="mt-5 flex flex-wrap gap-2">
          {suggestedQuestions.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setQuestion(item);
                handleAsk(item);
              }}
              className="rounded-full bg-finance-cream px-4 py-2 text-sm text-finance-ink"
            >
              {item}
            </button>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleAsk(question);
          }}
          className="mt-5 flex gap-3"
        >
          <input
            className="flex-1 rounded-2xl border border-neutral-200 px-4 py-3"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Preguntame por gastos, runway o margen"
          />
          <button className="rounded-full bg-finance-purple px-5 py-3 font-semibold text-white" disabled={loading}>
            {loading ? "Pensando..." : "Preguntar"}
          </button>
        </form>
        {error ? <div className="mt-4 rounded-2xl bg-finance-redSoft p-4 text-finance-red">{error}</div> : null}
      </div>

      {metrics ? (
        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Gasto proyectado" value={fmtMoney(metrics.projected_expenses)} tone="text-finance-red" />
          <MetricCard label="Margen hoy" value={fmtMoney(metrics.spendable_now)} tone="text-finance-teal" />
          <MetricCard label="Presupuesto restante" value={fmtMoney(metrics.remaining_budget)} tone="text-finance-blue" />
          <MetricCard
            label="Runway"
            value={metrics.runway_months != null ? `${metrics.runway_months} meses` : "No estimable"}
            tone="text-finance-purple"
          />
        </div>
      ) : null}

      <div className="rounded-[32px] border border-white/70 bg-white/90 p-6 shadow-panel">
        <p className="text-xs uppercase tracking-[0.18em] text-neutral-400">Conversacion</p>
        <div className="mt-5 space-y-4">
          {messages.length === 0 ? <p className="text-neutral-500">Todavia no hay preguntas para {month}.</p> : null}
          {messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-3xl px-5 py-4 text-sm ${
                message.role === "user" ? "ml-auto max-w-[80%] bg-finance-purple text-white" : "max-w-[90%] bg-finance-cream text-finance-ink"
              }`}
            >
              <p>{message.text}</p>
              {message.provider ? <p className="mt-2 text-xs uppercase tracking-[0.18em] text-neutral-400">{message.provider}</p> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
