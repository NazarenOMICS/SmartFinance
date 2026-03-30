UPDATE transactions
SET category_id = NULL
WHERE category_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM categories c
    WHERE c.id = transactions.category_id
      AND c.user_id = transactions.user_id
  );

UPDATE transactions
SET categorization_status = CASE
  WHEN category_id IS NULL THEN 'uncategorized'
  ELSE 'categorized'
END;

UPDATE transactions
SET category_source = CASE
  WHEN category_id IS NULL THEN NULL
  ELSE COALESCE(NULLIF(category_source, ''), 'legacy')
END;

UPDATE transactions
SET category_confidence = NULL
WHERE category_id IS NULL;

UPDATE transactions
SET category_rule_id = NULL
WHERE category_id IS NULL;

UPDATE categories
SET origin = 'manual'
WHERE origin NOT IN ('seed', 'manual', 'auto');

INSERT OR IGNORE INTO system_meta (key, value) VALUES ('schema_version', '2026-03-contract-v2');
UPDATE system_meta SET value = '2026-03-contract-v2' WHERE key = 'schema_version';
