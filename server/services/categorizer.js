// Keywords that strongly indicate a refund/reversal regardless of amount
const REINTEGRO_KEYWORDS = [
  "devolucion", "devol", "reintegro", "reversa", "reverso",
  "acreditacion devol", "cashback", "contracargo", "reversal"
];

// Small-income thresholds per currency (amounts below these are flagged as
// potential reintegros when no rule already covers them as "Ingreso").
// Typical Uruguayan cashback/refunds top out around $100-200 UYU.
const REINTEGRO_THRESHOLDS = { UYU: 200, USD: 5, ARS: 1000 };

function getRules(db) {
  return db
    .prepare(
      `
      SELECT id, pattern, category_id, match_count
      FROM rules
      ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC
    `
    )
    .all();
}

function findMatchingRule(db, descBanco) {
  const normalized = String(descBanco || "").toLowerCase();
  return getRules(db).find((rule) => normalized.includes(rule.pattern.toLowerCase())) || null;
}

/**
 * Decide whether a positive transaction is likely a reintegro/refund.
 * Returns true when:
 *   - description contains a refund keyword, OR
 *   - amount is below the small-income threshold for the currency AND
 *     no rule maps the description to "Ingreso"
 */
function isLikelyReintegro(db, descBanco, monto, moneda) {
  if (monto <= 0) return false; // only positive amounts can be reintegros

  const normalized = String(descBanco || "").toLowerCase();

  // Keyword match — strong signal
  if (REINTEGRO_KEYWORDS.some((kw) => normalized.includes(kw))) return true;

  // Amount below threshold — weak signal, only if not classified as Ingreso
  const threshold = REINTEGRO_THRESHOLDS[moneda] ?? REINTEGRO_THRESHOLDS.UYU;
  if (monto < threshold) {
    // Check if a rule already maps this to an "Ingreso" category
    const rule = findMatchingRule(db, descBanco);
    if (rule) {
      const cat = db.prepare("SELECT name FROM categories WHERE id = ?").get(rule.category_id);
      if (cat?.name === "Ingreso") return false; // explicitly classified as income
    }
    return true;
  }

  return false;
}

function bumpRule(db, ruleId) {
  db.prepare("UPDATE rules SET match_count = match_count + 1 WHERE id = ?").run(ruleId);
}

function buildPatternFromDescription(descBanco) {
  const stopwords = new Set([
    "pos",
    "compra",
    "debito",
    "deb",
    "automatico",
    "transferencia",
    "recibida",
    "pago",
    "cuota",
    "trip"
  ]);

  const cleaned = String(descBanco || "")
    .replace(/[*#]/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned
    .split(" ")
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2 && !stopwords.has(token));

  return tokens.slice(0, 2).join(" ").trim() || cleaned.split(" ").slice(0, 2).join(" ").trim();
}

function ensureRuleForManualCategorization(db, descBanco, categoryId) {
  const existing = db
    .prepare(
      `
      SELECT id, pattern, category_id
      FROM rules
      WHERE ? LIKE '%' || pattern || '%'
         OR LOWER(?) LIKE '%' || LOWER(pattern) || '%'
      ORDER BY LENGTH(pattern) DESC, match_count DESC, id ASC
      LIMIT 1
    `
    )
    .get(descBanco, descBanco);

  if (existing) {
    if (existing.category_id !== Number(categoryId)) {
      return { created: false, conflict: true, rule: existing };
    }
    return { created: false, conflict: false, rule: existing };
  }

  const pattern = buildPatternFromDescription(descBanco);
  if (!pattern) {
    return { created: false, conflict: false, rule: null };
  }

  const result = db
    .prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)")
    .run(pattern, categoryId);

  // Instead of silently applying retroactively, find candidates for user confirmation
  const candidates = findCandidatesForRule(db, pattern, categoryId);
  return {
    created: true,
    conflict: false,
    candidates_count: candidates.length,
    rule: { id: result.lastInsertRowid, pattern, category_id: Number(categoryId) }
  };
}

