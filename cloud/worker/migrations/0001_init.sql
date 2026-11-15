-- EVAde D1 schema v1
-- Matches the storage design in EVAde-backend-models "lit review/planning/baseline-comparison.md" section 6,
-- plus the frontend needs from the whiteboard: to-do list + gamification, journal, alerts, tutorial content.
-- All times are ISO-8601 UTC strings. user_id is a pseudonymous UUID4 (never a name or email).


-- ---------- Crew / identity ----------
CREATE TABLE IF NOT EXISTS users (
  user_id        TEXT PRIMARY KEY,                 -- UUID4
  display_name   TEXT NOT NULL,                    -- callsign shown in UI
  role           TEXT NOT NULL DEFAULT 'astronaut' CHECK (role IN ('astronaut','flight_surgeon','therapist','admin')),
  environment    TEXT NOT NULL DEFAULT 'station'   CHECK (environment IN ('spacecraft','station','rover','planetary_base')),
  mission_name   TEXT,
  mission_start  TEXT,                             -- day 0 of the mission
  consent        INTEGER NOT NULL DEFAULT 1,
  points         INTEGER NOT NULL DEFAULT 0,       -- gamification
  streak_days    INTEGER NOT NULL DEFAULT 0,
  last_active    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------- Health indicator catalogue (drives color coding + tutorial) ----------
CREATE TABLE IF NOT EXISTS metric_definitions (
  metric          TEXT PRIMARY KEY,                -- e.g. heart_rate
  label           TEXT NOT NULL,
  unit            TEXT NOT NULL,
  domain          TEXT NOT NULL CHECK (domain IN ('cardiac','behavioral','neuro','radiation','bone','nutrition','general')),
  green_min       REAL, green_max  REAL,           -- inside = green
  yellow_min      REAL, yellow_max REAL,           -- inside (but outside green) = yellow, else red
  bad_direction   TEXT NOT NULL DEFAULT 'both' CHECK (bad_direction IN ('up','down','both')),
  how_to_measure  TEXT NOT NULL,                   -- tutorial: how to take it in space
  why_it_matters  TEXT NOT NULL,                   -- tutorial: which spaceflight hazard affects it
  what_to_do      TEXT NOT NULL,                   -- guidance when yellow/red
  escalate_when   TEXT NOT NULL                    -- when to contact flight surgeon
);

-- ---------- Raw-ish observations (summaries, never raw waveforms) ----------
CREATE TABLE IF NOT EXISTS observations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id     TEXT UNIQUE,                       -- idempotency key for offline sync (IndexedDB -> cloud)
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric        TEXT NOT NULL REFERENCES metric_definitions(metric),
  value         REAL NOT NULL,
  unit          TEXT NOT NULL,
  ts            TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','device','camera','model','synthetic')),
  device        TEXT,
  quality       REAL CHECK (quality IS NULL OR (quality >= 0 AND quality <= 1)),
  context_tags  TEXT,                              -- JSON array: ["exercise","caffeine",...]
  level         TEXT CHECK (level IN ('green','yellow','red')),
  z             REAL,                              -- robust z vs personal baseline, if available
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_obs_user_metric_ts ON observations(user_id, metric, ts DESC);

-- ---------- Personal baselines (robust median / MAD) ----------
CREATE TABLE IF NOT EXISTS baselines (
  baseline_id      TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric           TEXT NOT NULL REFERENCES metric_definitions(metric),
  center           REAL NOT NULL,                  -- median
  spread           REAL NOT NULL,                  -- 1.4826 * MAD, floored at 15% of |center|
  n                INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','locked','confirmed','archived','demo')),
  phase            TEXT NOT NULL DEFAULT 'steady_state',
  window_start     TEXT, window_end TEXT,
  pipeline_version TEXT NOT NULL DEFAULT 'v1',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_baseline_user_metric ON baselines(user_id, metric, status);

-- ---------- Self reports / mood ----------
CREATE TABLE IF NOT EXISTS self_reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      TEXT UNIQUE,
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts             TEXT NOT NULL,
  mood           INTEGER CHECK (mood BETWEEN 1 AND 5),
  stress         INTEGER CHECK (stress BETWEEN 1 AND 5),
  fatigue        INTEGER CHECK (fatigue BETWEEN 1 AND 5),
  sleep_quality  INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
  note           TEXT
);
CREATE INDEX IF NOT EXISTS idx_self_user_ts ON self_reports(user_id, ts DESC);

-- ---------- Questionnaires / cognitive tests (PHQ-9, GAD-7, PVT) ----------
CREATE TABLE IF NOT EXISTS instruments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  instrument  TEXT NOT NULL CHECK (instrument IN ('PHQ9','GAD7','PVT')),
  score       REAL NOT NULL,
  answers     TEXT,                                -- JSON
  escalate    INTEGER NOT NULL DEFAULT 0,          -- e.g. PHQ-9 item 9 > 0 -> human review
  ts          TEXT NOT NULL
);

