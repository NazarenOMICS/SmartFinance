ALTER TABLE rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'suggest';
ALTER TABLE rules ADD COLUMN confidence REAL NOT NULL DEFAULT 0.72;
ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE rules ADD COLUMN account_id TEXT;
ALTER TABLE rules ADD COLUMN currency TEXT;
ALTER TABLE rules ADD COLUMN direction TEXT NOT NULL DEFAULT 'any';
ALTER TABLE rules ADD COLUMN merchant_key TEXT;
ALTER TABLE rules ADD COLUMN last_matched_at TEXT;

CREATE INDEX IF NOT EXISTS idx_rules_user_mode ON rules(user_id, mode);
CREATE INDEX IF NOT EXISTS idx_rules_user_source ON rules(user_id, source);
CREATE INDEX IF NOT EXISTS idx_rules_user_account ON rules(user_id, account_id);

INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('', 'categorizer_auto_threshold', '0.88');
INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('', 'categorizer_suggest_threshold', '0.68');
INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('', 'categorizer_ollama_enabled', '0');
INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('', 'categorizer_ollama_url', '');
INSERT OR IGNORE INTO settings (user_id, key, value) VALUES ('', 'categorizer_ollama_model', 'qwen2.5:3b');
