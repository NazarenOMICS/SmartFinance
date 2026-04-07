CREATE TABLE IF NOT EXISTS account_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  account_a_id TEXT NOT NULL,
  account_b_id TEXT NOT NULL,
  relation_type TEXT NOT NULL DEFAULT 'fx_pair',
  preferred_currency TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(account_a_id, account_b_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_account_links_user
ON account_links(user_id);

INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '2026-04-account-links-v1');
UPDATE system_meta SET value = '2026-04-account-links-v1' WHERE key = 'schema_version';
