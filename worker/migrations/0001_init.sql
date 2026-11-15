-- EVAde D1 schema, matching the Python stand-in SQLite tables in api/voice_tools.py
-- plus one-time Twilio Media Stream tokens (previously in-memory).

CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    crew_id TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'voice',
    sleep_hours REAL,
    mood INTEGER,
    symptoms TEXT,
    systolic INTEGER,
    diastolic INTEGER,
    temperature_c REAL,
    blood_sugar_mg_dl REAL,
    notes TEXT,
    level TEXT NOT NULL,
    reasons TEXT NOT NULL,
    actions TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS downlink_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    crew_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    message TEXT NOT NULL,
    checkin_id INTEGER,
    comms_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    arrives_at TEXT
);

CREATE TABLE IF NOT EXISTS stream_tokens (
    token TEXT PRIMARY KEY,
    call_sid TEXT,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON checkins (created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_crew_id_created_at ON checkins (crew_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_crew_id_id ON checkins (crew_id, id);

CREATE INDEX IF NOT EXISTS idx_downlink_queue_created_at ON downlink_queue (created_at);
CREATE INDEX IF NOT EXISTS idx_downlink_queue_crew_id_id ON downlink_queue (crew_id, id);
CREATE INDEX IF NOT EXISTS idx_downlink_queue_status ON downlink_queue (status);

CREATE INDEX IF NOT EXISTS idx_stream_tokens_expires_at ON stream_tokens (expires_at);
