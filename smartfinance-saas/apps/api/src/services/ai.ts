import { bankFormatSuggestionSchema, uploadImportedTransactionInputSchema } from "@smartfinance/contracts";
import { getRuntimeEnv, type ApiBindings } from "../env";

type AssistantContext = {
  month: string;
  question: string;
  summary: {
    income: number;
    expenses: number;
    margin: number;
    pending_count: number;
    top_categories: Array<{ name: string; spent: number }>;
  };
  savings: {
    eta_months: number | null;
    remaining_budget: number;
    budget_per_day: number;
    daily_average_spend: number;
  };
  recurring: Array<{ desc_banco: string; avg_amount: number; moneda: string }>;
  net_worth: {
    total: number;
    currency: string;
  };
};

type AssistantAnswer = {
  answer: string;
  provider: string;
  model?: string | null;
  fallback_used: boolean;
};

type UploadAiExtractionResult = {
  transactions: Array<{
    fecha: string;
    desc_banco: string;
    monto: number;
    moneda: "UYU" | "USD" | "EUR" | "ARS";
    entry_type?: "expense" | "income";
  }>;
  provider: string;
  model?: string | null;
  fallback_used: boolean;
};

type BankFormatSuggestionResult = {
  format_key?: string | null;
  bank_name?: string | null;
  col_fecha: number;
  col_desc: number;
  col_debit: number;
  col_credit: number;
  col_monto: number;
  confidence: number;
  provider: string;
  model?: string | null;
  fallback_used: boolean;
  notes: string[];
};

type RecurringCategorySuggestion = {
  desc_banco: string;
  suggested_category_id: number | null;
  suggested_category_name: string | null;
  suggested_category_color: string | null;
  suggested_rule_mode: "auto" | "suggest" | null;
  suggestion_confidence: number | null;
  suggestion_reason: string | null;
  suggestion_provider: string | null;
};

type RuleInsightLike = {
  kind: "duplicate_scope" | "overlap" | "weak_auto";
  title: string;
  description: string;
  rule_ids: number[];
  recommended_action: "merge" | "disable" | "lower_to_suggest" | "review";
  priority: "high" | "medium" | "low";
};

type ReviewStateLike = {
  review_groups: Array<Record<string, unknown>>;
  guided_review_groups: Array<Record<string, unknown>>;
  transaction_review_queue: Array<Record<string, unknown>>;
  guided_onboarding_required: boolean;
  remaining_transaction_ids: number[];
};

function buildFallbackAnswer(context: AssistantContext) {
  const topCategory = context.summary.top_categories[0];
  const recurringHint = context.recurring[0]
    ? ` Tu gasto repetido mas visible es ${context.recurring[0].desc_banco} por ${Math.round(context.recurring[0].avg_amount)} ${context.recurring[0].moneda}.`
    : "";
  const categoryHint = topCategory
    ? ` La categoria que mas pesa por ahora es ${topCategory.name} con ${Math.round(topCategory.spent)}.`
    : "";
  const etaHint = context.savings.eta_months != null
    ? ` Si mantenes este ritmo, tu objetivo de ahorro esta a unas ${context.savings.eta_months} proyecciones mensuales.`
    : " Aun no hay suficiente ritmo de ahorro para estimar llegada al objetivo.";

  return [
    `Mes ${context.month}: ingresos ${Math.round(context.summary.income)}, gastos ${Math.round(context.summary.expenses)} y margen ${Math.round(context.summary.margin)}.`,
    `Tenes ${context.summary.pending_count} movimiento(s) pendientes de revisar y un patrimonio consolidado de ${Math.round(context.net_worth.total)} ${context.net_worth.currency}.`,
    `Tu gasto diario promedio va en ${Math.round(context.savings.daily_average_spend)} y te quedan ${Math.round(context.savings.remaining_budget)} de margen, o ${Math.round(context.savings.budget_per_day)} por dia.`,
    categoryHint,
    recurringHint,
    etaHint,
    `Pregunta del usuario: ${context.question}`,
  ].join(" ");
}

