-- =============================================================================
-- evade-db  ·  migration 0007_admin_goals_chat.sql
-- Additive tables for the flight-surgeon console:
--   * per-astronaut daily goals, with a history row for every change
--   * astronaut-raised emergencies (acknowledge / resolve)
--   * 1:1 chat between an astronaut and a specific staff member
-- No DROP, RENAME, or rewrite. Apply once after 0006_frontend_gaps.sql.
-- Timestamps are ISO-8601 UTC text, matching the rest of evade-db.
-- =============================================================================

-- Current goal = the row with superseded_at IS NULL. Editing a goal closes
-- that row and inserts a new one, so the previous targets stay queryable.
CREATE TABLE IF NOT EXISTS daily_goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric        TEXT NOT NULL REFERENCES metric_definitions(metric),
  target        REAL NOT NULL,
  unit          TEXT,
  note          TEXT,
  set_by        TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  effective_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  superseded_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_goals_current
  ON daily_goals(user_id, metric) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_daily_goals_history
  ON daily_goals(user_id, metric, effective_at DESC);

-- An astronaut presses the emergency control. Staff acknowledge, then resolve.
CREATE TABLE IF NOT EXISTS emergencies (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  message          TEXT,
  alert_id         INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  acknowledged_at  TEXT,
  acknowledged_by  TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  resolved_at      TEXT,
  resolved_by      TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  resolution_note  TEXT
);

CREATE INDEX IF NOT EXISTS idx_emergencies_status ON emergencies(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergencies_user ON emergencies(user_id, created_at DESC);

-- One thread per astronaut + staff pair. Messages stay on that thread.
CREATE TABLE IF NOT EXISTS staff_threads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  astronaut_id  TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  staff_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (astronaut_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_threads_staff ON staff_threads(staff_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_threads_astronaut ON staff_threads(astronaut_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS staff_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id   INTEGER NOT NULL REFERENCES staff_threads(id) ON DELETE CASCADE,
  sender_id   TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  read_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_staff_messages_thread ON staff_messages(thread_id, id);
CREATE INDEX IF NOT EXISTS idx_staff_messages_unread ON staff_messages(thread_id, read_at);
