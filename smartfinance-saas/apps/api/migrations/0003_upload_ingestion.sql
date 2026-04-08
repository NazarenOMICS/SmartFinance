ALTER TABLE transactions ADD COLUMN upload_id INTEGER;
ALTER TABLE uploads ADD COLUMN tx_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_transactions_user_upload
  ON transactions (user_id, upload_id, created_at DESC);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-upload-ingestion-v3');
