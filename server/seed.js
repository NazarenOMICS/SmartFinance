const { db } = require("./db");
const { buildDedupHash } = require("./services/dedup");

const categories = [
  { name: "Alquiler", budget: 18000, type: "fijo", color: "#639922", sort_order: 1 },
  { name: "Supermercado", budget: 12000, type: "variable", color: "#534AB7", sort_order: 2 },
  { name: "Transporte", budget: 6000, type: "variable", color: "#1D9E75", sort_order: 3 },
  { name: "Suscripciones", budget: 5000, type: "fijo", color: "#D85A30", sort_order: 4 },
  { name: "Restaurantes", budget: 8000, type: "variable", color: "#378ADD", sort_order: 5 },
  { name: "Servicios", budget: 7000, type: "fijo", color: "#BA7517", sort_order: 6 },
  { name: "Salud", budget: 4000, type: "variable", color: "#E24B4A", sort_order: 7 },
  { name: "Otros", budget: 5000, type: "variable", color: "#888780", sort_order: 8 },
  { name: "Ingreso", budget: 0, type: "fijo", color: "#639922", sort_order: 0 }
];

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
  ["2026-03-02", "ANTEL *DEB AUTOMATICO", -2890, "UYU", "Servicios", "brou_uyu", 0, null],
  ["2026-03-03", "SPOTIFY PREMIUM", -490, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-03-03", "NETFLIX.COM", -850, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-03-04", "TATA *POS 2281", -3420, "UYU", "Supermercado", "visa_gold", 0, null],
  ["2026-03-05", "TRANSFERENCIA RECIBIDA", 65000, "UYU", "Ingreso", "brou_uyu", 0, null],
  ["2026-03-06", "UBER *TRIP 8821", -320, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-07", "PEDIDOSYA *7732", -890, "UYU", "Restaurantes", "visa_gold", 0, null],
  ["2026-03-08", "FARMASHOP *POS", -1250, "UYU", "Salud", "visa_gold", 0, null],
  ["2026-03-10", "TATA *POS 2281", -2890, "UYU", "Supermercado", "visa_gold", 0, null],
  ["2026-03-11", "UTE *DEB AUTOMATICO", -3200, "UYU", "Servicios", "brou_uyu", 0, null],
  ["2026-03-12", "PEDIDOSYA *1192", -750, "UYU", "Restaurantes", "visa_gold", 0, null],
  ["2026-03-13", "STM RECARGA", -600, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-14", "CUOTA HELADERA 4/12", -3750, "UYU", "Otros", "visa_gold", 1, 1],
  ["2026-03-14", "CUOTA NOTEBOOK 2/6", -4667, "UYU", "Otros", "visa_gold", 1, 2],
  ["2026-03-15", "CUOTA AIRE 7/10", -3200, "UYU", "Otros", "itau_uyu", 1, 3],
  ["2026-03-16", "DEVOTO *POS 1102", -4100, "UYU", "Supermercado", "brou_uyu", 0, null],
  ["2026-03-18", "POS COMPRA *4821", -2340, "UYU", null, "visa_gold", 0, null],
  ["2026-03-19", "TRANSFERENCIA RECIBIDA", 45000, "UYU", "Ingreso", "itau_uyu", 0, null],
  ["2026-03-20", "DEBITO AUTOMATICO SER", -1890, "UYU", null, "brou_uyu", 0, null],
  ["2026-03-21", "PEDIDOSYA *7732", -890, "UYU", "Restaurantes", "visa_gold", 0, null],
  ["2026-03-22", "UBER *TRIP 9031", -450, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-03-23", "ABITAB RECARGA", -350, "UYU", "Otros", "brou_uyu", 0, null],
  ["2026-03-24", "PAGO APPLE.COM", -199, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-03-25", "SUELDO COMPLEMENTO", 12000, "UYU", "Ingreso", "itau_uyu", 0, null],
  ["2026-02-01", "ALQUILER DEPTO FEB", -18000, "UYU", "Alquiler", "brou_uyu", 0, null],
  ["2026-02-03", "ANTEL *DEB", -2890, "UYU", "Servicios", "brou_uyu", 0, null],
  ["2026-02-04", "TATA *POS", -5200, "UYU", "Supermercado", "visa_gold", 0, null],
  ["2026-02-05", "SUELDO", 62000, "UYU", "Ingreso", "brou_uyu", 0, null],
  ["2026-02-07", "UBER", -280, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-02-08", "PEDIDOSYA", -670, "UYU", "Restaurantes", "visa_gold", 0, null],
  ["2026-02-10", "SPOTIFY", -490, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-02-12", "NETFLIX", -850, "UYU", "Suscripciones", "visa_gold", 0, null],
  ["2026-02-14", "UTE *DEB", -2950, "UYU", "Servicios", "brou_uyu", 0, null],
  ["2026-02-15", "DEVOTO *POS", -3800, "UYU", "Supermercado", "brou_uyu", 0, null],
  ["2026-02-18", "FARMASHOP", -980, "UYU", "Salud", "visa_gold", 0, null],
  ["2026-02-20", "PEDIDOSYA", -520, "UYU", "Restaurantes", "visa_gold", 0, null],
  ["2026-02-22", "STM RECARGA", -600, "UYU", "Transporte", "brou_uyu", 0, null],
  ["2026-02-25", "TRANSFERENCIA", 40000, "UYU", "Ingreso", "itau_uyu", 0, null]
];

const rules = [
  ["PEDIDOSYA", "Restaurantes", 8],
  ["UBER", "Transporte", 14],
  ["SPOTIFY", "Suscripciones", 3],
  ["NETFLIX", "Suscripciones", 3],
  ["TATA", "Supermercado", 6],
  ["DEVOTO", "Supermercado", 4],
  ["ANTEL", "Servicios", 5],
  ["UTE", "Servicios", 5],
  ["STM", "Transporte", 3],
  ["FARMASHOP", "Salud", 2]
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
    "INSERT INTO categories (name, budget, type, color, sort_order) VALUES (@name, @budget, @type, @color, @sort_order)"
  );
  const insertInstallment = db.prepare(
    `
    INSERT INTO installments (descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month)
    VALUES (@descripcion, @monto_total, @cantidad_cuotas, @cuota_actual, @monto_cuota, @account_id, @start_month)
  `
  );
  const insertRule = db.prepare("INSERT INTO rules (pattern, category_id, match_count) VALUES (?, ?, ?)");
  const insertTx = db.prepare(
    `
    INSERT INTO transactions (
      fecha, desc_banco, monto, moneda, category_id, account_id, es_cuota, installment_id, dedup_hash, entry_type, movement_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'standard')
  `
  );
  const insertAccountLink = db.prepare("INSERT INTO account_links (account_a_id, account_b_id, relation_type) VALUES (?, ?, ?)");

  const transaction = db.transaction(() => {
    categories.forEach((category) => insertCategory.run(category));
    installments.forEach((installment) =>
      insertInstallment.run({
        ...installment,
        monto_cuota: Math.round(installment.monto_total / installment.cantidad_cuotas)
      })
    );

    const categoryMap = db.prepare("SELECT id, name FROM categories").all().reduce((acc, row) => {
      acc[row.name] = row.id;
      return acc;
    }, {});

    const accountTotals = txRows.reduce((acc, [, , monto, , , accountId]) => {
      acc[accountId] = (acc[accountId] || 0) + Number(monto);
      return acc;
    }, {});

    accounts.forEach((account) =>
      insertAccount.run({
        ...account,
        opening_balance: Number(account.balance || 0) - Number(accountTotals[account.id] || 0)
      })
    );

    txRows.forEach(([fecha, desc_banco, monto, moneda, categoryName, accountId, esCuota, installmentId]) => {
      insertTx.run(
        fecha,
        desc_banco,
        monto,
        moneda,
        categoryName ? categoryMap[categoryName] : null,
        accountId,
        esCuota,
        installmentId,
        buildDedupHash({ fecha, monto, desc_banco }),
        monto >= 0 ? "income" : "expense"
      );
    });

    rules.forEach(([pattern, categoryName, count]) => {
      insertRule.run(pattern, categoryMap[categoryName], count);
    });

    accountLinks.forEach(([left, right, relationType]) => {
      insertAccountLink.run(left, right, relationType);
    });
  });

  transaction();
  return { seeded: true };
}

if (require.main === module) {
  const result = seed();
  console.log(result.seeded ? "Seed completed." : "Seed skipped; data already exists.");
}

module.exports = {
  seed
};

