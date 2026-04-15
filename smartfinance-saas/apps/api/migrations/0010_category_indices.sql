-- Add missing indices for efficient category deletion and rule lookups
CREATE INDEX IF NOT EXISTS idx_rules_category_id
  ON rules (user_id, category_id);

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-category-indices');
