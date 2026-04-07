ALTER TABLE transactions ADD COLUMN linked_transaction_id INTEGER;
ALTER TABLE transactions ADD COLUMN transfer_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tx_transfer_group ON transactions(transfer_group_id);
CREATE INDEX IF NOT EXISTS idx_tx_linked_tx ON transactions(linked_transaction_id);

INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '2026-04-account-links-columns-v1');
UPDATE system_meta SET value = '2026-04-account-links-columns-v1' WHERE key = 'schema_version';
