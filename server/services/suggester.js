const { CANONICAL_CATEGORIES, normalizeText } = require("./taxonomy");

function suggestFromKeywords(descBanco) {
  const desc = normalizeText(descBanco);
  for (const category of CANONICAL_CATEGORIES) {
    for (const keyword of category.keywords || []) {
      if (desc.includes(normalizeText(keyword))) {
        return { category_name: category.name, source: "keyword" };
      }
    }
  }
  return null;
}

function suggestSync(tx, rules, categories) {
  if (tx.categorization_status === "categorized") return tx;

  const normalizedDesc = normalizeText(tx.desc_banco);
  const matchedRule = rules.find((rule) => {
    if (rule.mode === "disabled") return false;
    const pattern = normalizeText(rule.normalized_pattern || rule.pattern);
    return pattern && normalizedDesc.includes(pattern);
  });

  if (matchedRule) {
    const category = categories.find((item) => item.id === matchedRule.category_id);
    return {
      ...tx,
      suggestion: {
        category_id: matchedRule.category_id,
        category_name: category?.name || null,
        source: "regla",
        confidence: matchedRule.confidence ?? null,
      }
    };
  }

  const keywordMatch = suggestFromKeywords(tx.desc_banco);
  if (keywordMatch) {
    const category = categories.find(
      (item) => normalizeText(item.name) === normalizeText(keywordMatch.category_name)
    );
    if (category) {
      return {
        ...tx,
        suggestion: {
          category_id: category.id,
          category_name: category.name,
          source: "palabra clave"
        }
      };
    }
  }

  return tx;
}

module.exports = {
  suggestSync,
};
