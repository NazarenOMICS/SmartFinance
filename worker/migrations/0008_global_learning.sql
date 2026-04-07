CREATE TABLE IF NOT EXISTS global_pattern_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_pattern TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  user_count INTEGER NOT NULL DEFAULT 0,
  confirm_count INTEGER NOT NULL DEFAULT 0,
  reject_count INTEGER NOT NULL DEFAULT 0,
  confidence_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  UNIQUE(normalized_pattern, category_slug)
);

CREATE TABLE IF NOT EXISTS global_pattern_candidate_users (
  candidate_id INTEGER NOT NULL,
  user_fingerprint TEXT NOT NULL,
  last_decision TEXT NOT NULL DEFAULT 'confirm',
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (candidate_id, user_fingerprint)
);

CREATE TABLE IF NOT EXISTS global_pattern_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized_pattern TEXT NOT NULL UNIQUE,
  category_slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'auto_approved',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_global_pattern_candidates_status
  ON global_pattern_candidates(status, confidence_score DESC, user_count DESC);

INSERT INTO system_meta (key, value)
VALUES ('schema_version', '2026-03-contract-v3')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
