function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}${path}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function suggestCategoryWithOllama(settings, payload) {
  const enabled = String(settings.categorizer_ollama_enabled || "0") === "1";
  const baseUrl = String(settings.categorizer_ollama_url || "").trim();
  const model = String(settings.categorizer_ollama_model || "").trim();

  if (!enabled || !baseUrl || !model) {
    return null;
  }

  const categoryNames = payload.categories
    .map((category) => `${category.name} (${category.slug || category.type || "general"})`)
    .join(", ");

  const prompt = [
    "Eres un clasificador de gastos personales.",
    "Prioriza siempre categorias existentes. Solo propone una categoria nueva si ninguna encaja razonablemente.",
    "Nunca mezcles dominios incompatibles: salud no es transporte, transporte no es supermercado, software no es supermercado.",
    "Si la descripcion es ambigua, no auto-categorices.",
    "Responde SOLO JSON con las claves: category_name, proposed_category_name, proposed_category_type, confidence, should_auto, reason.",
    `Categorias disponibles: ${categoryNames}`,
    `Descripcion bancaria: ${payload.desc_banco}`,
    `Monto: ${payload.monto}`,
    `Moneda: ${payload.moneda}`,
    `Cuenta: ${payload.account_name || "sin cuenta"}`,
    "Si propones categoria nueva, proposed_category_type debe ser 'variable' o 'fijo'.",
    "Si la descripcion es ambigua, confidence debe ser baja y category_name debe ser null.",
  ].join("\n");

  try {
    const response = await fetch(joinUrl(baseUrl, "/api/generate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        format: "json",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const parsed = safeJsonParse(data?.response || "");
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const confidence = Number(parsed.confidence);
    return {
      category_name: parsed.category_name ? String(parsed.category_name).trim() : null,
      proposed_category_name: parsed.proposed_category_name ? String(parsed.proposed_category_name).trim() : null,
      proposed_category_type: parsed.proposed_category_type ? String(parsed.proposed_category_type).trim() : null,
      confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
      should_auto: Boolean(parsed.should_auto),
      reason: parsed.reason ? String(parsed.reason).trim() : "",
    };
  } catch {
    return null;
  }
}
