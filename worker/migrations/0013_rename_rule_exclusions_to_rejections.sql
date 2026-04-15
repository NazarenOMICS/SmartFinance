-- Create rule_rejections table for parity with SaaS and domain layer
-- This table tracks rejected bank descriptions per rule (domain contract)
-- Kept parallel to rule_exclusions during transition

CREATE TABLE IF NOT EXISTS rule_rejections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  rule_id INTEGER NOT NULL,
  desc_banco_normalized TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, rule_id, desc_banco_normalized)
);

CREATE INDEX IF NOT EXISTS idx_rule_rejections_rule
  ON rule_rejections (user_id, rule_id);

CREATE INDEX IF NOT EXISTS idx_rule_rejections_user_created
  ON rule_rejections (user_id, created_at DESC);

-- Add missing indices for efficient category deletes and rule lookups
CREATE INDEX IF NOT EXISTS idx_rules_category_id
  ON rules (user_id, category_id);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-rule-rejections-parity');