/**
 * Find uncategorized transactions that match a rule pattern.
 * Returns them as candidates for the user to confirm, NOT auto-applied.
 */
function findCandidatesForRule(db, pattern, categoryId) {
  return db
    .prepare(
      `SELECT t.id, t.fecha, t.desc_banco, t.monto, t.moneda,
              a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       WHERE t.category_id IS NULL
         AND LOWER(t.desc_banco) LIKE '%' || LOWER(?) || '%'
       ORDER BY t.fecha DESC
       LIMIT 50`
    )
    .all(pattern);
}

/**
 * Get candidates for a specific rule pattern (for the frontend to show).
 */
function getCandidatesForPattern(db, pattern, categoryId) {
  return findCandidatesForRule(db, pattern, categoryId);
}

/**
 * Apply a rule pattern retroactively to all uncategorized transactions.
 * Returns the number of transactions updated.
 */
function applyRuleRetroactively(db, pattern, categoryId) {
  const result = db
    .prepare(
      `UPDATE transactions SET category_id = ?
       WHERE category_id IS NULL
         AND LOWER(desc_banco) LIKE '%' || LOWER(?) || '%'`
    )
    .run(Number(categoryId), pattern);
  return result.changes;
}

// ─── Transfer / currency-exchange detection ───────────────────────────────────
//
// These keywords indicate an inter-account or currency-exchange operation that
// should NOT count as income or expense (just money moving between pockets).
// Ordered from most-specific to most-generic to minimise false positives.
//
const TRANSFER_KEYWORDS = [
  // ── BROU Supernet currency / FX operations ─────────────────────────────────
  // "SUPERNET TC 45.20 COMPRA USD 1000" — the TC prefix is definitive
  "supernet tc",
  // ── Generic FX purchase / sale phrases (all banks) ─────────────────────────
  // These multi-word phrases are specific enough to avoid false positives
  // with merchant names (e.g. "MERCADOPAGO COMPRA USD" would match "supernet tc"
  // if from BROU, or "compra de dolares" / "compra dolares" for other banks).
  // Deliberately NOT including bare "compra usd" / "venta usd" because a
  // USD e-commerce charge can contain those words without being an FX op.
  "compra de dolares",
  "venta de dolares",
  "compra dolares",
  "venta dolares",
  "compra divisa",
  "venta divisa",
  "compra moneda extranjera",
  "venta moneda extranjera",
  "cambio divisas",
  "cambio de moneda",
  "operacion tc",
  "operacion de cambio",
  "tc compra",
  "tc venta",
  // ── Internal / own-account transfers ───────────────────────────────────────
  "transferencia propia",
  "transferencia entre cuentas",
  "transferencia interna",
  "movimiento entre cuentas",
  "debito transferencia interna",
];

/**
 * Returns true when the transaction looks like an inter-account transfer or
 * currency exchange (SUPERNET TC, COMPRA USD, etc.) and should therefore be
 * excluded from income/expense totals.
 */
function isLikelyTransfer(descBanco) {
  const normalized = String(descBanco || "").toLowerCase();
  return TRANSFER_KEYWORDS.some((kw) => normalized.includes(kw));
}

// ─── Default rules for Uruguayan market ──────────────────────────────────────