function buildPrompt(context: AssistantContext) {
  return [
    "Sos SmartFinance, un asesor financiero personal breve, claro y accionable.",
    "Responde en espanol rioplatense.",
    "No inventes datos. Usa solo el contexto provisto.",
    "Da un resumen corto y luego 2 o 3 recomendaciones concretas.",
    "",
    `Mes: ${context.month}`,
    `Pregunta: ${context.question}`,
    `Ingresos: ${context.summary.income}`,
    `Gastos: ${context.summary.expenses}`,
    `Margen: ${context.summary.margin}`,
    `Pendientes de review: ${context.summary.pending_count}`,
    `Patrimonio consolidado: ${context.net_worth.total} ${context.net_worth.currency}`,
    `Promedio diario: ${context.savings.daily_average_spend}`,
    `Presupuesto restante: ${context.savings.remaining_budget}`,
    `Presupuesto por dia: ${context.savings.budget_per_day}`,
    `ETA ahorro: ${context.savings.eta_months ?? "sin dato"}`,
    `Top categorias: ${context.summary.top_categories.map((item) => `${item.name}=${item.spent}`).join(", ") || "sin datos"}`,
    `Recurrencias: ${context.recurring.map((item) => `${item.desc_banco}=${item.avg_amount} ${item.moneda}`).join(", ") || "sin datos"}`,
  ].join("\n");
}

function defaultGroupReason(group: Record<string, unknown>) {
  const count = Number(group.count || 0);
  const source = String(group.suggestion_source || "");
  if (source === "ollama") {
    return "La IA encontro varias descripciones parecidas y conviene validar el patron antes de automatizarlo.";
  }
  if (source === "history") {
    return `Ya vimos este patron varias veces y suele terminar en la misma categoria (${count} coincidencias).`;
  }
  if (source === "keyword") {
    return "Hay palabras fuertes en la descripcion que apuntan siempre a la misma categoria.";
  }
  return `Encontramos ${count} movimientos parecidos con la misma categoria sugerida.`;
}

function defaultGuidedReason(group: Record<string, unknown>) {
  return Number(group.count || 0) >= 4
    ? "Es un patron fuerte para aprender ahora y ahorrarte review en los proximos uploads."
    : "Conviene confirmarlo ahora para acelerar futuras categorizaciones.";
}

function defaultTransactionReason(transaction: Record<string, unknown>) {
  if (transaction.internal_operation_kind === "fx_exchange") {
    return "Parece una compra o venta de moneda entre tus cuentas; confirmarlo evita que el dashboard cuente esto como gasto real.";
  }
  if (transaction.internal_operation_kind === "internal_transfer") {
    return "Parece una transferencia interna; si la confirmas no va a distorsionar ingresos ni gastos.";
  }
  if (transaction.suggestion_source === "history") {
    return `Encontramos movimientos muy parecidos que terminaste categorizando como ${transaction.suggested_category_name || "esta categoria"}.`;
  }
  if (transaction.suggestion_source === "amount_profile") {
    return `El monto y la contraparte se parecen a pagos anteriores de ${transaction.suggested_category_name || "esta categoria"}.`;
  }
  if (transaction.suggestion_source === "keyword") {
    return "La descripcion tiene palabras muy asociadas a una categoria conocida.";
  }
  if (transaction.suggestion_source === "ollama") {
    return "La IA sugiere esta categoria por el contexto de la descripcion y el monto; conviene revisarla antes de aprenderla.";
  }
  if (transaction.suggested_category_name) {
    return `La mejor sugerencia actual es ${transaction.suggested_category_name}; revisala para que el motor aprenda mejor.`;
  }
  return "Todavia falta contexto para categorizar esto en automatico; una decision tuya mejora el motor para el proximo mes.";
}

