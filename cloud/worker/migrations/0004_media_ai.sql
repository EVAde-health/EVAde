-- 0004: R2 media metadata + Workers AI journal analysis fields

-- Files live in R2 (bucket evade-media); D1 keeps who/what/when so they can be listed and access-checked.
CREATE TABLE IF NOT EXISTS media (
  id            TEXT PRIMARY KEY,                -- UUID, also part of the R2 key
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,            -- users/<user_id>/<kind>/<id>.<ext>
  kind          TEXT NOT NULL CHECK (kind IN ('photo','ultrasound','audio','document','other')),
  content_type  TEXT NOT NULL,
  bytes         INTEGER NOT NULL,
  metric        TEXT,                            -- health indicator this file documents, if any
  note          TEXT,
  ts            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_user_ts ON media(user_id, ts DESC);

-- Journal analysis by Workers AI
ALTER TABLE journal_entries ADD COLUMN media_id TEXT;           -- voice journal audio in R2
ALTER TABLE journal_entries ADD COLUMN mood_label TEXT;         -- e.g. calm, tired, anxious, low
ALTER TABLE journal_entries ADD COLUMN concern_level TEXT;      -- none / low / moderate / high
ALTER TABLE journal_entries ADD COLUMN analyzed_at TEXT;
ALTER TABLE journal_entries ADD COLUMN analysis_model TEXT;