const DEFAULT_RULES = [
  // ── Supermercados ────────────────────────────────────────────────────────
  { pattern: "DISCO",              category: "Supermercado" },
  { pattern: "TIENDA INGLESA",     category: "Supermercado" },
  { pattern: "MACROMARKET",        category: "Supermercado" },
  { pattern: "GEANT",              category: "Supermercado" },
  { pattern: "FROG",               category: "Supermercado" },
  { pattern: "MULTIAHORRO",        category: "Supermercado" },
  { pattern: "FRESH MARKET",       category: "Supermercado" },
  { pattern: "EL DORADO",          category: "Supermercado" },
  { pattern: "SUPERMERCADO",       category: "Supermercado" },
  { pattern: "ALMACEN",            category: "Supermercado" },
  // ── Restaurantes y bares ─────────────────────────────────────────────────
  { pattern: "RAPPI",              category: "Restaurantes" },
  { pattern: "MCDONALD",          category: "Restaurantes" },
  { pattern: "BURGER KING",        category: "Restaurantes" },
  { pattern: "SUBWAY",             category: "Restaurantes" },
  { pattern: "PIZZA HUT",          category: "Restaurantes" },
  { pattern: "DOMINOS",            category: "Restaurantes" },
  { pattern: "KFC",                category: "Restaurantes" },
  { pattern: "LA PASIVA",          category: "Restaurantes" },
  { pattern: "TELEPIZZA",          category: "Restaurantes" },
  { pattern: "STARBUCKS",          category: "Restaurantes" },
  { pattern: "FRIDAYS",            category: "Restaurantes" },
  { pattern: "FRIDAY",             category: "Restaurantes" },
  { pattern: "MEPAL",              category: "Restaurantes" },
  { pattern: "JAMES DELIVERY",     category: "Restaurantes" },
  { pattern: "GLOVO",              category: "Restaurantes" },
  // ── Transporte ───────────────────────────────────────────────────────────
  { pattern: "CABIFY",             category: "Transporte" },
  { pattern: "TAXISTA",            category: "Transporte" },
  { pattern: "CUTCSA",             category: "Transporte" },
  { pattern: "INTRA",              category: "Transporte" },
  { pattern: "COPSA",              category: "Transporte" },
  { pattern: "TURBUS",             category: "Transporte" },
  { pattern: "COT ",               category: "Transporte" },  // trailing space avoids matching SCOTIABANK
  { pattern: "AEROPUERTO",         category: "Transporte" },
  { pattern: "PARKING",            category: "Transporte" },
  { pattern: "ESTACIONAMIENTO",    category: "Transporte" },
  // ── Combustible ──────────────────────────────────────────────────────────
  { pattern: "ANCAP",              category: "Combustible" },
  { pattern: "PETROBRAS",          category: "Combustible" },
  { pattern: "SHELL",              category: "Combustible" },
  { pattern: "TEXACO",             category: "Combustible" },
  { pattern: "ESSO",               category: "Combustible" },
  { pattern: "LUBRICENTRO",        category: "Combustible" },
  // ── Servicios básicos ────────────────────────────────────────────────────
  { pattern: "ABITAB",             category: "Servicios" },
  { pattern: "RAPIPAGO",           category: "Servicios" },
  { pattern: "MONTEVIDEO GAS",     category: "Servicios" },
  { pattern: "OSE",                category: "Servicios" },
  { pattern: " OCA",               category: "Servicios" },  // leading space avoids matching BOCA, ROCA
  { pattern: "DIRECTV",            category: "Servicios" },
  { pattern: "TELECOM",            category: "Servicios" },
  { pattern: "WIND",               category: "Servicios" },
  // ── Seguros ──────────────────────────────────────────────────────────────
  { pattern: "BSE",                category: "Seguros" },
  { pattern: "MAPFRE",             category: "Seguros" },
  { pattern: "SURCO",              category: "Seguros" },
  { pattern: "SURA",               category: "Seguros" },
  { pattern: "METLIFE",            category: "Seguros" },
  { pattern: "SEGUROS",            category: "Seguros" },
  { pattern: "SEGURO",             category: "Seguros" },
  // ── Streaming (video/audio/gaming) ────────────────────────────────────────
  { pattern: "NETFLIX",            category: "Streaming" },
  { pattern: "SPOTIFY",            category: "Streaming" },
  { pattern: "DISNEY",             category: "Streaming" },
  { pattern: "HBO",                category: "Streaming" },
  { pattern: "PARAMOUNT",          category: "Streaming" },
  { pattern: "CRUNCHYROLL",        category: "Streaming" },
  { pattern: "YOUTUBE",            category: "Streaming" },
  { pattern: "TWITCH",             category: "Streaming" },
  { pattern: "DEEZER",             category: "Streaming" },
  { pattern: "TIDAL",              category: "Streaming" },
  { pattern: "STAR+",              category: "Streaming" },
  { pattern: "PRIME VIDEO",        category: "Streaming" },
  { pattern: "MUBI",               category: "Streaming" },
  // ── Suscripciones digitales (software/servicios) ────────────────────────
  { pattern: "GOOGLE",             category: "Suscripciones" },
  { pattern: "AMAZON",             category: "Suscripciones" },
  { pattern: "APPLE",              category: "Suscripciones" },
  { pattern: "XBOX",               category: "Suscripciones" },
  { pattern: "PLAYSTATION",        category: "Suscripciones" },
  { pattern: "STEAM",              category: "Suscripciones" },
  { pattern: "DROPBOX",            category: "Suscripciones" },
  { pattern: "MICROSOFT",          category: "Suscripciones" },
  { pattern: "OFFICE 365",         category: "Suscripciones" },
  { pattern: "ADOBE",              category: "Suscripciones" },
  // ── Telefonía ────────────────────────────────────────────────────────────
  { pattern: "ANTEL",              category: "Telefonia" },
  { pattern: "MOVISTAR",           category: "Telefonia" },
  { pattern: "CLARO",              category: "Telefonia" },
  { pattern: "TIGO",               category: "Telefonia" },
  // ── Gimnasio / deporte ───────────────────────────────────────────────────
  { pattern: "SMARTFIT",           category: "Gimnasio" },
  { pattern: "SMART FIT",          category: "Gimnasio" },
  { pattern: "BODYTECH",           category: "Gimnasio" },
  { pattern: "GIMNASIO",           category: "Gimnasio" },
  { pattern: "GYM",                category: "Gimnasio" },
  { pattern: "FITNESS",            category: "Gimnasio" },
  // ── Mascotas ─────────────────────────────────────────────────────────────
  { pattern: "VETERINAR",          category: "Mascotas" },
  { pattern: "PET SHOP",           category: "Mascotas" },
  { pattern: "LAIKA",              category: "Mascotas" },
  // ── Salud ────────────────────────────────────────────────────────────────
  { pattern: "FARMACIA",           category: "Salud" },
  { pattern: "FARMASHOP",          category: "Salud" },
  { pattern: "MACROFARMA",         category: "Salud" },
  { pattern: "FARMACITY",          category: "Salud" },
  { pattern: "FARMACENTER",        category: "Salud" },
  { pattern: "SANITAS",            category: "Salud" },
  { pattern: "MEDICA URUGUAYA",    category: "Salud" },
  { pattern: "HOSPITAL",           category: "Salud" },
  { pattern: "CLINICA",            category: "Salud" },
  { pattern: "LABORATORIO",        category: "Salud" },
  { pattern: "OPTICA",             category: "Salud" },
  { pattern: "DENTISTA",           category: "Salud" },
  { pattern: "EMERGENCIA",         category: "Salud" },
  { pattern: "SEMM",               category: "Salud" },
  { pattern: "MEDIFARM",           category: "Salud" },
  // ── Educación ────────────────────────────────────────────────────────────
  { pattern: "UDELAR",             category: "Educacion" },
  { pattern: "ORT",                category: "Educacion" },
  { pattern: "UNIVERSIDAD",        category: "Educacion" },
  { pattern: "INSTITUTO",          category: "Educacion" },
  { pattern: "COLEGIO",            category: "Educacion" },
  { pattern: "LICEO",              category: "Educacion" },
  { pattern: "UTU",                category: "Educacion" },
  { pattern: "COURSERA",           category: "Educacion" },
  { pattern: "UDEMY",              category: "Educacion" },
  // ── Entretenimiento ──────────────────────────────────────────────────────
  { pattern: "HOYTS",              category: "Entretenimiento" },
  { pattern: "CINEMARK",           category: "Entretenimiento" },
  { pattern: "LIFE CINEMAS",       category: "Entretenimiento" },
  { pattern: "CINES",              category: "Entretenimiento" },
  { pattern: "TEATRO",             category: "Entretenimiento" },
  { pattern: "ANTEL ARENA",        category: "Entretenimiento" },
  { pattern: "TICKANTEL",          category: "Entretenimiento" },
  { pattern: "PASSLINE",           category: "Entretenimiento" },
  { pattern: "REDPAGOS ENTRADAS",  category: "Entretenimiento" },
  // ── Indumentaria / shopping ──────────────────────────────────────────────
  { pattern: "ZARA",               category: "Indumentaria" },
  { pattern: "H&M",                category: "Indumentaria" },
  { pattern: "MANGO",              category: "Indumentaria" },
  { pattern: "FOREVER 21",         category: "Indumentaria" },
  { pattern: "MONTEVIDEO SHOPPING",category: "Indumentaria" },
  { pattern: "PUNTA CARRETAS",     category: "Indumentaria" },
  { pattern: "PORTONES",           category: "Indumentaria" },
  { pattern: "TRES CRUCES",        category: "Indumentaria" },
  // ── Hogar y construcción ─────────────────────────────────────────────────
  { pattern: "SODIMAC",            category: "Hogar" },
  { pattern: "EASY",               category: "Hogar" },
  { pattern: "LEROY MERLIN",       category: "Hogar" },
  { pattern: "PINTURERO",          category: "Hogar" },
  { pattern: "REX ",               category: "Hogar" },
  { pattern: "IKEA",               category: "Hogar" },
  // ── Mercado libre / e-commerce ───────────────────────────────────────────
  { pattern: "MERCADO LIBRE",      category: "Compras online" },
  { pattern: "MERCADOLIBRE",       category: "Compras online" },
  { pattern: "ALIEXPRESS",         category: "Compras online" },
  { pattern: "EBAY",               category: "Compras online" },
  { pattern: "SHEIN",              category: "Compras online" },
  // ── Ingresos ─────────────────────────────────────────────────────────────
  { pattern: "SUELDO",             category: "Ingreso" },
  { pattern: "TRANSFERENCIA RECIBIDA", category: "Ingreso" },
  { pattern: "ACREDITACION SUELDO",category: "Ingreso" },
  { pattern: "HONORARIOS",         category: "Ingreso" },
  { pattern: "SALARIO",            category: "Ingreso" },
  { pattern: "HABERES",            category: "Ingreso" },
  // ── Reintegros / devoluciones ────────────────────────────────────────────
  { pattern: "DEVOLUCION",         category: "Reintegro" },
  { pattern: "REINTEGRO",          category: "Reintegro" },
  { pattern: "REVERSA",            category: "Reintegro" },
  { pattern: "CASHBACK",           category: "Reintegro" },
  { pattern: "CONTRACARGO",        category: "Reintegro" },
  // ── Transferencias / cambio de moneda ────────────────────────────────────
  // BROU Supernet: "SUPERNET TC 45.20 COMPRA USD 1000" — TC prefix is the key
  { pattern: "SUPERNET TC",                 category: "Transferencia" },
  // Multi-word FX phrases specific enough to avoid merchant false-positives
  { pattern: "COMPRA DE DOLARES",           category: "Transferencia" },
  { pattern: "VENTA DE DOLARES",            category: "Transferencia" },
  { pattern: "COMPRA DOLARES",              category: "Transferencia" },
  { pattern: "VENTA DOLARES",              category: "Transferencia" },
  { pattern: "COMPRA DIVISA",              category: "Transferencia" },
  { pattern: "VENTA DIVISA",              category: "Transferencia" },
  { pattern: "COMPRA MONEDA EXTRANJERA",   category: "Transferencia" },
  { pattern: "VENTA MONEDA EXTRANJERA",    category: "Transferencia" },
  { pattern: "CAMBIO DIVISAS",             category: "Transferencia" },
  { pattern: "CAMBIO DE MONEDA",           category: "Transferencia" },
  { pattern: "OPERACION TC",              category: "Transferencia" },
  { pattern: "OPERACION DE CAMBIO",        category: "Transferencia" },
  { pattern: "TC COMPRA",                 category: "Transferencia" },
  { pattern: "TC VENTA",                  category: "Transferencia" },
  // Internal transfers
  { pattern: "TRANSFERENCIA PROPIA",      category: "Transferencia" },
  { pattern: "TRANSFERENCIA ENTRE CUENTAS", category: "Transferencia" },
  { pattern: "TRANSFERENCIA INTERNA",     category: "Transferencia" },
  { pattern: "MOVIMIENTO ENTRE CUENTAS",  category: "Transferencia" },
];

