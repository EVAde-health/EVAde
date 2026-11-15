-- Live browser/app voice sessions, used for the global concurrency cap.
-- Rows with a heartbeat in the last ~2 minutes are treated as active.

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL,
    heartbeat INTEGER NOT NULL,
    mode TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_heartbeat ON sessions (heartbeat);
CREATE INDEX IF NOT EXISTS idx_sessions_mode_heartbeat ON sessions (mode, heartbeat);
