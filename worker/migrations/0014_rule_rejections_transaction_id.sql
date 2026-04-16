ALTER TABLE rule_rejections ADD COLUMN transaction_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_rule_rejections_transaction
  ON rule_rejections (user_id, transaction_id);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-rule-rejections-transaction-id');