// Categories that must exist before default rules can be inserted.
// [ name, budget, type, color, sort_order ]
// type "transferencia" signals that transactions in this category are excluded
// from income/expense totals (they're just money moving between accounts).
const DEFAULT_CATEGORIES = [
  ["Reintegro",        0, "variable",     "#1D9E75", 90],
  ["Transferencia",    0, "transferencia","#888780",  91],
  ["Combustible",      4000, "variable",  "#D85A30",  15],
  ["Seguros",          3000, "fijo",      "#BA7517",  16],
  ["Educacion",        0, "variable",     "#378ADD",  17],
  ["Entretenimiento",  3000, "variable",  "#534AB7",  18],
  ["Indumentaria",     5000, "variable",  "#E24B4A",  19],
  ["Hogar",            3000, "variable",  "#639922",  20],
  ["Compras online",   4000, "variable",  "#D85A30",  21],
  ["Streaming",        2000, "fijo",      "#9B59B6",  22],
  ["Telefonia",        3000, "fijo",      "#2ECC71",  23],
  ["Gimnasio",         3000, "fijo",      "#E67E22",  24],
  ["Mascotas",         2000, "variable",  "#3498DB",  25],
];

/**
 * Idempotent: ensures required categories exist and inserts any default rule
 * whose pattern doesn't exist yet. Safe to call on every server start.
 */
