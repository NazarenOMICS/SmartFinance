ALTER TABLE account_links ADD COLUMN preferred_currency TEXT;
ALTER TABLE account_links ADD COLUMN reconciled_pairs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_links ADD COLUMN last_reconciled_at TEXT;

ALTER TABLE bank_formats ADD COLUMN bank_name TEXT;
ALTER TABLE bank_formats ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE transactions ADD COLUMN paired_transaction_id INTEGER;
ALTER TABLE transactions ADD COLUMN account_link_id INTEGER;
ALTER TABLE transactions ADD COLUMN internal_group_id TEXT;
ALTER TABLE transactions ADD COLUMN installment_id INTEGER;

UPDATE system_meta
SET value = '2026-04-legacy-frontend-parity-v4'
WHERE key = 'schema_version';
