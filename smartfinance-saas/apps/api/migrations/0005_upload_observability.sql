ALTER TABLE uploads ADD COLUMN parser TEXT;
ALTER TABLE uploads ADD COLUMN ai_assisted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN ai_provider TEXT;
ALTER TABLE uploads ADD COLUMN ai_model TEXT;
ALTER TABLE uploads ADD COLUMN extracted_candidates INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN duplicates_skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN auto_categorized_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN suggested_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN pending_review_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN unmatched_count INTEGER NOT NULL DEFAULT 0;

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-upload-observability-v5');
