import { allRows, ensureUserBootstrap, runStatement, type D1DatabaseLike } from "@smartfinance/database";

const TEST_USER_ID = "dev-user";

type SeedCategory = {
  id: number;
  slug: string;
  name: string;
};

type SeedUpload = {
  id: number;
};

function buildDedupHash(input: { fecha: string; monto: number; desc_banco: string }) {
  const normalized = `${input.fecha}|${input.monto}|${input.desc_banco.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(index)) | 0;
  }
  return `tx_${Math.abs(hash)}`;
}

async function clearUserData(db: D1DatabaseLike, userId: string) {
  const statements = [
    "DELETE FROM rule_rejections WHERE user_id = ?",
    "DELETE FROM categorization_profile_rejections WHERE user_id = ?",
    "DELETE FROM categorization_profiles WHERE user_id = ?",
    "DELETE FROM usage_counters WHERE user_id = ?",
    "DELETE FROM uploads WHERE user_id = ?",
    "DELETE FROM transactions WHERE user_id = ?",
    "DELETE FROM installments WHERE user_id = ?",
    "DELETE FROM bank_formats WHERE user_id = ?",
    "DELETE FROM account_links WHERE user_id = ?",
    "DELETE FROM rules WHERE user_id = ?",
    "DELETE FROM categories WHERE user_id = ?",
    "DELETE FROM accounts WHERE user_id = ?",
    "DELETE FROM settings WHERE user_id = ?",
    "DELETE FROM subscriptions WHERE user_id = ?",
  ];

  for (const sql of statements) {
    await runStatement(db, sql, [userId]);
  }
  await runStatement(db, "DELETE FROM usage_counters WHERE user_id = ?", [`user:${userId}`]);
}

async function getCategoryBySlug(db: D1DatabaseLike, userId: string) {
  const categories = await allRows<SeedCategory>(
    db,
    "SELECT id, slug, name FROM categories WHERE user_id = ?",
    [userId],
  );

  return new Map(categories.map((category) => [category.slug, category]));
}

async function insertAccount(
  db: D1DatabaseLike,
  userId: string,
  account: { id: string; name: string; currency: string; balance: number; opening_balance?: number },
) {
  await runStatement(
    db,
    `
      INSERT INTO accounts (user_id, id, name, currency, balance, opening_balance)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      account.id,
      account.name,
      account.currency,
      account.balance,
      account.opening_balance ?? account.balance,
    ],
  );
}

async function insertInstallment(
  db: D1DatabaseLike,
  userId: string,
  installment: {
    descripcion: string;
    monto_total: number;
    cantidad_cuotas: number;
    cuota_actual: number;
    account_id: string;
    start_month: string;
  },
) {
  await runStatement(
    db,
    `
      INSERT INTO installments (
        user_id, descripcion, monto_total, cantidad_cuotas, cuota_actual, monto_cuota, account_id, start_month
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      installment.descripcion,
      installment.monto_total,
      installment.cantidad_cuotas,
      installment.cuota_actual,
      Number((installment.monto_total / installment.cantidad_cuotas).toFixed(2)),
      installment.account_id,
      installment.start_month,
    ],
  );
}

async function insertUpload(
  db: D1DatabaseLike,
  userId: string,
  upload: {
    account_id: string;
    period: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    parser: string;
    tx_count: number;
    status: string;
    extracted_candidates: number;
    duplicates_skipped: number;
    auto_categorized_count: number;
    suggested_count: number;
    pending_review_count: number;
    unmatched_count: number;
  },
) {
  const result = await runStatement(
    db,
    `
      INSERT INTO uploads (
        user_id, account_id, period, original_filename, storage_key, mime_type, size_bytes, source, status,
        tx_count, parser, ai_assisted, ai_provider, ai_model, extracted_candidates, duplicates_skipped,
        auto_categorized_count, suggested_count, pending_review_count, unmatched_count
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 'web', ?, ?, ?, 0, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      upload.account_id,
      upload.period,
      upload.original_filename,
      `local-e2e/${upload.original_filename}`,
      upload.mime_type,
      upload.size_bytes,
      upload.status,
      upload.tx_count,
      upload.parser,
      upload.extracted_candidates,
      upload.duplicates_skipped,
      upload.auto_categorized_count,
      upload.suggested_count,
      upload.pending_review_count,
      upload.unmatched_count,
    ],
  );

  return {
    id: Number(result.meta?.last_row_id || 0),
  } satisfies SeedUpload;
}

