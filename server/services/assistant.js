const { computeFutureCommitments, computeInsights, computeMonthlyEvolution, computeSummary, getMonthSeries } = require("./metrics");

function extractResponseText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function buildAssistantMetrics(db, month) {
  const summary = computeSummary(db, month);
  const insights = computeInsights(db, month);
  const evolution = computeMonthlyEvolution(db, month, 6);
  const commitments = computeFutureCommitments(db, month, 6);
  const [year, monthIndex] = month.split("-").map(Number);
  const now = new Date();
  const daysInMonth = new Date(year, monthIndex, 0).getDate();
  const isActiveMonth = now.getFullYear() === year && now.getMonth() + 1 === monthIndex;
  const elapsedDays = isActiveMonth ? now.getDate() : daysInMonth;
  const projectedExpenses = Math.round((summary.totals.expenses / Math.max(1, elapsedDays)) * daysInMonth);
  const averageMonthlyExpenses =
    evolution.reduce((sum, item) => sum + item.gastos, 0) / Math.max(1, evolution.length);
  const runwayMonths = averageMonthlyExpenses > 0 ? Number((summary.totals.patrimonio / averageMonthlyExpenses).toFixed(1)) : null;
  const totalBudget = summary.budgets.reduce((sum, item) => sum + Number(item.budget || 0), 0);
  const spendableNow = Math.max(0, summary.totals.income - summary.totals.expenses);

  return {
    month,
    totals: summary.totals,
    deltas: summary.deltas,
    projected_expenses: projectedExpenses,
    average_monthly_expenses: Math.round(averageMonthlyExpenses),
    runway_months: runwayMonths,
    remaining_budget: Math.round(totalBudget - summary.totals.expenses),
    spendable_now: Math.round(spendableNow),
    daily_average_spend: insights.daily_average_spend,
    budget_per_day: insights.budget_per_day,
    days_left: insights.days_left,
    eta_months: insights.eta_months,
    installments_next_months: commitments.slice(0, 3),
    top_categories: summary.byCategory.slice(0, 5).map((item) => ({
      name: item.name,
      spent: Math.round(item.spent),
      budget: Math.round(item.budget || 0),
      type: item.type
    })),
    reference_months: getMonthSeries(6, month)
  };
}

function buildLocalAnswer(question, metrics) {
  const normalizedQuestion = String(question || "").toLowerCase();
  const lines = [];

  if (normalizedQuestion.includes("runway")) {
    lines.push(
      metrics.runway_months != null
        ? `Con tu patrimonio consolidado actual tenés un runway estimado de ${metrics.runway_months} meses usando tu gasto promedio reciente.`
        : "No pude estimar runway porque todavía no hay gasto promedio suficiente para usar como referencia."
    );
  } else {
    lines.push(
      `Este mes llevás ${metrics.totals.expenses} de gasto y, si seguís al mismo ritmo, cerrarías cerca de ${metrics.projected_expenses}.`
    );
  }

  if (normalizedQuestion.includes("gastar") || normalizedQuestion.includes("puedo")) {
    lines.push(`Hoy te queda un margen directo estimado de ${metrics.spendable_now} y un presupuesto restante de ${metrics.remaining_budget}.`);
  } else {
    lines.push(`Tu gasto diario promedio va en ${metrics.daily_average_spend} y el presupuesto disponible por día es ${metrics.budget_per_day}.`);
  }

  if (metrics.installments_next_months.length > 0) {
    lines.push(`Tus próximas cuotas proyectadas arrancan en ${metrics.installments_next_months[0].total} para el siguiente mes.`);
  }

  return lines.join(" ");
}

async function requestOpenAIAnswer(question, metrics) {
  const apiKey = process.env.OPENAI_API_KEY;
  const provider = process.env.ASSISTANT_PROVIDER || "openai";
  if (!apiKey || provider !== "openai") {
    return null;
  }

  const model = process.env.OPENAI_MODEL || "gpt-5";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 350,
      input: [
        {
          role: "developer",
          content: [
            {
              type: "input_text",
              text:
                "Respond in Rioplatense Spanish. Use only the financial context provided. Be concise, practical, and explicit when data is not available. Do not invent transactions or balances."
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Contexto financiero del mes ${metrics.month}:\n${JSON.stringify(metrics, null, 2)}\n\nPregunta del usuario: ${question}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${await response.text()}`);
  }

  const payload = await response.json();
  const answer = extractResponseText(payload);

  return answer
    ? {
        provider: "openai",
        model,
        answer
      }
    : null;
}

async function answerAssistantQuestion(db, month, question) {
  const metrics = buildAssistantMetrics(db, month);

  try {
    const remote = await requestOpenAIAnswer(question, metrics);
    if (remote) {
      return {
        ...remote,
        metrics
      };
    }
  } catch (error) {
    console.error("assistant_openai_error", error);
  }

  return {
    provider: "local-fallback",
    model: null,
    answer: buildLocalAnswer(question, metrics),
    metrics
  };
}

module.exports = {
  answerAssistantQuestion,
  buildAssistantMetrics
};
