CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

ALTER TABLE categories ADD COLUMN slug TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN origin TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE rules ADD COLUMN normalized_pattern TEXT NOT NULL DEFAULT '';

ALTER TABLE transactions ADD COLUMN categorization_status TEXT NOT NULL DEFAULT 'uncategorized';
ALTER TABLE transactions ADD COLUMN category_source TEXT;
ALTER TABLE transactions ADD COLUMN category_confidence REAL;
ALTER TABLE transactions ADD COLUMN category_rule_id INTEGER;

CREATE TABLE IF NOT EXISTS categorization_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  transaction_id INTEGER NOT NULL,
  rule_id INTEGER,
  category_id INTEGER,
  decision TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_categorization_events_user_tx
ON categorization_events(user_id, transaction_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_categorization_events_user_rule
ON categorization_events(user_id, rule_id, created_at DESC);

UPDATE categories
SET slug = lower(trim(replace(replace(replace(name, ' ', '_'), '-', '_'), '/', '_')))
WHERE slug = '';

UPDATE categories SET slug = 'ingreso' WHERE lower(name) = 'ingreso';
UPDATE categories SET slug = 'alquiler' WHERE lower(name) = 'alquiler';
UPDATE categories SET slug = 'supermercado' WHERE lower(name) = 'supermercado';
UPDATE categories SET slug = 'transporte' WHERE lower(name) = 'transporte';
UPDATE categories SET slug = 'suscripciones' WHERE lower(name) = 'suscripciones';
UPDATE categories SET slug = 'comer_afuera' WHERE lower(name) = 'comer afuera';
UPDATE categories SET slug = 'delivery' WHERE lower(name) = 'delivery';
UPDATE categories SET slug = 'streaming' WHERE lower(name) = 'streaming';
UPDATE categories SET slug = 'telefonia' WHERE lower(name) = 'telefonia';
UPDATE categories SET slug = 'gimnasio' WHERE lower(name) = 'gimnasio';
UPDATE categories SET slug = 'mascotas' WHERE lower(name) = 'mascotas';
UPDATE categories SET slug = 'servicios' WHERE lower(name) = 'servicios';
UPDATE categories SET slug = 'salud' WHERE lower(name) = 'salud';
UPDATE categories SET slug = 'otros' WHERE lower(name) = 'otros';
UPDATE categories SET slug = 'reintegro' WHERE lower(name) = 'reintegro';
UPDATE categories SET slug = 'transferencia' WHERE lower(name) = 'transferencia';
UPDATE categories SET slug = 'restaurantes' WHERE lower(name) = 'restaurantes';

UPDATE categories
SET origin = 'seed'
WHERE slug IN (
  'ingreso', 'alquiler', 'supermercado', 'transporte', 'suscripciones',
  'comer_afuera', 'delivery', 'streaming', 'telefonia', 'gimnasio',
  'mascotas', 'servicios', 'salud', 'otros', 'reintegro', 'transferencia',
  'restaurantes'
);

UPDATE rules
SET normalized_pattern = lower(trim(pattern))
WHERE normalized_pattern = '';

UPDATE transactions
SET categorization_status = CASE
  WHEN category_id IS NULL THEN 'uncategorized'
  ELSE 'categorized'
END
WHERE categorization_status NOT IN ('uncategorized', 'suggested', 'categorized');

UPDATE transactions
SET category_source = CASE
  WHEN category_id IS NULL THEN NULL
  ELSE COALESCE(category_source, 'legacy')
END;

UPDATE transactions
SET category_confidence = CASE
  WHEN category_id IS NULL THEN NULL
  ELSE category_confidence
END;

UPDATE transactions
SET category_rule_id = NULL
WHERE category_id IS NULL;

UPDATE transactions
SET category_id = NULL,
    categorization_status = 'uncategorized',
    category_source = NULL,
    category_confidence = NULL,
    category_rule_id = NULL
WHERE category_id IN (
  SELECT id
  FROM categories
  WHERE slug = 'restaurantes'
);

DELETE FROM rules
WHERE category_id IN (
  SELECT id
  FROM categories
  WHERE slug = 'restaurantes'
);

DELETE FROM categories
WHERE slug = 'restaurantes';

DELETE FROM rules;
DELETE FROM rule_exclusions;
DELETE FROM categorization_events;

DELETE FROM categories
WHERE origin = 'auto';

DROP INDEX IF EXISTS idx_rules_user_pattern;

CREATE INDEX IF NOT EXISTS idx_categories_user_slug
ON categories(user_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_user_scope
ON rules(
  user_id,
  normalized_pattern,
  IFNULL(account_id, ''),
  IFNULL(currency, ''),
  direction
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_status
ON transactions(user_id, categorization_status, fecha DESC);

INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '2026-03-contract-v1');
UPDATE system_meta SET value = '2026-03-contract-v1' WHERE key = 'schema_version';
