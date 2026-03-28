const KEYWORD_MAP = [
  {
    keywords: ["disco", "devoto", "tienda inglesa", "geant", "ta-ta", "tata", "multiahorro", "el dorado", "macromercado", "supermercado", "hiper", "almacen", "feria"],
    category: "Supermercado"
  },
  {
    keywords: ["uber", "cabify", "cutcsa", "taxi", "peaje", "ancap", "nafta", "gasolina", "combustible", "bolt", "autobus", "omnibus", "stm "],
    category: "Transporte"
  },
  {
    keywords: ["pedidosya", "rappi", "mcdonald", "mcdonalds", "burguer", "burger", "sushi", "pizza", "parrilla", "restaurant", "restoran", "cafeteria", "bar ", "comida", "delivery"],
    category: "Restaurantes"
  },
  {
    keywords: ["netflix", "spotify", "amazon", "disney", "hbo", "openai", "chatgpt", "youtube", "apple.com", "google play", "playstation", "xbox", "steam", "suscripcion"],
    category: "Suscripciones"
  },
  {
    keywords: ["antel", " ute ", " ose ", "movistar", "claro", "fibra optica", "internet", "telefono", "movil", "celular"],
    category: "Servicios"
  },
  {
    keywords: ["farmacia", "mutualista", "casmu", "hospital", "clinica", "doctor", "medica", "medico", "dentista", "optica", "laboratorio"],
    category: "Salud"
  },
  {
    keywords: ["alquiler", "arrendamiento"],
    category: "Alquiler"
  },
  {
    keywords: ["sueldo", "salario", "haberes", "honorarios", "cobro", "transferencia recibida", "deposito"],
    category: "Ingreso"
  },
];

function suggestFromKeywords(descBanco) {
  const desc = String(descBanco || "").toLowerCase();
  for (const entry of KEYWORD_MAP) {
    for (const keyword of entry.keywords) {
      if (desc.includes(keyword)) {
        return { category_name: entry.category, source: "keyword" };
      }
    }
  }
  return null;
}

function suggestSync(tx, rules, categories) {
  if (tx.category_id) return tx;

  const normalizedDesc = String(tx.desc_banco || "").toLowerCase();
  const matchedRule = rules.find((rule) => normalizedDesc.includes(rule.pattern.toLowerCase()));
  if (matchedRule) {
    const category = categories.find((item) => item.id === matchedRule.category_id);
    return {
      ...tx,
      suggestion: {
        category_id: matchedRule.category_id,
        category_name: category?.name || null,
        source: "regla"
      }
    };
  }

  const keywordMatch = suggestFromKeywords(tx.desc_banco);
  if (keywordMatch) {
    const category = categories.find(
      (item) => item.name.toLowerCase() === keywordMatch.category_name.toLowerCase()
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
