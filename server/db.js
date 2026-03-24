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

function migrate() {
  db.exec(`
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
  `);

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

