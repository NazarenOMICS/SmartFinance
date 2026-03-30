PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS category_merge_map (
  old_id INTEGER NOT NULL,
  new_id INTEGER NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (old_id, user_id)
);

DELETE FROM category_merge_map;

INSERT INTO category_merge_map (old_id, new_id, user_id)
SELECT
  c.id AS old_id,
  (
    SELECT MIN(c2.id)
    FROM categories c2
    WHERE c2.user_id = c.user_id
      AND COALESCE(NULLIF(c2.slug, ''), lower(trim(replace(replace(replace(c2.name, ' ', '_'), '-', '_'), '/', '_')))) =
          COALESCE(NULLIF(c.slug, ''), lower(trim(replace(replace(replace(c.name, ' ', '_'), '-', '_'), '/', '_'))))
  ) AS new_id,
  c.user_id
FROM categories c;

UPDATE transactions
SET category_id = (
  SELECT new_id
  FROM category_merge_map map
  WHERE map.old_id = transactions.category_id
    AND map.user_id = transactions.user_id
)
WHERE category_id IS NOT NULL;

UPDATE rules
SET category_id = (
  SELECT new_id
  FROM category_merge_map map
  WHERE map.old_id = rules.category_id
    AND map.user_id = rules.user_id
)
WHERE category_id IS NOT NULL;

CREATE TABLE categories_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  budget REAL DEFAULT 0,
  type TEXT DEFAULT 'variable',
  color TEXT,
  sort_order INTEGER DEFAULT 0,
  slug TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'manual'
);

INSERT INTO categories_new (id, user_id, name, budget, type, color, sort_order, slug, origin)
SELECT
  c.id,
  c.user_id,
  c.name,
  c.budget,
  c.type,
  c.color,
  c.sort_order,
  COALESCE(NULLIF(c.slug, ''), lower(trim(replace(replace(replace(c.name, ' ', '_'), '-', '_'), '/', '_')))),
  CASE
    WHEN c.origin IN ('seed', 'manual', 'auto') THEN c.origin
    ELSE 'manual'
  END
FROM categories c
WHERE c.id IN (
  SELECT DISTINCT new_id
  FROM category_merge_map
  WHERE user_id = c.user_id
);

DROP TABLE categories;
ALTER TABLE categories_new RENAME TO categories;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_id_user ON categories(id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name ON categories(user_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_categories_user_slug ON categories(user_id, slug);

DROP TABLE category_merge_map;

PRAGMA foreign_keys=ON;