function deterministicReviewPriority(transaction: Record<string, unknown>) {
  let score = 0;
  if (transaction.internal_operation_kind) score += 100;
  if (transaction.suggestion_source === "ollama") score += 35;
  if (transaction.suggestion_source === "history") score += 28;
  if (transaction.suggestion_source === "keyword") score += 22;
  if (transaction.suggested_category_id != null) score += 18;
  if (typeof transaction.category_confidence === "number") {
    score += Math.round(Number(transaction.category_confidence) * 20);
  }
  score += Math.min(Math.abs(Number(transaction.monto || 0)) / 200, 15);
  return score;
}

function extractTextFromCloudflareAi(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const objectPayload = payload as Record<string, unknown>;
  if (typeof objectPayload.response === "string" && objectPayload.response.trim()) {
    return objectPayload.response.trim();
  }
  if (typeof objectPayload.result === "object" && objectPayload.result) {
    const resultPayload = objectPayload.result as Record<string, unknown>;
    if (typeof resultPayload.response === "string" && resultPayload.response.trim()) {
      return resultPayload.response.trim();
    }
  }
  return null;
}

function extractJsonBlock(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const objectLike = text.match(/\{[\s\S]*\}/);
  if (objectLike?.[0]) return objectLike[0];
  return text.trim();
}

