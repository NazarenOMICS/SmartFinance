const {
  bumpRule,
  findMatchingRule,
  isLikelyEducation,
  isLikelyPersonTransfer,
  isLikelyReintegro,
  isLikelySupernetIncome,
  isLikelyTransfer,
} = require("./categorizer");
const {
  matchCanonicalCategory,
  normalizeText,
} = require("./taxonomy");
const { findGlobalAliasMatch } = require("./global-learning");

const CATEGORY_PROPOSAL_COLORS = [
  "#5B4FCF",
  "#0F9B8E",
  "#F59E0B",
  "#EF4444",
  "#2563EB",
  "#8B5CF6",
  "#14B8A6",
];

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function pickSuggestedColor(categories = []) {
  const used = new Set(categories.map((category) => category.color).filter(Boolean));
  return CATEGORY_PROPOSAL_COLORS.find((color) => !used.has(color)) || CATEGORY_PROPOSAL_COLORS[0];
}

function inferGenericCategoryName(descBanco = "") {
  const desc = ` ${normalizeText(descBanco)} `;
  if ([" ferreteria ", " buloneria ", " tornillo ", " herramientas ", " semar "].some((item) => desc.includes(item))) {
    return "Ferreteria";
  }
  if ([" hogar ", " bazar ", " menaje ", " decoracion "].some((item) => desc.includes(item))) {
    return "Hogar";
  }
  if ([" educuniversida ", " universidad ", " facultad ", " ort ", " curso ", " libreria ", " papeleria "].some((item) => desc.includes(item))) {
    return "Educacion";
  }
  if ([" farmacia ", " farmashop ", " farmacity ", " san roque ", " medico ", " clinica ", " laboratorio "].some((item) => desc.includes(item))) {
    return "Salud";
  }
  if ([" claude ", " anthropic ", " chatgpt ", " openai ", " software ", " saas ", " subscription ", " suscriptio "].some((item) => desc.includes(item))) {
    return "Suscripciones";
  }
  if ([" cafe ", " cafeteria ", " restaurant ", " restaurante ", " bar ", " mcdonald ", " burger ", " mostaza ", " la pasiva "].some((item) => desc.includes(item))) {
    return "Comer afuera";
  }
  if ([" delivery ", " pedidosya ", " rappi ", " uber eats "].some((item) => desc.includes(item))) {
    return "Delivery";
  }
  if ([" uber ", " cabify ", " bolt ", " didi ", " taxi ", " peaje ", " parking "].some((item) => desc.includes(item))) {
    return "Transporte";
  }
  if ([" sube ", " sube viajes ", " emova ", " subte "].some((item) => desc.includes(item))) {
    return "Transporte";
  }
  if ([" disco ", " devoto ", " tienda inglesa ", " frog ", " dorado ", " supermercado "].some((item) => desc.includes(item))) {
    return "Supermercado";
  }
  return "Otros";
}

function buildFallbackCategoryProposal(tx, categories = []) {
  return {
    name: inferGenericCategoryName(tx.desc_banco),
    type: "variable",
    color: pickSuggestedColor(categories),
  };
}

