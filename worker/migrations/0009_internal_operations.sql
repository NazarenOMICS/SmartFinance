ALTER TABLE transactions ADD COLUMN movement_kind TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE transactions ADD COLUMN internal_operation_id INTEGER;
ALTER TABLE transactions ADD COLUMN counterparty_account_id TEXT;

CREATE TABLE IF NOT EXISTS internal_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  source_transaction_id INTEGER NOT NULL,
  target_transaction_id INTEGER,
  from_account_id TEXT NOT NULL,
  to_account_id TEXT,
  from_currency TEXT NOT NULL,
  to_currency TEXT,
  effective_rate REAL,
  status TEXT NOT NULL DEFAULT 'suggested',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_operations_user_status
ON internal_operations(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_operations_source_tx
ON internal_operations(user_id, source_transaction_id);

CREATE INDEX IF NOT EXISTS idx_internal_operations_target_tx
ON internal_operations(user_id, target_transaction_id);

UPDATE transactions
SET movement_kind = CASE
  WHEN category_id IN (
    SELECT id
    FROM categories
    WHERE user_id = transactions.user_id
      AND slug = 'transferencia'
  ) THEN 'internal_transfer'
  ELSE 'normal'
END
WHERE movement_kind NOT IN ('normal', 'internal_transfer', 'fx_exchange');

INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '2026-03-contract-v4');
UPDATE system_meta SET value = '2026-03-contract-v4' WHERE key = 'schema_version';
