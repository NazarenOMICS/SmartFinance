-- Migration 0015 incorrectly dropped rule_rejections. Recreate it with the correct schema
-- (matching what 0013 + 0014 originally created).

CREATE TABLE IF NOT EXISTS rule_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  rule_id INTEGER NOT NULL,
  desc_banco_normalized TEXT NOT NULL,
  transaction_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, rule_id, desc_banco_normalized)
);

CREATE INDEX IF NOT EXISTS idx_rule_rejections_rule
  ON rule_rejections (user_id, rule_id);

CREATE INDEX IF NOT EXISTS idx_rule_rejections_user_created
  ON rule_rejections (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rule_rejections_transaction
  ON rule_rejections (user_id, transaction_id);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-categorization-canonical-v9');
