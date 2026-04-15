ALTER TABLE uploads ADD COLUMN detected_format TEXT;
ALTER TABLE uploads ADD COLUMN parse_failure_reason TEXT;

INSERT OR REPLACE INTO system_meta (key, value)
VALUES ('schema_version', '2026-04-import-diagnostics-v7');
