-- 0006: Daniel's voice check-ins and flight-surgeon messages, caller phone numbers, and a daily-intake view.
-- (Ryan L's PR #3 "0005", renumbered: 0005_meals_hydration.sql already created meals/hydration, so this file
--  only adds what was missing and the view uses those existing columns.)
-- Additive only: new tables, new nullable/defaulted columns, new indexes and views. No existing data changes.

-- Today's intake per astronaut (UTC day), for the dashboard and NutritionPanel.
CREATE VIEW IF NOT EXISTS v_daily_intake AS
SELECT user_id, day,
  SUM(kcal) AS kcal, SUM(protein) AS protein_g, SUM(carbs) AS carbs_g, SUM(fat) AS fat_g,
  SUM(meal_count) AS meals, SUM(water_ml) AS water_ml
FROM (
  SELECT user_id, substr(ts,1,10) AS day, kcal, protein, carbs, fat, 1 AS meal_count, 0 AS water_ml FROM meals
  UNION ALL
  SELECT user_id, substr(ts,1,10), 0, 0, 0, 0, 0, amount_ml FROM hydration
)
GROUP BY user_id, day;

-- ---------- Voice check-ins (feature/twilio-grok-voice-agent: checkins table, save_checkin tool) ----------
-- A voice check-in becomes one self_reports row:
--   checkins.mood            -> self_reports.mood (1-5)
--   checkins.sleep_hours     -> self_reports.sleep_hours (+ an observations row, metric 'sleep_hours')
--   checkins.symptoms        -> self_reports.symptoms (JSON array)
--   checkins.notes           -> self_reports.note
--   checkins.level/reasons/actions -> self_reports.checkin_level / reasons / actions
--   systolic, diastolic, temperature_c, blood_sugar_mg_dl -> observations rows
--     (metrics systolic_bp, diastolic_bp, body_temp, blood_glucose; source 'manual', device 'voice_agent')
--   a 'red' (or 'yellow') result -> an alerts row with source 'voice' and self_report_id set.
-- crew_id is NOT copied: the user_id must come from the login session or a verified phone number.
ALTER TABLE self_reports ADD COLUMN source TEXT NOT NULL DEFAULT 'app'
  CHECK (source IN ('app','voice_web','voice_phone'));
ALTER TABLE self_reports ADD COLUMN sleep_hours REAL CHECK (sleep_hours IS NULL OR (sleep_hours >= 0 AND sleep_hours <= 24));
ALTER TABLE self_reports ADD COLUMN symptoms TEXT;          -- JSON array of strings
ALTER TABLE self_reports ADD COLUMN checkin_level TEXT CHECK (checkin_level IS NULL OR checkin_level IN ('green','yellow','red'));
ALTER TABLE self_reports ADD COLUMN reasons TEXT;           -- JSON array (models/checkin_rules)
ALTER TABLE self_reports ADD COLUMN actions TEXT;           -- JSON array (models/checkin_rules)
ALTER TABLE self_reports ADD COLUMN call_ref TEXT;          -- Twilio CallSid or voice session id, for audit

ALTER TABLE alerts ADD COLUMN source TEXT NOT NULL DEFAULT 'rules'
  CHECK (source IN ('rules','voice','model','flight_surgeon'));
ALTER TABLE alerts ADD COLUMN self_report_id INTEGER REFERENCES self_reports(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD COLUMN acknowledged_by TEXT REFERENCES users(user_id) ON DELETE SET NULL;

-- ---------- Messages (Daniel's downlink_queue + flight-surgeon messages) ----------
-- user_id is the astronaut the conversation belongs to. sender_id is the flight surgeon /
-- therapist for a downlink, or the astronaut for an uplink reply.
CREATE TABLE IF NOT EXISTS messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      TEXT UNIQUE,
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  sender_id      TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('downlink','uplink')),   -- downlink = ground -> crew
  sender_role    TEXT NOT NULL CHECK (sender_role IN ('astronaut','flight_surgeon','therapist','admin','system')),
  priority       TEXT NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','urgent')),
  body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  comms_mode     TEXT NOT NULL DEFAULT 'online' CHECK (comms_mode IN ('online','mars','blackout')),
  status         TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('queued','in_transit','sent','delivered','read')),
  arrives_at     TEXT,                                 -- simulated light-time delay (Mars ~20 min)
  read_at        TEXT,
  self_report_id INTEGER REFERENCES self_reports(id) ON DELETE SET NULL,  -- was downlink_queue.checkin_id
  alert_id       INTEGER REFERENCES alerts(id) ON DELETE SET NULL,
  ts             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_user_ts ON messages(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, arrives_at);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

-- ---------- Phone numbers (Twilio caller -> user) ----------
-- The voice agent looks up the Twilio "From" number here before save_checkin writes anything.
-- Only rows with verified_at set may write to a user's record; unknown or unverified callers
-- can talk to EVAde but nothing is saved against anyone.
CREATE TABLE IF NOT EXISTS phone_numbers (
  phone_e164   TEXT PRIMARY KEY CHECK (phone_e164 GLOB '+[1-9]*' AND length(phone_e164) BETWEEN 8 AND 16),
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label        TEXT,                                -- e.g. 'station handset', 'personal'
  verified_at  TEXT,                                -- set after an SMS / call code check
  last_call_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_phone_user ON phone_numbers(user_id);

-- user_id + timestamp indexes for dashboard queries and the per-user delete, on tables that lacked one.
CREATE INDEX IF NOT EXISTS idx_instruments_user_ts ON instruments(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_action_log_user ON action_log(user_id);
