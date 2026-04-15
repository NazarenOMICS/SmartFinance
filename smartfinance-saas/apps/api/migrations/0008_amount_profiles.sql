CREATE TABLE IF NOT EXISTS categorization_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  counterparty_key TEXT NOT NULL,
  normalized_pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  account_id TEXT,
  currency TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'expense',
  amount_median REAL NOT NULL,
  amount_min REAL NOT NULL,
  amount_max REAL NOT NULL,
  amount_p25 REAL,
  amount_p75 REAL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0.74,
  status TEXT NOT NULL DEFAULT 'active',
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_categorization_profiles_match
  ON categorization_profiles (user_id, counterparty_key, currency, direction, status);

CREATE INDEX IF NOT EXISTS idx_categorization_profiles_category
  ON categorization_profiles (user_id, category_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS categorization_profile_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  profile_id INTEGER NOT NULL,
  desc_banco_normalized TEXT NOT NULL,
  amount_bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, profile_id, desc_banco_normalized, amount_bucket)
);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-amount-profiles-v8');