function ensureDefaultRules(db) {
  // Ensure all required categories exist
  for (const [name, budget, type, color, sort_order] of DEFAULT_CATEGORIES) {
    const exists = db.prepare("SELECT id FROM categories WHERE name = ?").get(name);
    if (!exists) {
      db.prepare(
        "INSERT INTO categories (name, budget, type, color, sort_order) VALUES (?, ?, ?, ?, ?)"
      ).run(name, budget, type, color, sort_order);
    }
  }

  const categoryMap = db
    .prepare("SELECT id, name FROM categories")
    .all()
    .reduce((acc, row) => { acc[row.name] = row.id; return acc; }, {});

  const existingPatterns = new Set(
    db.prepare("SELECT LOWER(pattern) AS p FROM rules").all().map((r) => r.p)
  );

  const insert = db.prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, 0)");

  const insertMany = db.transaction((rules) => {
    for (const { pattern, category } of rules) {
      if (existingPatterns.has(pattern.toLowerCase())) continue;
      const catId = categoryMap[category];
      if (!catId) continue; // category doesn't exist, skip
      insert.run(pattern, catId);
    }
  });

  insertMany(DEFAULT_RULES);
}

module.exports = {
  applyRuleRetroactively,
  buildPatternFromDescription,
  bumpRule,
  ensureDefaultRules,
  ensureRuleForManualCategorization,
  findCandidatesForRule,
  findMatchingRule,
  getCandidatesForPattern,
  isLikelyReintegro,
  isLikelyTransfer
};

