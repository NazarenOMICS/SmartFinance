function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function extractJsonObject(raw) {
  const text = String(raw || "");
  return safeJsonParse(text) || safeJsonParse(text.match(/\{[\s\S]*\}/)?.[0] || "");
}

function normalizeDecision(value) {
  return ["insert", "needs_review", "reject"].includes(value) ? value : "needs_review";
}

function localVerification(candidate, reason = "ai_not_configured") {
  if (candidate.import_kind === "visual_summary_or_chart") {
    return {
      provider: "local",
      decision: "reject",
      confidence: 0.9,
      reason: "La imagen parece un resumen o grafico, no un comprobante de gasto.",
      warnings: [reason],
      best_transaction: null,
    };
  }

  if (candidate.import_kind === "visual_single_transaction" && candidate.confidence >= 0.86 && candidate.total && candidate.merchant_name) {
    return {
      provider: "local",
      decision: "insert",
      confidence: candidate.confidence,
      reason: "Reglas deterministicas de alta confianza; IA remota no disponible.",
      warnings: [reason],
      best_transaction: null,
    };
  }

  return {
    provider: "local",
    decision: "needs_review",
    confidence: candidate.confidence || 0,
    reason: "La IA de verificacion no esta disponible y las reglas no alcanzan alta confianza.",
    warnings: [reason],
    best_transaction: null,
  };
}

async function requestNvidiaVerification(candidate, ocrResult, context) {
  const apiKey = String(process.env.NVIDIA_API_KEY || "").trim();
  const baseUrl = String(process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = String(process.env.VISUAL_AI_MODEL || process.env.NVIDIA_MODEL || "").trim();
  if (!apiKey || !model) return null;

  const prompt = [
    "Sos el verificador de importacion financiera de Genio.",
    "Debes decidir si un OCR de boleta, comprobante o screenshot representa una transaccion unica insertable.",
    "Tambien debes rechazar graficos, resumenes, homes o pantallas sin gasto principal claro.",
    "Devolve SOLO JSON valido con esta forma exacta:",
    "{\"decision\":\"insert|needs_review|reject\",\"reason\":\"...\",\"confidence\":0.0,\"warnings\":[\"...\"],\"best_transaction\":{\"fecha\":\"YYYY-MM-DD\",\"desc_banco\":\"...\",\"monto\":-123.45,\"moneda\":\"UYU\"}}",
    "Usa monto negativo para gastos. No inventes comercio, fecha ni monto. Si hay contradiccion o varios montos principales, usa needs_review.",
    `Contexto: ${JSON.stringify(context)}`,
    `Candidato por reglas: ${JSON.stringify(candidate)}`,
    `Texto OCR: ${String(ocrResult.raw_text || "").slice(0, 6000)}`,
    `Bloques OCR resumidos: ${JSON.stringify((ocrResult.blocks || []).slice(0, 80))}`,
  ].join("\n");

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content: "Respond only with strict JSON. Do not wrap in markdown.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`nvidia_http_${response.status}`);
  }

  const data = await response.json();
  const raw = String(data?.choices?.[0]?.message?.content || "");
  const parsed = extractJsonObject(raw);
  if (!parsed) throw new Error("ai_invalid_json");
  return {
    provider: "nvidia",
    model,
    decision: normalizeDecision(parsed.decision),
    reason: String(parsed.reason || "").slice(0, 500),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 5) : [],
    best_transaction: parsed.best_transaction || null,
  };
}

async function verifyVisualCandidate(candidate, ocrResult, context = {}) {
  const enabled = String(process.env.VISUAL_AI_VERIFY || "1").trim() !== "0";
  if (!enabled) return localVerification(candidate, "ai_verification_disabled");

  try {
    const remote = await requestNvidiaVerification(candidate, ocrResult, context);
    if (remote) return remote;
    return localVerification(candidate, "ai_not_configured");
  } catch (error) {
    return localVerification(candidate, error.message || "ai_verification_failed");
  }
}

module.exports = {
  verifyVisualCandidate,
};