function normalizeHeader(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTextMatcher(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerScore(header: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(header)) ? 1 : 0;
}

function buildDeterministicBankFormatSuggestion(input: {
  formatKey?: string | null;
  columns: string[];
  sampleRows?: string[][];
  accountCurrency?: string | null;
}): BankFormatSuggestionResult {
  const normalized = input.columns.map((column) => normalizeHeader(column));
  const used = new Set<number>();

  const pickBest = (patterns: RegExp[]) => {
    let bestIndex = -1;
    let bestScore = -1;
    normalized.forEach((header, index) => {
      if (used.has(index)) return;
      const score = headerScore(header, patterns);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestScore <= 0) return -1;
    used.add(bestIndex);
    return bestIndex;
  };

  const colFecha = pickBest([/fecha/, /\bdate\b/, /\bfecha contable\b/, /\bmov\b/]);
  const colDesc = pickBest([/concepto/, /descripcion/, /\bdesc\b/, /detalle/, /narracion/, /comercio/, /referencia/]);
  const colDebit = pickBest([/debito/, /dbito/, /cargo/, /egreso/, /retiro/, /withdrawal/, /\bdebe\b/]);
  const colCredit = pickBest([/credito/, /crdito/, /abono/, /ingreso/, /deposito/, /deposit/, /\bhaber\b/]);
  const colMonto = pickBest([/^monto$/, /^importe$/, /^amount$/, /^valor$/, /saldo/, /importe u?s?\$?/]);

  const sampleText = (input.sampleRows || []).flat().join(" ").toLowerCase();
  let bankName = null;
  if (/itau/.test(sampleText)) bankName = "Itaú";
  else if (/santander/.test(sampleText)) bankName = "Santander";
  else if (/\bbrou\b|banco republica/.test(sampleText)) bankName = "BROU";
  else if (/bbva/.test(sampleText)) bankName = "BBVA";
  else if (/scotiabank/.test(sampleText)) bankName = "Scotiabank";
  else if (/mercado pago/.test(sampleText)) bankName = "Mercado Pago";

  const matchedCount = [colFecha, colDesc, colDebit, colCredit, colMonto].filter((value) => value >= 0).length;
  const notes = [];
  if (colMonto >= 0) notes.push("Detectamos una columna de monto directo.");
  if (colDebit >= 0 || colCredit >= 0) notes.push("Detectamos columnas separadas de debito/credito.");
  if (bankName) notes.push(`Parece un archivo de ${bankName}.`);

  return bankFormatSuggestionSchema.parse({
    format_key: input.formatKey ?? null,
    bank_name: bankName,
    col_fecha: colFecha,
    col_desc: colDesc,
    col_debit: colDebit,
    col_credit: colCredit,
    col_monto: colMonto,
    confidence: Math.min(0.92, matchedCount / 5),
    provider: "deterministic",
    model: null,
    fallback_used: true,
    notes,
  });
}

function buildDeterministicRecurringSuggestion(input: {
  recurring: Array<{ desc_banco: string; occurrences: number; avg_amount: number; months_seen: string[] }>;
  categories: Array<{ id: number; name: string; color?: string | null }>;
}) {
  const aliases = [
    { patterns: ["spotify", "netflix", "youtube", "openai", "chatgpt", "claude", "apple"], slugs: ["suscripciones"] },
    { patterns: ["pedidosya", "rappi", "uber eats"], slugs: ["restaurantes", "delivery"] },
    { patterns: ["mcdonald", "burger", "cafe", "cafeteria", "restaurante", "bar"], slugs: ["restaurantes"] },
    { patterns: ["uber", "cabify", "bolt", "didi", "taxi", "peaje", "combustible", "nafta"], slugs: ["transporte"] },
    { patterns: ["ute", "ose", "antel", "internet", "energia", "agua", "gas"], slugs: ["servicios"] },
    { patterns: ["devoto", "disco", "tienda inglesa", "geant", "supermercado", "frog"], slugs: ["supermercado"] },
    { patterns: ["alquiler", "arrendamiento"], slugs: ["alquiler"] },
    { patterns: ["farmacia", "farmashop", "clinica", "medico", "hospital"], slugs: ["salud"] },
  ];

  const categoriesBySlug = new Map(
    input.categories.map((category) => [normalizeTextMatcher(category.name), category]),
  );

  return input.recurring.map((item) => {
    const normalized = ` ${normalizeTextMatcher(item.desc_banco)} `;
    const alias = aliases.find((candidate) => candidate.patterns.some((pattern) => normalized.includes(` ${normalizeTextMatcher(pattern)} `)));
    const category = alias
      ? alias.slugs
          .map((slug) => categoriesBySlug.get(slug) || input.categories.find((entry) => normalizeTextMatcher(entry.name).includes(slug)) || null)
          .find(Boolean) || null
      : null;

    if (!category) {
      return {
        desc_banco: item.desc_banco,
        suggested_category_id: null,
        suggested_category_name: null,
        suggested_category_color: null,
        suggested_rule_mode: null,
        suggestion_confidence: null,
        suggestion_reason: null,
        suggestion_provider: null,
      } satisfies RecurringCategorySuggestion;
    }

    const confidence = Math.min(0.94, 0.68 + (item.occurrences >= 4 ? 0.14 : 0) + (item.months_seen.length >= 3 ? 0.08 : 0));
    return {
      desc_banco: item.desc_banco,
      suggested_category_id: category.id,
      suggested_category_name: category.name,
      suggested_category_color: category.color ?? null,
      suggested_rule_mode: confidence >= 0.86 ? "auto" : "suggest",
      suggestion_confidence: confidence,
      suggestion_reason: item.occurrences >= 4
        ? "Se repite varios meses y la descripcion coincide fuerte con esta categoria."
        : "Hay un patron recurrente y una coincidencia clara en la descripcion.",
      suggestion_provider: "deterministic",
    } satisfies RecurringCategorySuggestion;
  });
}

function normalizeAiTransactions(rawTransactions: unknown[], period: string) {
  const fallbackYearMonth = String(period || "").split("-");
  const fallbackYear = Number(fallbackYearMonth[0] || 0);
  const fallbackMonth = Number(fallbackYearMonth[1] || 0);

  return rawTransactions
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      let fecha = String(row.fecha || row.date || "").trim();
      if (/^\d{2}\/\d{2}$/.test(fecha) && fallbackYear && fallbackMonth) {
        const [day, month] = fecha.split("/").map(Number);
        fecha = `${fallbackYear}-${String(month || fallbackMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      } else if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(fecha)) {
        const [day, month, yearRaw] = fecha.split("/").map(Number);
        const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
        fecha = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }

      const normalized = {
        fecha,
        desc_banco: String(row.desc_banco || row.descripcion || row.description || "").trim(),
        monto: Number(row.monto ?? row.amount ?? 0),
        moneda: String(row.moneda || row.currency || "UYU").trim().toUpperCase(),
        entry_type: row.entry_type === "income" ? "income" : row.entry_type === "expense" ? "expense" : undefined,
      };

      const parsed = uploadImportedTransactionInputSchema.safeParse(normalized);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

async function runCloudflareAi(env: ApiBindings, context: AssistantContext): Promise<AssistantAnswer | null> {
  if (!env.AI) return null;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return null;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return null;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Sos un asistente financiero de SmartFinance. Responde breve, util y accionable.",
        },
        {
          role: "user",
          content: buildPrompt(context),
        },
      ],
      max_tokens: 500,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return null;
    return {
      answer: text,
      provider: "cloudflare-ai",
      model,
      fallback_used: false,
    };
  } catch {
    return null;
  }
}

export async function generateAssistantAnswer(env: ApiBindings, context: AssistantContext): Promise<AssistantAnswer> {
  const cloudflareAnswer = await runCloudflareAi(env, context);
  if (cloudflareAnswer) return cloudflareAnswer;

  return {
    answer: buildFallbackAnswer(context),
    provider: "deterministic",
    model: null,
    fallback_used: true,
  };
}

export function buildDeterministicAssistantAnswer(context: AssistantContext): AssistantAnswer {
  return {
    answer: buildFallbackAnswer(context),
    provider: "deterministic",
    model: null,
    fallback_used: true,
  };
}

export async function extractTransactionsFromContentWithAi(
  env: ApiBindings,
  input: {
    period: string;
    content: string;
    fileName?: string | null;
    statementCurrency?: string | null;
  },
): Promise<UploadAiExtractionResult | null> {
  if (!env.AI) return null;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return null;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return null;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const prompt = [
    "Extrae transacciones bancarias desde texto crudo.",
    "Responde SOLO JSON valido con esta forma: {\"transactions\":[{\"fecha\":\"YYYY-MM-DD\",\"desc_banco\":\"...\",\"monto\":-1234.56,\"moneda\":\"UYU\"}]}",
    "Reglas:",
    "- gasto = monto negativo",
    "- ingreso = monto positivo",
    "- usa el periodo para completar fechas incompletas",
    "- no inventes transacciones",
    "- si no estas seguro, omite esa linea",
    "",
    `Periodo: ${input.period}`,
    `Archivo: ${input.fileName || "desconocido"}`,
    `Moneda sugerida: ${input.statementCurrency || "UYU"}`,
    "Texto:",
    input.content.slice(0, 12000),
  ].join("\n");

  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Eres un extractor de movimientos bancarios. Devuelve solo JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1800,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return null;
    const parsed = JSON.parse(extractJsonBlock(text)) as { transactions?: unknown[] };
    const transactions = normalizeAiTransactions(Array.isArray(parsed.transactions) ? parsed.transactions : [], input.period);
    if (transactions.length === 0) return null;
    return {
      transactions,
      provider: "cloudflare-ai",
      model,
      fallback_used: false,
    };
  } catch {
    return null;
  }
}

export async function suggestBankFormatMappingWithAi(
  env: ApiBindings,
  input: {
    formatKey?: string | null;
    columns: string[];
    sampleRows?: string[][];
    accountCurrency?: string | null;
    knownFormats?: Array<{
      bank_name?: string | null;
      col_fecha?: number;
      col_desc?: number;
      col_debit?: number;
      col_credit?: number;
      col_monto?: number;
    }>;
  },
): Promise<BankFormatSuggestionResult> {
  const fallback = buildDeterministicBankFormatSuggestion(input);
  if (!env.AI) return fallback;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return fallback;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return fallback;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const prompt = [
    "Sugiere el mapeo de columnas para un CSV bancario.",
    "Devuelve SOLO JSON valido con esta forma:",
    "{\"bank_name\":\"...\",\"col_fecha\":0,\"col_desc\":1,\"col_debit\":2,\"col_credit\":3,\"col_monto\":-1,\"confidence\":0.88,\"notes\":[\"...\"]}",
    "Usa -1 cuando una columna no exista.",
    "No inventes columnas fuera del array.",
    "Prioriza mappings utiles para importar movimientos financieros.",
    `Moneda de la cuenta: ${input.accountCurrency || "desconocida"}`,
    `Columnas: ${JSON.stringify(input.columns)}`,
    `Muestra: ${JSON.stringify((input.sampleRows || []).slice(0, 6))}`,
    `Formatos conocidos del usuario: ${JSON.stringify((input.knownFormats || []).slice(0, 5))}`,
  ].join("\n");

  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Eres un detector de formatos bancarios. Devuelves solo JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 900,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return fallback;

    const parsed = JSON.parse(extractJsonBlock(text)) as Record<string, unknown>;
    const candidate = bankFormatSuggestionSchema.safeParse({
      format_key: input.formatKey ?? null,
      bank_name: typeof parsed.bank_name === "string" ? parsed.bank_name : fallback.bank_name,
      col_fecha: Number.isInteger(parsed.col_fecha) ? parsed.col_fecha : fallback.col_fecha,
      col_desc: Number.isInteger(parsed.col_desc) ? parsed.col_desc : fallback.col_desc,
      col_debit: Number.isInteger(parsed.col_debit) ? parsed.col_debit : fallback.col_debit,
      col_credit: Number.isInteger(parsed.col_credit) ? parsed.col_credit : fallback.col_credit,
      col_monto: Number.isInteger(parsed.col_monto) ? parsed.col_monto : fallback.col_monto,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : Math.max(fallback.confidence, 0.75),
      provider: "cloudflare-ai",
      model,
      fallback_used: false,
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((item): item is string => typeof item === "string").slice(0, 4)
        : fallback.notes,
    });

    if (!candidate.success) return fallback;
    return candidate.data;
  } catch {
    return fallback;
  }
}

export async function suggestRecurringCategoriesWithAi(
  env: ApiBindings,
  input: {
    recurring: Array<{ desc_banco: string; occurrences: number; avg_amount: number; moneda: string; months_seen: string[]; category_name?: string | null }>;
    categories: Array<{ id: number; name: string; color?: string | null }>;
  },
): Promise<RecurringCategorySuggestion[]> {
  const base = buildDeterministicRecurringSuggestion({
    recurring: input.recurring,
    categories: input.categories,
  });

  const unresolved = input.recurring.filter((item) => !item.category_name);
  if (!env.AI || unresolved.length === 0) return base;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return base;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return base;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const prompt = [
    "Sugiere categorias y modo de regla para gastos recurrentes.",
    "Devuelve SOLO JSON con esta forma:",
    "{\"suggestions\":[{\"desc_banco\":\"...\",\"suggested_category_name\":\"...\",\"suggested_rule_mode\":\"auto\",\"suggestion_confidence\":0.91,\"suggestion_reason\":\"...\"}]}",
    "Usa solo categorias existentes.",
    "No inventes categorias ni descripciones.",
    "auto solo si el patron es muy claro y repetido; si no, usa suggest.",
    `Categorias disponibles: ${JSON.stringify(input.categories.map((category) => category.name))}`,
    `Recurrencias: ${JSON.stringify(unresolved.map((item) => ({
      desc_banco: item.desc_banco,
      occurrences: item.occurrences,
      avg_amount: item.avg_amount,
      moneda: item.moneda,
      months_seen: item.months_seen,
    })))}`,
  ].join("\n");

  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Eres un clasificador financiero. Devuelves solo JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1400,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return base;

    const parsed = JSON.parse(extractJsonBlock(text)) as {
      suggestions?: Array<{
        desc_banco?: string;
        suggested_category_name?: string;
        suggested_rule_mode?: string;
        suggestion_confidence?: number;
        suggestion_reason?: string;
      }>;
    };

    const aiByDescription = new Map(
      (parsed.suggestions || [])
        .filter((item) => item.desc_banco && item.suggested_category_name)
        .map((item) => [normalizeTextMatcher(String(item.desc_banco)), item]),
    );

    return base.map((item) => {
      const ai = aiByDescription.get(normalizeTextMatcher(item.desc_banco));
      if (!ai) return item;

      const category = input.categories.find((entry) => normalizeTextMatcher(entry.name) === normalizeTextMatcher(ai.suggested_category_name || ""));
      if (!category) return item;

      return {
        desc_banco: item.desc_banco,
        suggested_category_id: category.id,
        suggested_category_name: category.name,
        suggested_category_color: category.color ?? null,
        suggested_rule_mode: ai.suggested_rule_mode === "auto" ? "auto" : "suggest",
        suggestion_confidence: typeof ai.suggestion_confidence === "number"
          ? Math.max(0.55, Math.min(ai.suggestion_confidence, 0.98))
          : Math.max(item.suggestion_confidence || 0, 0.78),
        suggestion_reason: String(ai.suggestion_reason || item.suggestion_reason || "La IA ve un patron recurrente claro para esta categoria."),
        suggestion_provider: "cloudflare-ai",
      } satisfies RecurringCategorySuggestion;
    });
  } catch {
    return base;
  }
}

export async function enhanceRuleInsightsWithAi(
  env: ApiBindings,
  insights: RuleInsightLike[],
): Promise<RuleInsightLike[]> {
  if (!env.AI || insights.length === 0) return insights;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return insights;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return insights;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const prompt = [
    "Mejora la redaccion de insights sobre reglas de categorizacion.",
    "Devuelve SOLO JSON con esta forma:",
    "{\"insights\":[{\"kind\":\"duplicate_scope\",\"title\":\"...\",\"description\":\"...\",\"priority\":\"high\"}]}",
    "Manten la misma idea. No inventes problemas nuevos.",
    "Escribe en espanol rioplatense, breve y accionable.",
    `Insights: ${JSON.stringify(insights.slice(0, 12))}`,
  ].join("\n");

  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Eres un editor de recomendaciones de producto. Devuelves solo JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1200,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return insights;

    const parsed = JSON.parse(extractJsonBlock(text)) as {
      insights?: Array<{ kind?: string; title?: string; description?: string; priority?: string }>;
    };
    const byKind = new Map(
      (parsed.insights || [])
        .filter((item) => item.kind)
        .map((item) => [String(item.kind), item]),
    );

    return insights.map((insight) => {
      const improved = byKind.get(insight.kind);
      if (!improved) return insight;
      return {
        ...insight,
        title: String(improved.title || insight.title),
        description: String(improved.description || insight.description),
        priority: improved.priority === "high" || improved.priority === "medium" || improved.priority === "low"
          ? improved.priority
          : insight.priority,
      };
    });
  } catch {
    return insights;
  }
}

function applyDeterministicReviewEnhancement(state: ReviewStateLike): ReviewStateLike {
  const reviewGroups: Array<Record<string, unknown>> = [...(state.review_groups || [])]
    .map((group): Record<string, unknown> => ({
      ...group,
      reason: String(group.reason || defaultGroupReason(group)),
    }))
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0));

  const guidedReviewGroups: Array<Record<string, unknown>> = [...(state.guided_review_groups || [])]
    .map((group): Record<string, unknown> => ({
      ...group,
      guided_reason: String(group.guided_reason || defaultGuidedReason(group)),
    }))
    .sort((left, right) => Number(right.count || 0) - Number(left.count || 0));

  const transactionReviewQueue: Array<Record<string, unknown>> = [...(state.transaction_review_queue || [])]
    .map((transaction): Record<string, unknown> => ({
      ...transaction,
      suggestion_reason: String(transaction.suggestion_reason || defaultTransactionReason(transaction)),
    }))
    .sort((left, right) => deterministicReviewPriority(right) - deterministicReviewPriority(left));

  return {
    ...state,
    review_groups: reviewGroups,
    guided_review_groups: guidedReviewGroups,
    transaction_review_queue: transactionReviewQueue,
  };
}

export async function enhanceReviewStateWithAi(env: ApiBindings, state: ReviewStateLike): Promise<ReviewStateLike> {
  const base = applyDeterministicReviewEnhancement(state);
  if (!env.AI) return base;

  const runtime = getRuntimeEnv(env);
  if (runtime.AI_PROVIDER === "disabled") return base;
  if (runtime.AI_PROVIDER !== "auto" && runtime.AI_PROVIDER !== "cloudflare") return base;

  const model = runtime.AI_TEXT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
  const reviewGroups = base.review_groups.slice(0, 8).map((group) => ({
    key: group.key,
    pattern: group.pattern,
    category_name: group.category_name,
    count: group.count,
    reason: group.reason,
  }));
  const transactionQueue = base.transaction_review_queue.slice(0, 10).map((transaction) => ({
    transaction_id: transaction.transaction_id,
    desc_banco: transaction.desc_banco,
    monto: transaction.monto,
    moneda: transaction.moneda,
    suggested_category_name: transaction.suggested_category_name,
    suggestion_source: transaction.suggestion_source,
    internal_operation_kind: transaction.internal_operation_kind,
    suggestion_reason: transaction.suggestion_reason,
  }));

  if (reviewGroups.length === 0 && transactionQueue.length === 0) return base;

  const prompt = [
    "Mejora una cola de revision financiera.",
    "Devuelve SOLO JSON con esta forma:",
    "{\"group_notes\":[{\"key\":\"...\",\"reason\":\"...\",\"guided_reason\":\"...\",\"priority\":\"high|medium|low\"}],\"transaction_notes\":[{\"transaction_id\":1,\"suggestion_reason\":\"...\",\"importance\":10}]}",
    "Escribe razones cortas, concretas y accionables en espanol rioplatense.",
    "No inventes datos fuera del input.",
    `Grupos: ${JSON.stringify(reviewGroups)}`,
    `Transacciones: ${JSON.stringify(transactionQueue)}`,
  ].join("\n");

  try {
    const payload = await env.AI.run(model, {
      messages: [
        {
          role: "system",
          content: "Eres un copiloto de revision financiera. Devuelves solo JSON.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 1500,
    });
    const text = extractTextFromCloudflareAi(payload);
    if (!text) return base;
    const parsed = JSON.parse(extractJsonBlock(text)) as {
      group_notes?: Array<{ key?: string; reason?: string; guided_reason?: string; priority?: string }>;
      transaction_notes?: Array<{ transaction_id?: number; suggestion_reason?: string; importance?: number }>;
    };

    const groupByKey = new Map((parsed.group_notes || []).filter((item) => item.key).map((item) => [String(item.key), item]));
    const transactionById = new Map((parsed.transaction_notes || []).filter((item) => Number.isInteger(item.transaction_id)).map((item) => [Number(item.transaction_id), item]));

    const enhancedGroups = base.review_groups.map((group) => {
      const note = groupByKey.get(String(group.key));
      return note ? {
        ...group,
        reason: note.reason || group.reason,
      } : group;
    });

    const enhancedGuided = base.guided_review_groups.map((group) => {
      const note = groupByKey.get(String(group.key));
      return note ? {
        ...group,
        guided_reason: note.guided_reason || group.guided_reason,
        priority: note.priority || group.priority,
      } : group;
    });

    const enhancedTransactions = base.transaction_review_queue
      .map((transaction) => {
        const note = transactionById.get(Number(transaction.transaction_id));
        return {
          ...transaction,
          suggestion_reason: note?.suggestion_reason || transaction.suggestion_reason,
          __ai_importance: Number(note?.importance || deterministicReviewPriority(transaction)),
        };
      })
      .sort((left, right) => Number((right as { __ai_importance?: number }).__ai_importance || 0) - Number((left as { __ai_importance?: number }).__ai_importance || 0))
      .map(({ __ai_importance, ...transaction }) => transaction);

    return {
      ...base,
      review_groups: enhancedGroups,
      guided_review_groups: enhancedGuided,
      transaction_review_queue: enhancedTransactions,
    };
  } catch {
    return base;
  }
}
