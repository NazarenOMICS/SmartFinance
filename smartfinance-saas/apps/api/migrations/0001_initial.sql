CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'variable',
  budget REAL NOT NULL DEFAULT 0,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, slug),
  UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  opening_balance REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  fecha TEXT NOT NULL,
  desc_banco TEXT NOT NULL,
  desc_usuario TEXT,
  monto REAL NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'UYU',
  category_id INTEGER,
  account_id TEXT,
  entry_type TEXT NOT NULL DEFAULT 'expense',
  movement_kind TEXT NOT NULL DEFAULT 'normal',
  dedup_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, period, dedup_hash)
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_period
  ON transactions (user_id, period, fecha DESC);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  normalized_pattern TEXT NOT NULL,
  category_id INTEGER,
  match_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, normalized_pattern)
);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  monto_total REAL NOT NULL,
  cantidad_cuotas INTEGER NOT NULL,
  cuota_actual INTEGER NOT NULL DEFAULT 1,
  monto_cuota REAL NOT NULL,
  account_id TEXT,
  start_month TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_id TEXT,
  period TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'web',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_formats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  format_key TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, format_key)
);

CREATE TABLE IF NOT EXISTS account_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  account_a_id TEXT NOT NULL,
  account_b_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'fx_pair',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, account_a_id, account_b_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id TEXT PRIMARY KEY,
  plan_code TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'inactive',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  value INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, metric, period)
);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-saas-foundation-v1');
