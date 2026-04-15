CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  stripe_customer_id TEXT,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-ops-hardening-v6');
