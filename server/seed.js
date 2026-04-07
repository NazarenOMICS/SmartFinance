const { db } = require("./db");
const { buildDedupHash } = require("./services/dedup");
const { buildSeedRules, CANONICAL_CATEGORIES } = require("./services/taxonomy");

const accounts = [
  { id: "brou_uyu", name: "BROU Caja de Ahorro", currency: "UYU", balance: 48320 },
  { id: "visa_gold", name: "Visa Gold BROU", currency: "UYU", balance: -12500 },
  { id: "brou_usd", name: "BROU USD", currency: "USD", balance: 1240 },
  { id: "itau_uyu", name: "Itau Cuenta Corriente", currency: "UYU", balance: 22100 }
];

const accountLinks = [["brou_usd", "brou_uyu", "fx_pair"]];

const installments = [
  { descripcion: "Heladera Samsung", monto_total: 45000, cantidad_cuotas: 12, cuota_actual: 4, account_id: "visa_gold", start_month: "2025-12" },
  { descripcion: "Notebook Lenovo", monto_total: 28000, cantidad_cuotas: 6, cuota_actual: 2, account_id: "visa_gold", start_month: "2026-02" },
  { descripcion: "Aire acondicionado", monto_total: 32000, cantidad_cuotas: 10, cuota_actual: 7, account_id: "itau_uyu", start_month: "2025-09" }
];

const txRows = [
  ["2026-03-01", "ALQUILER DEPTO MAR", -18000, "UYU", "Alquiler", "brou_uyu", 0, null],
  ["2026-03-02", "ANTEL *DEB AUTOMATICO", -2890, "UYU", "Telefonia", "brou_uyu", 0, null],
  ["2026-03-03", "SPOTIFY PREMIUM", -490, "UYU", "Streaming", "visa_gold", 0, null],
  ["2026-03-03", "NETFLIX.COM", -850, "UYU", "Streaming", "visa_gold", 0, null],
  ["2026-03-04", "TATA *POS 2281", -3420, "UYU", "Supermercado", "visa_gold", 0, null],
  ["2026-03-05", "TRANSFERENCIA RECIBIDA", 65000, "UYU", "Ingreso", "brou_uyu", 0, null],
  ["2026-03-06", "UBER *TRIP 8821", -320, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-07", "PEDIDOSYA *7732", -890, "UYU", "Delivery", "visa_gold", 0, null],
  ["2026-03-08", "FARMASHOP *POS", -1250, "UYU", "Salud", "visa_gold", 0, null],
  ["2026-03-10", "TATA *POS 2281", -2890, "UYU", "Supermercado", "visa_gold", 0, null],
  ["2026-03-11", "UTE *DEB AUTOMATICO", -3200, "UYU", "Servicios", "brou_uyu", 0, null],
  ["2026-03-12", "PEDIDOSYA *1192", -750, "UYU", "Delivery", "visa_gold", 0, null],
  ["2026-03-13", "STM RECARGA", -600, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-14", "CUOTA HELADERA 4/12", -3750, "UYU", "Otros", "visa_gold", 1, 1],
  ["2026-03-14", "CUOTA NOTEBOOK 2/6", -4667, "UYU", "Otros", "visa_gold", 1, 2],
  ["2026-03-15", "CUOTA AIRE 7/10", -3200, "UYU", "Otros", "itau_uyu", 1, 3],
  ["2026-03-16", "DEVOTO *POS 1102", -4100, "UYU", "Supermercado", "brou_uyu", 0, null],
  ["2026-03-18", "STARBUCKS *POS", -890, "UYU", "Comer afuera", "visa_gold", 0, null],
  ["2026-03-19", "TRANSFERENCIA RECIBIDA", 45000, "UYU", "Ingreso", "itau_uyu", 0, null],
  ["2026-03-20", "SMARTFIT", -1890, "UYU", "Gimnasio", "brou_uyu", 0, null],
  ["2026-03-21", "PEDIDOSYA *7732", -890, "UYU", "Delivery", "visa_gold", 0, null],
  ["2026-03-22", "UBER *TRIP 9031", -450, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-23", "PET SHOP", -350, "UYU", "Mascotas", "brou_uyu", 0, null],
  ["2026-03-24", "PAGO APPLE.COM", -199, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-03-25", "SUELDO COMPLEMENTO", 12000, "UYU", "Ingreso", "itau_uyu", 0, null]
];

function seed() {
  const hasAccounts = db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count > 0;
  if (hasAccounts) {
    return { seeded: false };
  }

  const insertAccount = db.prepare(
    "INSERT INTO accounts (id, name, currency, balance, opening_balance) VALUES (@id, @name, @currency, @balance, @opening_balance)"
  );
  const insertCategory = db.prepare(
    "INSERT INTO categories (name, budget, type, color, sort_order, slug, origin) VALUES (@name, @budget, @type, @color, @sort_order, @slug, @origin)"
  );
  const insertInstallment = db.prepare(
    `INSERT INTO installments (descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month)
     VALUES (@descripcion, @monto_total, @cantidad_cuotas, @cuota_actual, @monto_cuota, @account_id, @start_month)`
  );
  const insertRule = db.prepare(
    `INSERT INTO rules (pattern, normalized_pattern, category_id, match_count, mode, confidence, source, direction, merchant_key)
     VALUES (?, ?, ?, 0, ?, ?, 'seed', ?, ?)`
  );
  const insertTx = db.prepare(
    `INSERT INTO transactions (
      fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash,
      categorization_status, category_source, category_confidence, category_rule_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertAccountLink = db.prepare("INSERT INTO account_links (account_a_id, account_b_id, relation_type) VALUES (?, ?, ?)");

  db.transaction(() => {
    accounts.forEach((account) => insertAccount.run({
      ...account,
      opening_balance: Number(account.balance || 0)
    }));
    CANONICAL_CATEGORIES.forEach((category) => insertCategory.run({
      name: category.name,
      budget: category.budget,
      type: category.type,
      color: category.color,
      sort_order: category.sort_order,
      slug: category.slug,
      origin: "seed",
    }));
    installments.forEach((installment) =>
      insertInstallment.run({
        ...installment,
        monto_cuota: Math.round(installment.monto_total / installment.cantidad_cuotas)
      })
    );

    const categoryMap = new Map(db.prepare("SELECT id, name FROM categories").all().map((row) => [row.name, row.id]));
    txRows.forEach(([fecha, desc_banco, monto, moneda, categoryName, accountId, esCuota, installmentId]) => {
      insertTx.run(
        fecha,
        desc_banco,
        monto,
        moneda,
        categoryName ? categoryMap.get(categoryName) : null,
        accountId,
        esCuota,
        installmentId,
        buildDedupHash({ fecha, monto, desc_banco }),
        categoryName ? "categorized" : "uncategorized",
        categoryName ? "seed" : null,
        null,
        null
      );
    });

    buildSeedRules().forEach((rule) => {
      const categoryId = categoryMap.get(rule.category_name);
      if (!categoryId) return;
      insertRule.run(rule.pattern, rule.normalized_pattern, categoryId, rule.mode, rule.confidence, rule.direction, rule.merchant_key);
    });

    accountLinks.forEach(([left, right, relationType]) => {
      insertAccountLink.run(left, right, relationType);
    });
  })();

  return { seeded: true };
}

if (require.main === module) {
  const result = seed();
  console.log(result.seeded ? "Seed completed." : "Seed skipped; data already exists.");
}

module.exports = {
  seed
};