function logCategorizationEvent(db, transactionId, { ruleId = null, categoryId = null, decision, origin = "unknown" }) {
  db.prepare(
    `INSERT INTO categorization_events (transaction_id, rule_id, category_id, decision, origin)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    Number(transactionId),
    ruleId != null ? Number(ruleId) : null,
    categoryId != null ? Number(categoryId) : null,
    decision,
    origin
  );
}

function markTransactionCategorized(db, transactionId, categoryId, options = {}) {
  db.prepare(
    `UPDATE transactions
     SET category_id = ?,
         categorization_status = 'categorized',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ?`
  ).run(
    Number(categoryId),
    options.source || "manual",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId)
  );
}

function markTransactionSuggested(db, transactionId, options = {}) {
  db.prepare(
    `UPDATE transactions
     SET categorization_status = 'suggested',
         category_source = ?,
         category_confidence = ?,
         category_rule_id = ?
     WHERE id = ?`
  ).run(
    options.source || "rule_suggest",
    options.confidence ?? null,
    options.ruleId != null ? Number(options.ruleId) : null,
    Number(transactionId)
  );
}

function clearTransactionCategorization(db, transactionId) {
  db.prepare(
    `UPDATE transactions
     SET category_id = NULL,
         categorization_status = 'uncategorized',
         category_source = NULL,
         category_confidence = NULL,
         category_rule_id = NULL
     WHERE id = ?`
  ).run(Number(transactionId));
}

function buildCategorizationRecord({ categoryId = null, status = "uncategorized", source = null, confidence = null, ruleId = null }) {
  return {
    categoryId: categoryId != null ? Number(categoryId) : null,
    categorizationStatus: status,
    categorySource: source,
    categoryConfidence: confidence,
    categoryRuleId: ruleId != null ? Number(ruleId) : null,
  };
}

function resolveTransactionClassification(db, descBanco, monto, moneda, explicitCategoryId = null) {
  if (explicitCategoryId != null) {
    return buildCategorizationRecord({
      categoryId: explicitCategoryId,
      status: "categorized",
      source: "manual",
    });
  }

  const rule = findMatchingRule(db, descBanco);
  if (rule) {
    bumpRule(db, rule.id);
    if (rule.mode !== "auto") {
      return buildCategorizationRecord({
        status: "suggested",
        source: "rule_suggest",
        confidence: Number(rule.confidence || 0.82),
        ruleId: rule.id,
      });
    }
    return buildCategorizationRecord({
      categoryId: rule.category_id,
      status: "categorized",
      source: "rule_auto",
      confidence: Number(rule.confidence || 0.82),
      ruleId: rule.id,
    });
  }

  if (isLikelyPersonTransfer(descBanco)) {
    const transferCat = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
    if (transferCat) {
      return buildCategorizationRecord({
        categoryId: transferCat.id,
        status: "categorized",
        source: "transfer",
        confidence: 0.96,
      });
    }
  }

  if (isLikelySupernetIncome(descBanco, monto)) {
    const incomeCat = db.prepare("SELECT id FROM categories WHERE name = 'Ingreso'").get();
    if (incomeCat) {
      return buildCategorizationRecord({
        categoryId: incomeCat.id,
        status: "categorized",
        source: "income_operation",
        confidence: 0.95,
      });
    }
  }

  if (isLikelyTransfer(descBanco)) {
    const transferCat = db.prepare("SELECT id FROM categories WHERE name = 'Transferencia'").get();
    if (transferCat) {
      return buildCategorizationRecord({
        categoryId: transferCat.id,
        status: "categorized",
        source: "transfer",
        confidence: 0.97,
      });
    }
  }

  if (isLikelyEducation(descBanco)) {
    const educationCat = db.prepare("SELECT id FROM categories WHERE name = 'Educacion'").get();
    if (educationCat) {
      return buildCategorizationRecord({
        categoryId: educationCat.id,
        status: "categorized",
        source: "education",
        confidence: 0.94,
      });
    }
  }

  if (isLikelyReintegro(db, descBanco, Number(monto), moneda)) {
    const reintegroCat = db.prepare("SELECT id FROM categories WHERE name = 'Reintegro'").get();
    if (reintegroCat) {
      return buildCategorizationRecord({
        categoryId: reintegroCat.id,
        status: "categorized",
        source: "refund",
        confidence: 0.9,
      });
    }
  }

  const globalAlias = findGlobalAliasMatch(db, descBanco);
  if (globalAlias?.category_slug) {
    const category = db.prepare("SELECT id FROM categories WHERE slug = ?").get(globalAlias.category_slug);
    if (category) {
      return buildCategorizationRecord({
        categoryId: category.id,
        status: "suggested",
        source: "global_alias",
        confidence: 0.82,
      });
    }
  }

  return buildCategorizationRecord({});
}

function buildTransactionReviewSuggestion(db, tx, options = {}) {
  const categories = options.categories || db.prepare(
    "SELECT id, name, type, color FROM categories ORDER BY sort_order ASC, id ASC"
  ).all();
  const classification = options.classification || resolveTransactionClassification(
    db,
    tx.desc_banco,
    Number(tx.monto),
    tx.moneda,
    null
  );

  if (classification.categoryId) {
    const category = categories.find((item) => item.id === classification.categoryId) || null;
    return {
      transaction_id: tx.id,
      desc_banco: tx.desc_banco,
      fecha: tx.fecha,
      monto: tx.monto,
      moneda: tx.moneda,
      suggested_category_id: classification.categoryId,
      suggested_category_name: category?.name || null,
      suggestion_source: classification.categorySource || "regla",
      suggestion_reason: "Categoria sugerida por el motor",
      proposed_new_category: null,
    };
  }

  const canonicalMatch = matchCanonicalCategory(tx.desc_banco);
  if (canonicalMatch) {
    const category = categories.find(
      (item) => normalizeText(item.name) === normalizeText(canonicalMatch.category.name)
    );
    if (category) {
      return {
        transaction_id: tx.id,
        desc_banco: tx.desc_banco,
        fecha: tx.fecha,
        monto: tx.monto,
        moneda: tx.moneda,
        suggested_category_id: category.id,
        suggested_category_name: category.name,
        suggestion_source: "heuristica",
        suggestion_reason: `Merchant o keyword claro: ${canonicalMatch.keyword}`,
        proposed_new_category: null,
      };
    }
  }

  const proposedCategory = buildFallbackCategoryProposal(tx, categories);
  const existingCategory = categories.find(
    (item) => normalizeText(item.name) === normalizeText(proposedCategory.name)
  );
  if (existingCategory) {
    return {
      transaction_id: tx.id,
      desc_banco: tx.desc_banco,
      fecha: tx.fecha,
      monto: tx.monto,
      moneda: tx.moneda,
      suggested_category_id: existingCategory.id,
      suggested_category_name: existingCategory.name,
      suggestion_source: "heuristica",
      suggestion_reason: `Sugerencia general hacia ${existingCategory.name}`,
      proposed_new_category: null,
    };
  }
  return {
    transaction_id: tx.id,
    desc_banco: tx.desc_banco,
    fecha: tx.fecha,
    monto: tx.monto,
    moneda: tx.moneda,
    suggested_category_id: null,
    suggested_category_name: proposedCategory.name,
    suggestion_source: "fallback_new_category",
    suggestion_reason: "No hubo categoria existente clara; proponemos crear una nueva.",
    proposed_new_category: proposedCategory,
  };
}

module.exports = {
  buildCategorizationRecord,
  buildTransactionReviewSuggestion,
  clearTransactionCategorization,
  logCategorizationEvent,
  markTransactionCategorized,
  markTransactionSuggested,
  resolveTransactionClassification,
};
