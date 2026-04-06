const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = path.join(__dirname, "finance-tracker.db");
const DEFAULT_PATTERNS = [
  String.raw`^(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s+(.+?)\s+([\-]?\$?\s?[\d.,]+(?:\.\d{2})?)\s*$`
];

if (!fs.existsSync(__dirname)) {
  fs.mkdirSync(__dirname, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

function ensureColumn(table, column, definition) {
  if (hasColumn(table, column)) {
    return false;
  }

  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      balance REAL DEFAULT 0,
      opening_balance REAL DEFAULT 0,
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
      entry_type TEXT,
      movement_type TEXT DEFAULT 'standard',
      transfer_group_id TEXT,
      linked_transaction_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (installment_id) REFERENCES installments(id),
      FOREIGN KEY (upload_id) REFERENCES uploads(id)
    );
    CREATE INDEX IF NOT EXISTS idx_tx_fecha ON transactions(fecha);
    CREATE INDEX IF NOT EXISTS idx_tx_dedup ON transactions(dedup_hash);
    CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);

    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      match_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS rule_rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      desc_banco_normalized TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(rule_id, desc_banco_normalized),
      FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS account_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_a_id TEXT NOT NULL,
      account_b_id TEXT NOT NULL,
      relation_type TEXT DEFAULT 'fx_pair',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(account_a_id, account_b_id),
      FOREIGN KEY (account_a_id) REFERENCES accounts(id),
      FOREIGN KEY (account_b_id) REFERENCES accounts(id)
    );
  `);

  const addedOpeningBalance = ensureColumn("accounts", "opening_balance", "REAL DEFAULT 0");
  ensureColumn("transactions", "entry_type", "TEXT");
  ensureColumn("transactions", "movement_type", "TEXT DEFAULT 'standard'");
  ensureColumn("transactions", "transfer_group_id", "TEXT");
  ensureColumn("transactions", "linked_transaction_id", "INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tx_transfer_group ON transactions(transfer_group_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_rule_rejections_lookup ON rule_rejections(rule_id, desc_banco_normalized)");

  if (addedOpeningBalance) {
    db.prepare(
      `
      UPDATE accounts
      SET opening_balance = COALESCE(balance, 0) - COALESCE((
        SELECT SUM(t.monto)
        FROM transactions t
        WHERE t.account_id = accounts.id
      ), 0)
    `
    ).run();
  }

  db.prepare(
    `
    UPDATE transactions
    SET movement_type = 'standard'
    WHERE movement_type IS NULL OR TRIM(movement_type) = ''
  `
  ).run();

  db.prepare(
    `
    UPDATE transactions
    SET entry_type = CASE
      WHEN COALESCE(movement_type, 'standard') = 'internal_transfer' THEN 'internal_transfer'
      WHEN monto >= 0 THEN 'income'
      ELSE 'expense'
    END
    WHERE entry_type IS NULL OR TRIM(entry_type) = ''
  `
  ).run();

  const defaults = {
    exchange_rate_usd_uyu: "42.5",
    display_currency: "UYU",
    savings_initial: "50000",
    savings_goal: "200000",
    savings_currency: "UYU",
    parsing_patterns: JSON.stringify(DEFAULT_PATTERNS)
  };

  const insertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `);

  Object.entries(defaults).forEach(([key, value]) => insertSetting.run(key, value));
}

function getSettingsObject() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, {});
}

function upsertSetting(key, value) {
  return db
    .prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    .run(key, String(value));
}

function monthWindow(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  const start = `${year}-${String(monthIndex).padStart(2, "0")}-01`;
  const nextMonth = monthIndex === 12 ? 1 : monthIndex + 1;
  const nextYear = monthIndex === 12 ? year + 1 : year;
  const end = `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
  return { start, end };
}

migrate();

module.exports = {
  db,
  DB_PATH,
  DEFAULT_PATTERNS,
  getSettingsObject,
  monthWindow,
  upsertSetting
};

