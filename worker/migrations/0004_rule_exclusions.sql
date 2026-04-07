CREATE TABLE IF NOT EXISTS rule_exclusions (
  user_id TEXT NOT NULL DEFAULT '',
  rule_id INTEGER NOT NULL,
  transaction_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, rule_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_rule_exclusions_user_tx
ON rule_exclusions(user_id, transaction_id);
