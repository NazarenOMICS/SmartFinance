ALTER TABLE transactions ADD COLUMN categorization_status TEXT NOT NULL DEFAULT 'uncategorized';
ALTER TABLE transactions ADD COLUMN category_source TEXT;
ALTER TABLE transactions ADD COLUMN category_confidence REAL;
ALTER TABLE transactions ADD COLUMN category_rule_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_transactions_user_status
  ON transactions (user_id, period, categorization_status, fecha DESC);

ALTER TABLE rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'suggest';
ALTER TABLE rules ADD COLUMN confidence REAL NOT NULL DEFAULT 0.72;
ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE rules ADD COLUMN account_id TEXT;
ALTER TABLE rules ADD COLUMN currency TEXT;
ALTER TABLE rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any';
ALTER TABLE rules ADD COLUMN merchant_key TEXT;
ALTER TABLE rules ADD COLUMN last_matched_at TEXT;

CREATE TABLE IF NOT EXISTS rule_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL,
  desc_banco_normalized TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, rule_id, desc_banco_normalized)
);

DROP INDEX IF EXISTS idx_rules_user_pattern;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_user_scope
  ON rules (user_id, normalized_pattern, IFNULL(account_id, ''), IFNULL(currency, ''), direction);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-rules-intelligence-v2');
