CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  budget REAL DEFAULT 0,
  type TEXT DEFAULT 'variable',
  color TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  account_id TEXT,
  tx_count INTEGER DEFAULT 0,
  period TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  descripcion TEXT NOT NULL,
  monto_total REAL NOT NULL,
  cantidad_cuotas INTEGER NOT NULL,
  cuota_actual INTEGER NOT NULL,
  monto_cuota REAL NOT NULL,
  account_id TEXT,
  start_month TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  desc_banco TEXT NOT NULL,
  desc_usuario TEXT,
  monto REAL NOT NULL,
  moneda TEXT NOT NULL DEFAULT 'UYU',
  category_id INTEGER,
  account_id TEXT,
  es_cuota INTEGER DEFAULT 0,
  installment_id INTEGER,
  upload_id INTEGER,
  dedup_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (installment_id) REFERENCES installments(id),
  FOREIGN KEY (upload_id) REFERENCES uploads(id)
);

CREATE INDEX IF NOT EXISTS idx_tx_fecha ON transactions(fecha);
CREATE INDEX IF NOT EXISTS idx_tx_dedup ON transactions(dedup_hash);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  match_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('exchange_rate_usd_uyu', '42.5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('display_currency', 'UYU');
INSERT OR IGNORE INTO settings (key, value) VALUES ('savings_initial', '50000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('savings_goal', '200000');
INSERT OR IGNORE INTO settings (key, value) VALUES ('savings_currency', 'UYU');
INSERT OR IGNORE INTO settings (key, value) VALUES ('parsing_patterns', '["^(\\\\d{1,2}[\\\\/\\\\-]\\\\d{1,2}(?:[\\\\/\\\\-]\\\\d{2,4})?)\\\\s+(.+?)\\\\s+([\\\\-]?\\\\$?\\\\s?[\\\\d.,]+(?:\\\\.\\\\d{2})?)\\\\s*$"]');
