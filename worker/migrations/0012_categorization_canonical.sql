CREATE TABLE IF NOT EXISTS merchant_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  merchant_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  default_category_id INTEGER,
  origin TEXT NOT NULL DEFAULT 'seed',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, merchant_key)
);

CREATE TABLE IF NOT EXISTS rule_match_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  transaction_id INTEGER NOT NULL,
  rule_id INTEGER,
  category_id INTEGER,
  layer TEXT NOT NULL,
  confidence REAL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categorization_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

ALTER TABLE transactions ADD COLUMN merchant_key TEXT;
ALTER TABLE transactions ADD COLUMN parse_quality TEXT NOT NULL DEFAULT 'clean';
ALTER TABLE transactions ADD COLUMN rule_skipped_reason TEXT;

CREATE TABLE rules_canonical (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL,
  normalized_pattern TEXT NOT NULL DEFAULT '',
  merchant_key TEXT,
  merchant_scope TEXT NOT NULL DEFAULT '',
  account_id TEXT,
  account_scope TEXT NOT NULL DEFAULT '',
  currency TEXT,
  currency_scope TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'any',
  category_id INTEGER NOT NULL,
  match_count INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'suggest',
  confidence REAL NOT NULL DEFAULT 0.72,
  source TEXT NOT NULL DEFAULT 'manual',
  last_matched_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, merchant_scope, account_scope, currency_scope, direction)
);

INSERT INTO rules_canonical (
  id, user_id, pattern, normalized_pattern, merchant_key, merchant_scope,
  account_id, account_scope, currency, currency_scope, direction, category_id,
  match_count, mode, confidence, source, last_matched_at, created_at, updated_at
)
SELECT
  keep.id,
  keep.user_id,
  keep.pattern,
  COALESCE(NULLIF(keep.normalized_pattern, ''), lower(trim(keep.pattern))),
  COALESCE(NULLIF(keep.merchant_key, ''), NULLIF(keep.normalized_pattern, ''), lower(trim(keep.pattern))),
  COALESCE(NULLIF(keep.merchant_key, ''), NULLIF(keep.normalized_pattern, ''), lower(trim(keep.pattern))),
  keep.account_id,
  COALESCE(keep.account_id, ''),
  keep.currency,
  COALESCE(keep.currency, ''),
  COALESCE(NULLIF(keep.direction, ''), 'any'),
  keep.category_id,
  keep.match_count,
  COALESCE(NULLIF(keep.mode, ''), 'suggest'),
  COALESCE(keep.confidence, 0.72),
  COALESCE(NULLIF(keep.source, ''), 'manual'),
  keep.last_matched_at,
  keep.created_at,
  datetime('now')
FROM rules keep
WHERE keep.id IN (
  SELECT MIN(candidate.id)
  FROM rules candidate
  GROUP BY
    candidate.user_id,
    COALESCE(NULLIF(candidate.merchant_key, ''), NULLIF(candidate.normalized_pattern, ''), lower(trim(candidate.pattern))),
    COALESCE(candidate.account_id, ''),
    COALESCE(candidate.currency, ''),
    COALESCE(NULLIF(candidate.direction, ''), 'any')
);

DROP TABLE rules;
ALTER TABLE rules_canonical RENAME TO rules;

CREATE INDEX IF NOT EXISTS idx_rules_user_merchant
  ON rules (user_id, merchant_key);
CREATE INDEX IF NOT EXISTS idx_rules_user_category
  ON rules (user_id, category_id);
CREATE INDEX IF NOT EXISTS idx_rules_user_direction_currency
  ON rules (user_id, direction, currency);
CREATE INDEX IF NOT EXISTS idx_rules_user_pattern
  ON rules (user_id, normalized_pattern);
CREATE INDEX IF NOT EXISTS idx_rule_exclusions_rule
  ON rule_exclusions (user_id, rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_match_log_tx
  ON rule_match_log (user_id, transaction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_categorization_jobs_user
  ON categorization_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category_status
  ON transactions (user_id, category_id, categorization_status);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant
  ON transactions (user_id, merchant_key);

INSERT OR IGNORE INTO merchant_dictionary (user_id, merchant_key, display_name, aliases_json, origin)
VALUES
  (NULL, 'uber', 'Uber', '["uber trip","uber eats"]', 'seed'),
  (NULL, 'pedidosya', 'PedidosYa', '["pedidos ya","pedidosya"]', 'seed'),
  (NULL, 'mcdonalds', 'McDonalds', '["mcdonald","mcdonalds","mc donald"]', 'seed'),
  (NULL, 'rappi', 'Rappi', '["rappi"]', 'seed'),
  (NULL, 'mercadopago', 'Mercado Pago', '["mercado pago","mercadopago","mercado"]', 'seed'),
  (NULL, 'netflix', 'Netflix', '["netflix"]', 'seed'),
  (NULL, 'spotify', 'Spotify', '["spotify"]', 'seed'),
  (NULL, 'openai', 'OpenAI', '["openai","chatgpt"]', 'seed'),
  (NULL, 'farmashop', 'Farmashop', '["farmashop"]', 'seed'),
  (NULL, 'antel', 'Antel', '["antel"]', 'seed'),
  (NULL, 'ute', 'UTE', '["ute"]', 'seed'),
  (NULL, 'ose', 'OSE', '["ose"]', 'seed');

INSERT OR IGNORE INTO settings (user_id, key, value)
VALUES ('', 'categorizer_v2_enabled', '1');

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-categorization-canonical-v9');
