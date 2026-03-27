CREATE TABLE IF NOT EXISTS accounts (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  currency TEXT NOT NULL,
  balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (id, user_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  budget REAL DEFAULT 0,
  type TEXT DEFAULT 'variable',
  color TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL,
  account_id TEXT,
  tx_count INTEGER DEFAULT 0,
  period TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id)
);

CREATE TABLE IF NOT EXISTS installments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  descripcion TEXT NOT NULL,
  monto_total REAL NOT NULL,
  cantidad_cuotas INTEGER NOT NULL,
  cuota_actual INTEGER NOT NULL,
  monto_cuota REAL NOT NULL,
  account_id TEXT,
  start_month TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
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
  FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id),
  FOREIGN KEY (installment_id, user_id) REFERENCES installments(id, user_id),
  FOREIGN KEY (upload_id, user_id) REFERENCES uploads(id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tx_fecha ON transactions(fecha);
CREATE INDEX IF NOT EXISTS idx_tx_dedup ON transactions(dedup_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_id_user ON categories(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_uploads_id_user ON uploads(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_installments_id_user ON installments(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  pattern TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  match_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id, user_id) REFERENCES categories(id, user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_user_pattern ON rules(user_id, pattern COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);