async function insertTransaction(
  db: D1DatabaseLike,
  userId: string,
  transaction: {
    fecha: string;
    desc_banco: string;
    desc_usuario?: string | null;
    monto: number;
    moneda: string;
    category_id?: number | null;
    account_id: string;
    entry_type?: string;
    movement_kind?: string;
    categorization_status?: string;
    category_source?: string | null;
    category_confidence?: number | null;
    category_rule_id?: number | null;
    upload_id?: number | null;
    paired_transaction_id?: number | null;
    account_link_id?: number | null;
    internal_group_id?: string | null;
    installment_id?: number | null;
  },
) {
  const period = transaction.fecha.slice(0, 7);
  await runStatement(
    db,
    `
      INSERT INTO transactions (
        user_id, period, fecha, desc_banco, desc_usuario, monto, moneda, category_id, account_id, entry_type,
        movement_kind, dedup_hash, categorization_status, category_source, category_confidence, category_rule_id,
        upload_id, paired_transaction_id, account_link_id, internal_group_id, installment_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      userId,
      period,
      transaction.fecha,
      transaction.desc_banco,
      transaction.desc_usuario ?? null,
      transaction.monto,
      transaction.moneda,
      transaction.category_id ?? null,
      transaction.account_id,
      transaction.entry_type ?? (transaction.monto >= 0 ? "income" : "expense"),
      transaction.movement_kind ?? "normal",
      buildDedupHash({
        fecha: transaction.fecha,
        monto: transaction.monto,
        desc_banco: transaction.desc_banco,
      }),
      transaction.categorization_status ?? (transaction.category_id != null ? "categorized" : "uncategorized"),
      transaction.category_source ?? (transaction.category_id != null ? "manual" : null),
      transaction.category_confidence ?? null,
      transaction.category_rule_id ?? null,
      transaction.upload_id ?? null,
      transaction.paired_transaction_id ?? null,
      transaction.account_link_id ?? null,
      transaction.internal_group_id ?? null,
      transaction.installment_id ?? null,
    ],
  );
}

export async function resetLocalTestDataset(db: D1DatabaseLike, userId = TEST_USER_ID) {
  await clearUserData(db, userId);
  await ensureUserBootstrap(db, userId);
  await runStatement(
    db,
    `
      INSERT INTO subscriptions (user_id, plan_code, status)
      VALUES (?, 'pro_monthly', 'active')
      ON CONFLICT(user_id)
      DO UPDATE SET plan_code = 'pro_monthly', status = 'active', updated_at = CURRENT_TIMESTAMP
    `,
    [userId],
  );

  const categoryBySlug = await getCategoryBySlug(db, userId);
  const serviciosId = categoryBySlug.get("servicios")?.id ?? null;
  const comidaId = categoryBySlug.get("comida")?.id ?? null;
  const streamingId = categoryBySlug.get("streaming")?.id ?? null;
  const transporteId = categoryBySlug.get("transporte")?.id ?? null;
  const ocioId = categoryBySlug.get("ocio")?.id ?? null;

  await runStatement(
    db,
    `
      UPDATE settings
      SET value = CASE key
        WHEN 'display_currency' THEN 'UYU'
        WHEN 'savings_initial' THEN '50000'
        WHEN 'savings_monthly' THEN '8000'
        WHEN 'savings_goal' THEN '200000'
        WHEN 'savings_currency' THEN 'UYU'
        WHEN 'guided_categorization_onboarding_completed' THEN '0'
        WHEN 'guided_categorization_onboarding_skipped' THEN '0'
        ELSE value
      END
      WHERE user_id = ?
    `,
    [userId],
  );

  await insertAccount(db, userId, {
    id: "brou_uyu",
    name: "BROU Caja UYU",
    currency: "UYU",
    balance: 45210,
    opening_balance: 41000,
  });
  await insertAccount(db, userId, {
    id: "brou_usd",
    name: "BROU USD",
    currency: "USD",
    balance: 1200,
    opening_balance: 950,
  });
  await insertAccount(db, userId, {
    id: "visa_uyu",
    name: "Visa BROU",
    currency: "UYU",
    balance: -13500,
    opening_balance: -9800,
  });
  await insertAccount(db, userId, {
    id: "itau_uyu",
    name: "Itaú Cuenta",
    currency: "UYU",
    balance: 18000,
    opening_balance: 12000,
  });

  await insertInstallment(db, userId, {
    descripcion: "Notebook trabajo",
    monto_total: 48000,
    cantidad_cuotas: 12,
    cuota_actual: 4,
    account_id: "visa_uyu",
    start_month: "2026-01",
  });
  await insertInstallment(db, userId, {
    descripcion: "Air fryer",
    monto_total: 12000,
    cantidad_cuotas: 6,
    cuota_actual: 2,
    account_id: "visa_uyu",
    start_month: "2026-03",
  });
  await insertInstallment(db, userId, {
    descripcion: "Bicicleta",
    monto_total: 24000,
    cantidad_cuotas: 8,
    cuota_actual: 5,
    account_id: "brou_uyu",
    start_month: "2025-12",
  });

  const seededUpload = await insertUpload(db, userId, {
    account_id: "visa_uyu",
    period: "2026-04",
    original_filename: "abril-seed.csv",
    mime_type: "text/csv",
    size_bytes: 2048,
    parser: "csv",
    tx_count: 3,
    status: "processed",
    extracted_candidates: 3,
    duplicates_skipped: 0,
    auto_categorized_count: 1,
    suggested_count: 1,
    pending_review_count: 1,
    unmatched_count: 0,
  });

  const aprilTransactions = [
    { fecha: "2026-04-01", desc_banco: "SUELDO EMPRESA SA", monto: 65000, moneda: "UYU", account_id: "itau_uyu" },
    { fecha: "2026-04-02", desc_banco: "ALQUILER CENTRO", monto: -18000, moneda: "UYU", category_id: serviciosId, account_id: "brou_uyu", category_source: "manual" },
    { fecha: "2026-04-03", desc_banco: "UTE FACTURA", monto: -3200, moneda: "UYU", category_id: serviciosId, account_id: "brou_uyu", category_source: "rule_auto", category_confidence: 0.9 },
    { fecha: "2026-04-04", desc_banco: "NETFLIX.COM", monto: -399, moneda: "UYU", category_id: streamingId, account_id: "visa_uyu", category_source: "rule_auto", category_confidence: 0.95, upload_id: seededUpload.id },
    { fecha: "2026-04-05", desc_banco: "DISCO POCITOS", monto: -5200, moneda: "UYU", category_id: comidaId, account_id: "visa_uyu", category_source: "manual", upload_id: seededUpload.id },
    { fecha: "2026-04-06", desc_banco: "UBER TRIP", monto: -430, moneda: "UYU", category_id: transporteId, account_id: "brou_uyu", category_source: "rule_auto", category_confidence: 0.88 },
    { fecha: "2026-04-06", desc_banco: "FARMASHOP", monto: -890, moneda: "UYU", category_id: serviciosId, account_id: "brou_uyu", category_source: "keyword", categorization_status: "suggested", category_confidence: 0.8 },
    { fecha: "2026-04-07", desc_banco: "MERCADOPAGO FERIA", monto: -1234, moneda: "UYU", account_id: "brou_uyu", upload_id: seededUpload.id },
    { fecha: "2026-04-08", desc_banco: "SUPER FROG EXPRESS", monto: -2100, moneda: "UYU", category_id: comidaId, account_id: "brou_uyu", categorization_status: "suggested", category_source: "history", category_confidence: 0.79 },
    { fecha: "2026-04-09", desc_banco: "PEDIDOSYA *7732", monto: -1450, moneda: "UYU", category_id: comidaId, account_id: "visa_uyu", categorization_status: "suggested", category_source: "keyword", category_confidence: 0.76 },
    { fecha: "2026-04-10", desc_banco: "BONO ABRIL", monto: 5000, moneda: "UYU", account_id: "itau_uyu" },
    { fecha: "2026-04-12", desc_banco: "CINE MOVIE", monto: -780, moneda: "UYU", category_id: ocioId, account_id: "visa_uyu", category_source: "rule_auto", category_confidence: 0.9 },
  ];

  const marchTransactions = [
    { fecha: "2026-03-01", desc_banco: "SUELDO EMPRESA SA", monto: 64000, moneda: "UYU", account_id: "itau_uyu" },
    { fecha: "2026-03-02", desc_banco: "ALQUILER CENTRO", monto: -18000, moneda: "UYU", category_id: serviciosId, account_id: "brou_uyu", category_source: "manual" },
    { fecha: "2026-03-03", desc_banco: "UTE FACTURA", monto: -3100, moneda: "UYU", category_id: serviciosId, account_id: "brou_uyu", category_source: "rule_auto", category_confidence: 0.9 },
    { fecha: "2026-03-04", desc_banco: "NETFLIX.COM", monto: -380, moneda: "UYU", category_id: streamingId, account_id: "visa_uyu", category_source: "rule_auto", category_confidence: 0.95 },
    { fecha: "2026-03-08", desc_banco: "DISCO POCITOS", monto: -4800, moneda: "UYU", category_id: comidaId, account_id: "visa_uyu", category_source: "manual" },
    { fecha: "2026-03-11", desc_banco: "GYM CLUB", monto: -1600, moneda: "UYU", account_id: "visa_uyu" },
  ];

  const februaryTransactions = [
    { fecha: "2026-02-01", desc_banco: "SUELDO EMPRESA SA", monto: 63500, moneda: "UYU", account_id: "itau_uyu" },
    { fecha: "2026-02-03", desc_banco: "NETFLIX.COM", monto: -350, moneda: "UYU", category_id: streamingId, account_id: "visa_uyu", category_source: "rule_auto", category_confidence: 0.95 },
    { fecha: "2026-02-11", desc_banco: "GYM CLUB", monto: -1600, moneda: "UYU", account_id: "visa_uyu" },
    { fecha: "2026-02-14", desc_banco: "SPOTIFY", monto: -220, moneda: "UYU", category_id: streamingId, account_id: "visa_uyu", category_source: "rule_auto", category_confidence: 0.95 },
  ];

  for (const transaction of [...aprilTransactions, ...marchTransactions, ...februaryTransactions]) {
    await insertTransaction(db, userId, {
      ...transaction,
      category_id: transaction.category_id ?? undefined,
    });
  }

  const counts = await allRows<{ total: number }>(
    db,
    "SELECT COUNT(*) AS total FROM transactions WHERE user_id = ?",
    [userId],
  );

  return {
    ok: true,
    user_id: userId,
    accounts_seeded: 4,
    transactions_seeded: Number(counts[0]?.total || 0),
    uploads_seeded: 1,
    installments_seeded: 3,
  };
}

export function getLocalTestUserId() {
  return TEST_USER_ID;
}
