-- Migration 0002: Multi-tenant support — add user_id to all tables
-- Run with: wrangler d1 execute smartfinance --file=migrations/0002_add_user_id.sql

-- transactions
ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);

-- categories
ALTER TABLE categories ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_cat_user ON categories(user_id);

-- accounts
ALTER TABLE accounts ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_acc_user ON accounts(user_id);

-- rules
ALTER TABLE rules ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id);

-- installments
ALTER TABLE installments ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_inst_user ON installments(user_id);

-- uploads
ALTER TABLE uploads ADD COLUMN user_id TEXT NOT NULL DEFAULT '';

-- settings: can't change PK in SQLite, so recreate with composite PK
CREATE TABLE IF NOT EXISTS settings_new (
  user_id TEXT NOT NULL DEFAULT '',
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
INSERT INTO settings_new (user_id, key, value)
  SELECT '', key, value FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