-- ---------- Journal (voice/text -> LLM summary for therapist view) ----------
CREATE TABLE IF NOT EXISTS journal_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts          TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'text' CHECK (source IN ('text','voice')),
  content     TEXT NOT NULL,
  ai_summary  TEXT,                                -- filled by Ryan B's LLM step
  sentiment   REAL,                                -- -1..1
  flags       TEXT                                 -- JSON
);
CREATE INDEX IF NOT EXISTS idx_journal_user_ts ON journal_entries(user_id, ts DESC);

-- ---------- Space environment (written by the Worker cron + Python module) ----------
CREATE TABLE IF NOT EXISTS space_weather (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  ts                 TEXT NOT NULL UNIQUE,
  kp_index           REAL,                         -- NOAA planetary K
  proton_flux_10mev  REAL,                         -- GOES >=10 MeV, pfu
  xray_flux          REAL,                         -- GOES 0.1-0.8 nm, W/m^2
  xray_class         TEXT,
  storm_level        TEXT,                         -- NOAA S-scale (S0..S5)
  eva_status         TEXT CHECK (eva_status IN ('go','caution','no_go')),
  source             TEXT NOT NULL DEFAULT 'NOAA SWPC'
);

CREATE TABLE IF NOT EXISTS radiation_doses (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id          TEXT UNIQUE,
  user_id            TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts                 TEXT NOT NULL,
  dose_rate_usv_h    REAL,                         -- microsievert / hour
  daily_dose_msv     REAL,
  cumulative_msv     REAL,
  spe_flag           INTEGER NOT NULL DEFAULT 0,   -- solar particle event
  location           TEXT,                         -- e.g. 'inside', 'eva', 'storm_shelter'
  source             TEXT NOT NULL DEFAULT 'dosimeter'
);
CREATE INDEX IF NOT EXISTS idx_rad_user_ts ON radiation_doses(user_id, ts DESC);

-- ---------- Results from Michael's FastAPI models ----------
CREATE TABLE IF NOT EXISTS model_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL,                      -- /predict/ecg, /predict/eeg, /predict/radiation-risk, /predict/risk
  model_id     TEXT,                               -- EVA-[n]
  ts           TEXT NOT NULL,
  output       TEXT NOT NULL,                      -- full JSON response
  flag         TEXT,                               -- short result class
  confidence   TEXT
);
CREATE INDEX IF NOT EXISTS idx_model_user_ts ON model_results(user_id, ts DESC);

CREATE TABLE IF NOT EXISTS risk_scores (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts             TEXT NOT NULL,
  r              REAL NOT NULL CHECK (r >= 0 AND r <= 1),
  band           TEXT NOT NULL,                    -- low / moderate / high / critical
  mdtr           TEXT,                             -- "<5", "5-100", ">100" days
  domains        TEXT NOT NULL,                    -- JSON {cardiac:0.1, behavioral:...}
  top_domains    TEXT,
  override       TEXT,
  source         TEXT NOT NULL DEFAULT 'worker'    -- worker (rule-based) or fastapi
);
CREATE INDEX IF NOT EXISTS idx_risk_user_ts ON risk_scores(user_id, ts DESC);

-- ---------- Alerts / escalation to flight surgeon ----------
CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  ts            TEXT NOT NULL,
  level         TEXT NOT NULL CHECK (level IN ('yellow','red')),
  metric        TEXT,
  message       TEXT NOT NULL,
  action        TEXT,                              -- recommended step
  escalate      INTEGER NOT NULL DEFAULT 0,        -- contact flight surgeon
  acknowledged  INTEGER NOT NULL DEFAULT 0,
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_open ON alerts(user_id, acknowledged, ts DESC);

-- ---------- To-do list + gamification ----------
CREATE TABLE IF NOT EXISTS tasks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'basic' CHECK (category IN ('basic','advanced')),  -- whiteboard: basic vs non-basic
  metric        TEXT,                              -- measurement this task collects, if any
  recurrence    TEXT,                              -- 'daily', 'weekly', or null
  due_at        TEXT,
  points        INTEGER NOT NULL DEFAULT 10,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, completed_at, due_at);

-- ---------- Audit / action log ----------
CREATE TABLE IF NOT EXISTS action_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   TEXT,
  ts        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action    TEXT NOT NULL,
  detail    TEXT
);
