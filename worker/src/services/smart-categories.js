const SMART_CATEGORY_TEMPLATES = [
  {
    key: "dining_out",
    name: "Comer afuera",
    budget: 8000,
    type: "variable",
    color: "#378ADD",
    keywords: ["restaurant", "restaurante", "cafeteria", "cafe", "bar ", "bistro", "mcdonald", "burger", "subway", "starbucks", "mostaza", "la pasiva", "parrilla"],
  },
  {
    key: "delivery",
    name: "Delivery",
    budget: 6000,
    type: "variable",
    color: "#D85A30",
    keywords: ["pedidosya", "rappi", "uber eats", "delivery"],
  },
  {
    key: "streaming",
    name: "Streaming",
    budget: 2500,
    type: "fijo",
    color: "#9B59B6",
    keywords: ["netflix", "spotify", "disney", "hbo", "youtube", "prime video", "deezer", "tidal"],
  },
  {
    key: "telefonia",
    name: "Telefonia",
    budget: 3000,
    type: "fijo",
    color: "#2ECC71",
    keywords: ["antel", "movistar", "claro", "tigo", "telefono", "movil", "celular"],
  },
  {
    key: "gimnasio",
    name: "Gimnasio",
    budget: 3000,
    type: "fijo",
    color: "#E67E22",
    keywords: ["smartfit", "smart fit", "gym", "gimnasio", "fitness", "bodytech"],
  },
  {
    key: "mascotas",
    name: "Mascotas",
    budget: 2000,
    type: "variable",
    color: "#3498DB",
    keywords: ["veterinaria", "veterinar", "pet shop", "laika", "mascota"],
  },
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchSmartCategoryTemplate(descBanco) {
  const normalized = normalizeText(descBanco);
  for (const template of SMART_CATEGORY_TEMPLATES) {
    const keyword = template.keywords.find((item) => normalized.includes(item));
    if (keyword) {
      return { template, keyword };
    }
  }
  return null;
}

export async function ensureSmartCategoriesForTransactions(db, userId, transactions) {
  const matches = transactions
    .map((tx) => matchSmartCategoryTemplate(tx.desc_banco))
    .filter(Boolean);
  if (matches.length === 0) {
    return {};
  }

  const existingCategories = await db.prepare(
    "SELECT id, name FROM categories WHERE user_id = ?"
  ).all(userId);
  const byName = Object.fromEntries(existingCategories.map((row) => [normalizeText(row.name), row]));

  for (const match of matches) {
    const key = normalizeText(match.template.name);
    if (byName[key]) continue;
    const result = await db.prepare(
      "INSERT INTO categories (name, budget, type, color, sort_order, user_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(match.template.name, match.template.budget, match.template.type, match.template.color, 40, userId);
    byName[key] = { id: result.lastInsertRowid, name: match.template.name };
  }

  return byName;
}

export function createReviewGroupTracker() {
  return new Map();
}

export function trackReviewGroup(groups, tx, match, categoryId, transactionId) {
  const groupKey = `${match.template.key}:${match.keyword}`;
  const current = groups.get(groupKey) || {
    key: groupKey,
    pattern: match.keyword,
    category_id: categoryId,
    category_name: match.template.name,
    count: 0,
    transaction_ids: [],
    samples: [],
  };

  current.count += 1;
  current.transaction_ids.push(transactionId);
  if (current.samples.length < 3) {
    current.samples.push(tx.desc_banco);
  }
  groups.set(groupKey, current);
}

export function listReviewGroups(groups) {
  return [...groups.values()].sort((left, right) => right.count - left.count);
}
