-- =============================================================================
-- evade-db  ·  migration 0010_surgeon_console.sql
-- Flight-surgeon console, add-only. Apply after 0009_staff_console.sql.
--   * user_goals            per-astronaut targets; every change is a new row, latest row wins
--   * conversations         one 1:1 thread per (astronaut, flight surgeon) pair, no groups
--   * conversation_messages messages on a thread, with read receipts
--   * vital_corrections     audit trail when a surgeon corrects a recorded vital
--   * user_notifications    notes shown to a user (goal changed, surgeon responding, ...)
-- emergencies (0009) is reused as-is. daily_goals / staff_threads / staff_messages (0009)
-- are superseded: their rows are copied here once and the Worker no longer reads them.
-- No DROP, RENAME, or rewrite of existing tables. Timestamps are ISO-8601 UTC text.
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_goals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  goal_type   TEXT NOT NULL CHECK (goal_type IN ('calories','protein','carbs','fat','water_ml','sleep_h','steps')),
  target      REAL NOT NULL CHECK (target >= 0),
  unit        TEXT NOT NULL,
  note        TEXT CHECK (note IS NULL OR length(note) <= 300),
  set_by      TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_user_goals_latest ON user_goals(user_id, goal_type, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  astronaut_id  TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  surgeon_id    TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (astronaut_id, surgeon_id)
);
CREATE INDEX IF NOT EXISTS idx_conversations_surgeon ON conversations(surgeon_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_astronaut ON conversations(astronaut_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body             TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_conv_messages_thread ON conversation_messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_conv_messages_unread ON conversation_messages(conversation_id, read_at, sender_id);

CREATE TABLE IF NOT EXISTS vital_corrections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id   INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric           TEXT NOT NULL,
  original_value   REAL NOT NULL,
  corrected_value  REAL NOT NULL,
  original_level   TEXT,
  corrected_level  TEXT,
  reason           TEXT NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
  corrected_by     TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_vital_corrections_user ON vital_corrections(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vital_corrections_obs ON vital_corrections(observation_id, id);

CREATE TABLE IF NOT EXISTS user_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('goal_updated','emergency_acknowledged','emergency_resolved','vital_corrected','message')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  actor_id    TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user ON user_notifications(user_id, read_at, id DESC);

-- Carry over anything written through the 0009 console so nothing already saved is lost.
INSERT INTO user_goals (user_id, goal_type, target, unit, note, set_by, created_at)
SELECT user_id,
       CASE metric WHEN 'kcal_intake' THEN 'calories' WHEN 'protein_intake_g' THEN 'protein'
                   WHEN 'carbs_intake_g' THEN 'carbs' WHEN 'fat_intake_g' THEN 'fat'
                   WHEN 'water_intake_ml' THEN 'water_ml' ELSE 'sleep_h' END,
       target,
       CASE metric WHEN 'kcal_intake' THEN 'kcal' WHEN 'water_intake_ml' THEN 'ml' WHEN 'sleep_hours' THEN 'h' ELSE 'g' END,
       note, set_by, effective_at
FROM daily_goals
WHERE metric IN ('kcal_intake','protein_intake_g','carbs_intake_g','fat_intake_g','water_intake_ml','sleep_hours')
ORDER BY effective_at, id;

INSERT OR IGNORE INTO conversations (id, astronaut_id, surgeon_id, created_at, updated_at)
SELECT id, astronaut_id, staff_id, created_at, updated_at FROM staff_threads;

INSERT OR IGNORE INTO conversation_messages (id, conversation_id, sender_id, body, created_at, read_at)
SELECT m.id, m.thread_id, m.sender_id, m.body, m.created_at, m.read_at
FROM staff_messages m WHERE EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.thread_id);
