-- =============================================================================
-- evade-db  ·  migration 0006_frontend_gaps.sql
-- Purely ADDITIVE: fills the gaps between the EVAde React frontend
-- (features/web-app) and the existing evade-db schema (0001..0005).
--   * never DROPs, renames or rewrites an existing table
--   * CREATE TABLE / INDEX / VIEW use IF NOT EXISTS
--   * metric catalog rows use INSERT OR IGNORE
--   * ALTER TABLE ... ADD COLUMN is NOT re-runnable in SQLite: apply this file
--     exactly once (wrangler d1 migrations apply does that for you).
-- Timestamps follow the existing convention: TEXT ISO-8601 UTC,
-- always written as strftime('%Y-%m-%dT%H:%M:%fZ') so string order = time order.
-- No BEGIN/COMMIT (D1 wraps each migration file itself).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extra columns on existing tables
-- -----------------------------------------------------------------------------

-- metric_definitions: UI display + rollup hints
ALTER TABLE metric_definitions ADD COLUMN decimals    INTEGER NOT NULL DEFAULT 0;   -- UI rounding (body_temp = 1)
ALTER TABLE metric_definitions ADD COLUMN display_max REAL;                          -- bullet/scale max (immune panel)
ALTER TABLE metric_definitions ADD COLUMN aggregation TEXT NOT NULL DEFAULT 'mean'
  CHECK (aggregation IN ('mean','sum','last'));                                      -- how daily_rollups is read
ALTER TABLE metric_definitions ADD COLUMN ui_group    TEXT;                          -- vitals | sleep | mind | radiation | bone | immune | nutrition | score

-- users: profile + mission fields shown on Dashboard / AppFrame / Login (sign-up)
ALTER TABLE users ADD COLUMN full_name           TEXT;                 -- "Ryan Vega" (display_name stays the call sign)
ALTER TABLE users ADD COLUMN crew_id             TEXT;                 -- "EXP74-FE2" (optional on sign-up)
ALTER TABLE users ADD COLUMN crew_role           TEXT;                 -- job title "Flight Engineer" (users.role = permission)
ALTER TABLE users ADD COLUMN mission_length_days INTEGER;              -- 180  (mission day = now - mission_start)
ALTER TABLE users ADD COLUMN radiation_limit_msv REAL NOT NULL DEFAULT 600;  -- career limit used by RadiationPanel

-- auth_identities: email+password sign-in (provider='password', subject=lower(email))
ALTER TABLE auth_identities ADD COLUMN password_hash TEXT;             -- "pbkdf2-sha256$<iter>$<salt_b64>$<hash_b64>" (WebCrypto)

-- meals: where the food came from (MealLogger typeahead) + offline-sync idempotency
ALTER TABLE meals ADD COLUMN client_id   TEXT;
ALTER TABLE meals ADD COLUMN food_source TEXT CHECK (food_source IS NULL OR food_source IN ('space_pantry','usda','open_food_facts','custom'));
ALTER TABLE meals ADD COLUMN food_ref    TEXT;                         -- e.g. usda-123456, off-<barcode>, pantry-3
ALTER TABLE meals ADD COLUMN brand       TEXT;

-- hydration: offline-sync idempotency
ALTER TABLE hydration ADD COLUMN client_id TEXT;

-- tasks: link a per-user, per-day task row to its template (p-bp, b-selfie ...)
ALTER TABLE tasks ADD COLUMN task_key    TEXT;                         -- task_templates.task_key
ALTER TABLE tasks ADD COLUMN day         TEXT;                         -- local mission day 'YYYY-MM-DD' this instance belongs to
ALTER TABLE tasks ADD COLUMN detail      TEXT;
ALTER TABLE tasks ADD COLUMN tutorial_id TEXT;
ALTER TABLE tasks ADD COLUMN time_window TEXT;                         -- '07:00', 'Weekly'

-- -----------------------------------------------------------------------------
-- 2. New tables
-- -----------------------------------------------------------------------------

-- Per-user goals + UI preferences (today hard-coded / localStorage)
CREATE TABLE IF NOT EXISTS user_settings (
  user_id         TEXT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  kcal_goal       REAL    NOT NULL DEFAULT 2800,
  protein_goal_g  REAL    NOT NULL DEFAULT 110,
  carbs_goal_g    REAL    NOT NULL DEFAULT 360,
  fat_goal_g      REAL    NOT NULL DEFAULT 95,
  water_goal_ml   INTEGER NOT NULL DEFAULT 2500,
  water_step_ml   INTEGER NOT NULL DEFAULT 250,
  sleep_target_h  REAL    NOT NULL DEFAULT 8,
  timezone        TEXT    NOT NULL DEFAULT 'UTC',          -- IANA tz; defines the local 'day' for rollups/tasks
  color_mode      TEXT    CHECK (color_mode IS NULL OR color_mode IN ('light','dark')),  -- localStorage evade:mode
  reduced_motion  INTEGER NOT NULL DEFAULT 0,               -- localStorage evade:motion
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Global catalog of mission tasks (data/tasks.ts). Daily rows are materialised into `tasks`.
CREATE TABLE IF NOT EXISTS task_templates (
  task_key     TEXT PRIMARY KEY,                            -- 'p-bp'
  kind         TEXT NOT NULL CHECK (kind IN ('protocol','basic')),
  category     TEXT NOT NULL CHECK (category IN ('basic','advanced')),  -- maps onto tasks.category
  title        TEXT NOT NULL,
  detail       TEXT NOT NULL,
  points       INTEGER NOT NULL,                            -- XP
  icon         TEXT,                                        -- heroicon name
  tutorial_id  TEXT,
  metric       TEXT REFERENCES metric_definitions(metric),
  time_window  TEXT,
  recurrence   TEXT NOT NULL DEFAULT 'daily' CHECK (recurrence IN ('daily','weekly')),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

-- Training-video library (data/tutorials.ts). Videos/posters live in R2 / Stream.
CREATE TABLE IF NOT EXISTS tutorials (
  id          TEXT PRIMARY KEY,                             -- 'bp-cuff'
  title       TEXT NOT NULL,
  summary     TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('Vitals','Blood','Musculoskeletal','Radiation','Mind & sleep')),
  minutes     INTEGER NOT NULL,
  points      INTEGER NOT NULL,                             -- XP on completion
  video_key   TEXT,                                         -- R2 key or Stream uid
  poster_key  TEXT,
  steps       TEXT NOT NULL,                                -- JSON array of strings
  metric      TEXT REFERENCES metric_definitions(metric),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tutorial_progress (
  user_id        TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  tutorial_id    TEXT NOT NULL REFERENCES tutorials(id),
  completed_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  points_awarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, tutorial_id)
) WITHOUT ROWID;

-- Journal chat turns (user / assistant / system). User turns also create a
-- journal_entries row (entry_id) so the existing AI-analysis + therapist feed keep working.
CREATE TABLE IF NOT EXISTS journal_messages (
  id          TEXT PRIMARY KEY,                             -- crypto.randomUUID() from the client
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  thread_id   TEXT,                                         -- NULL = the single running journal
  sender      TEXT NOT NULL CHECK (sender IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  ts          TEXT NOT NULL,
  entry_id    INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  model       TEXT,                                         -- e.g. @cf/meta/llama-3.1-8b-instruct, grok-...
  tokens_in   INTEGER,
  tokens_out  INTEGER
);

-- Offline food catalog / cache (services/foodSearch.ts SPACE_PANTRY + cached API hits)
CREATE TABLE IF NOT EXISTS foods (
  id            TEXT PRIMARY KEY,                           -- pantry-0 | usda-<fdcId> | off-<code>
  label         TEXT NOT NULL,
  brand         TEXT,
  source        TEXT NOT NULL CHECK (source IN ('space_pantry','usda','open_food_facts','custom')),
  kcal_100g     REAL NOT NULL,
  protein_100g  REAL NOT NULL,
  carbs_100g    REAL NOT NULL,
  fat_100g      REAL NOT NULL,
  fetched_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Daily rollups for fast trend charts / agent queries (one row per user·metric·local day).
-- Filled by the Worker on ingest (incremental upsert) or by a cron re-aggregation.
CREATE TABLE IF NOT EXISTS daily_rollups (
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric      TEXT NOT NULL REFERENCES metric_definitions(metric),
  day         TEXT NOT NULL,                                -- 'YYYY-MM-DD' in user_settings.timezone
  n           INTEGER NOT NULL,
  sum         REAL NOT NULL,
  min         REAL NOT NULL,
  max         REAL NOT NULL,
  last        REAL NOT NULL,
  last_ts     TEXT NOT NULL,
  n_green     INTEGER NOT NULL DEFAULT 0,                   -- time-in-range for MetricExplorer "zones"
  n_yellow    INTEGER NOT NULL DEFAULT 0,
  n_red       INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, metric, day)
) WITHOUT ROWID;

-- Agent / model extrapolations (bone-density projection, radiation projection, trend forecasts)
CREATE TABLE IF NOT EXISTS metric_forecasts (
  user_id       TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  metric        TEXT NOT NULL REFERENCES metric_definitions(metric),
  ts            TEXT NOT NULL,                              -- future point in time
  value         REAL NOT NULL,
  lo            REAL,                                       -- prediction interval
  hi            REAL,
  model         TEXT NOT NULL DEFAULT 'linear-v1',
  generated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, metric, ts)
) WITHOUT ROWID;

-- On-demand asynchronous agent jobs (Queues / Workflows / Durable Object agents write status here)
CREATE TABLE IF NOT EXISTS agent_jobs (
  id           TEXT PRIMARY KEY,                            -- UUID
  user_id      TEXT REFERENCES users(user_id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                               -- 'trend_report' | 'forecast' | 'journal_analysis' | ...
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  params       TEXT,                                        -- JSON
  result       TEXT,                                        -- JSON (or pointer to model_results.id)
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at   TEXT,
  finished_at  TEXT
);

-- -----------------------------------------------------------------------------
-- 3. Indexes
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_meals_client_id      ON meals(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hydration_client_id  ON hydration(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_user_key_day   ON tasks(user_id, task_key, day) WHERE task_key IS NOT NULL;
CREATE INDEX        IF NOT EXISTS idx_tasks_user_day       ON tasks(user_id, day);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_password_email  ON auth_identities(email) WHERE provider = 'password';
CREATE INDEX        IF NOT EXISTS idx_media_user_kind_ts   ON media(user_id, kind, ts DESC);
CREATE INDEX        IF NOT EXISTS idx_jmsg_user_ts         ON journal_messages(user_id, ts);
CREATE INDEX        IF NOT EXISTS idx_jmsg_entry           ON journal_messages(entry_id);
CREATE INDEX        IF NOT EXISTS idx_rollup_user_day      ON daily_rollups(user_id, day);       -- "all metrics for day X" (agents)
CREATE INDEX        IF NOT EXISTS idx_jobs_user_created    ON agent_jobs(user_id, created_at DESC);
CREATE INDEX        IF NOT EXISTS idx_jobs_status_created  ON agent_jobs(status, created_at);
CREATE INDEX        IF NOT EXISTS idx_model_user_endpoint  ON model_results(user_id, endpoint, ts DESC);  -- cardio events feed
CREATE INDEX        IF NOT EXISTS idx_foods_label          ON foods(label);

-- -----------------------------------------------------------------------------
-- 4. Metric catalog additions (all NOT NULL columns filled; domain within CHECK list)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO metric_definitions
 (metric, label, unit, domain, green_min, green_max, yellow_min, yellow_max, bad_direction,
  how_to_measure, why_it_matters, what_to_do, escalate_when, decimals, display_max, aggregation, ui_group) VALUES
 ('stress_index','Stress index (EEG + HRV model)','/100','neuro',0,55,0,75,'up',
  'Computed continuously from the EEG headband and HRV of the ECG patch; no action needed beyond wearing both sensors.',
  'Isolation, workload and circadian disruption raise physiological stress, which degrades sleep, immunity and performance.',
  'Take a 5-minute breathing break (4-7-8), reduce task load if possible, schedule a call home.',
  'Index above 75 for more than 2 hours, or above 55 on 3 consecutive days.',0,100,'mean','vitals'),
 ('sleep_deep_hours','Deep sleep','hours','behavioral',1,3,0.7,4,'down',
  'Recorded by the EEG headband during a sleep session started from EVAde.',
  'Deep (slow-wave) sleep drives physical recovery; it is often shortened by light/noise on station.',
  'Use the amber pre-sleep lighting profile, earplugs and a consistent bedtime.',
  'Under 0.7 h on 3 consecutive nights.',1,NULL,'sum','sleep'),
 ('sleep_rem_hours','REM sleep','hours','behavioral',1.4,2.5,1,3.5,'down',
  'Recorded by the EEG headband during a sleep session started from EVAde.',
  'REM sleep supports memory and mood regulation, both stressed on long missions.',
  'Avoid caffeine after midday and keep the sleep window stable.',
  'Under 1 h on 3 consecutive nights.',1,NULL,'sum','sleep'),
 ('sleep_light_hours','Light sleep','hours','behavioral',NULL,NULL,NULL,NULL,'both',
  'Recorded by the EEG headband during a sleep session started from EVAde.',
  'Light sleep makes up the remainder of the night; context for deep/REM share.',
  'No action on its own; look at deep and REM sleep.',
  'Not escalated on its own.',1,NULL,'sum','sleep'),
 ('sleep_awake_hours','Awake time in bed','hours','behavioral',0,0.5,0,1,'up',
  'Recorded by the EEG headband during a sleep session started from EVAde.',
  'Fragmented sleep (wake after sleep onset) is a common spaceflight sleep complaint.',
  'Check sleeping-bag fit, noise and station temperature; avoid screens before bed.',
  'More than 1 h awake on 3 consecutive nights.',1,NULL,'sum','sleep'),
 ('behavior_index','Behavioral health index','/100','behavioral',65,100,50,100,'down',
  'Composite of the six behavioral axes (EEG model + evening five-question survey).',
  'Behavioral health is the earliest warning of mission strain during isolation and confinement.',
  'Look at the lowest axis; try a call home, a shared crew meal or window time.',
  'Below 50, or more than 15 points under baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_focus','Focus','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey.','Sustained attention is critical for EVA and robotics tasks.',
  'Short breaks, bright-light exposure in the morning.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_energy','Energy','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey.','Low energy accompanies sleep debt and under-eating.',
  'Check sleep and calorie intake.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_calm','Calm','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey.','Persistent loss of calm signals anxiety under confinement.',
  'Breathing exercise, journal entry, quiet module time.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_social','Social connection','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey.','Isolation from family and friends wears on long-duration crews.',
  'Call home, shared crew meal.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_cognition','Cognition','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey (optionally PVT).','Cognitive slowing can follow sleep loss, CO2 exposure or radiation.',
  'Run a PVT, review sleep.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('behavior_motivation','Motivation','/100','behavioral',NULL,NULL,NULL,NULL,'down',
  'EEG model + evening survey.','Motivation dips (third-quarter effect) are typical mid-mission.',
  'Set small daily goals; use the mission board streak.','More than 15 points below baseline for 3 days.',0,100,'mean','mind'),
 ('bone_hip_change_pct','Hip bone density change from pre-flight','%','bone',-3,100,-6,100,'down',
  'Weekly bone ultrasound self-scan at the hip marker (tutorial ultrasound-bone).',
  'Astronauts can lose 1-1.5% of hip bone mass per month in microgravity.',
  'Keep ARED resistive exercise on prescription; check calcium and vitamin D intake.',
  'Loss beyond 4% from pre-flight, or a faster-than-projected slope.',2,NULL,'last','bone'),
 ('bone_spine_change_pct','Spine bone density change from pre-flight','%','bone',-3,100,-6,100,'down',
  'Weekly bone ultrasound self-scan (heel + spine estimate).',
  'Lumbar spine loses density in microgravity, raising fracture risk after landing.',
  'Keep ARED resistive exercise on prescription.',
  'Loss beyond 4% from pre-flight.',2,NULL,'last','bone'),
 ('wbc','White blood cells','x10^9/L','general',4,11,3,13,'both',
  'Weekly venous blood draw for the immune panel (tutorial blood-draw).',
  'Spaceflight dysregulates the immune system; counts outside range suggest infection or suppression.',
  'Repeat at next weekly draw; report symptoms.','Outside 3-13 x10^9/L, or with fever.',1,14,'last','immune'),
 ('lymphocytes','Lymphocytes','x10^9/L','general',1,4.8,0.8,5.5,'both',
  'Weekly venous blood draw for the immune panel.',
  'Low lymphocytes in orbit raise the risk of latent virus reactivation.',
  'Prioritise sleep and stress management; repeat at next draw.','Below 0.8 x10^9/L.',1,6,'last','immune'),
 ('il6','IL-6 (inflammation)','pg/mL','general',0,7,0,10,'up',
  'Weekly venous blood draw for the immune panel.',
  'Elevated IL-6 signals systemic inflammation linked to stress, radiation and muscle loss.',
  'Repeat at next draw; review sleep, stress and exercise load.','Above 10 pg/mL.',1,14,'last','immune'),
 ('crp','C-reactive protein','mg/L','general',0,3,0,10,'up',
  'Weekly venous blood draw for the immune panel.',
  'CRP rises with inflammation and infection; also a cardiovascular risk marker.',
  'Repeat at next draw; report symptoms.','Above 10 mg/L.',1,10,'last','immune'),
 ('ebv_shedding','EBV viral shedding','copies/ug','general',0,5,0,10,'up',
  'Weekly blood/saliva sample in the immune panel.',
  'Latent Epstein-Barr virus reactivates when immunity dips during spaceflight.',
  'Repeat at next draw; inform flight surgeon of any symptoms.','Above 10 copies/ug or rising 3 weeks in a row.',0,20,'last','immune'),
 ('kcal_intake','Calories eaten','kcal','nutrition',1960,3640,1120,4480,'both',
  'Sum of meals logged in the Missions > Nutrition log.',
  'Crews often under-eat in orbit; energy deficit accelerates muscle and bone loss.',
  'Log every meal; add a calorie-dense snack if behind goal.','Below 40% of goal for 3 days.',0,NULL,'sum','nutrition'),
 ('protein_intake_g','Protein eaten','g','nutrition',66,126.5,0,126.5,'down',
  'Sum of meals logged in the Nutrition log.','Protein protects muscle and bone during microgravity deconditioning.',
  'Add a protein shake or thermostabilised meat.','Below 60% of goal for 3 days.',0,NULL,'sum','nutrition'),
 ('carbs_intake_g','Carbohydrates eaten','g','nutrition',216,414,0,414,'both',
  'Sum of meals logged in the Nutrition log.','Carbohydrates fuel the 2 h daily exercise prescription.',
  'Balance intake around exercise sessions.','Not escalated on its own.',0,NULL,'sum','nutrition'),
 ('fat_intake_g','Fat eaten','g','nutrition',57,109.25,0,109.25,'both',
  'Sum of meals logged in the Nutrition log.','Fat supplies dense calories when appetite is low.',
  'Balance intake with goals.','Not escalated on its own.',0,NULL,'sum','nutrition'),
 ('water_intake_ml','Water drunk','mL','nutrition',2500,6000,1500,6000,'down',
  'Sum of pouches logged in the Drink water tracker (250 mL each).',
  'Fluid shifts and reduced thirst in microgravity make dehydration and kidney stones more likely.',
  'Drink a pouch now; aim for 2.5 L per day.','Below 1.5 L for 2 consecutive days.',0,NULL,'sum','nutrition'),
 ('health_score','Overall health score','/100','general',85,100,65,100,'down',
  'Derived daily by the Worker from the status of every monitored signal (Dashboard score ring).',
  'A single summary of how the body and mind are adapting to orbit.',
  'Open the dashboard and act on the yellow/red signals first.','Below 65.',0,100,'last','score');

-- Rollup hints for pre-existing metrics (only touches the column added above)
UPDATE metric_definitions SET aggregation = 'last', decimals = 2, ui_group = 'bone'      WHERE metric = 'bone_density_change_pct';
UPDATE metric_definitions SET aggregation = 'last', decimals = 1, ui_group = 'nutrition' WHERE metric = 'body_mass_change_pct';
UPDATE metric_definitions SET decimals = 1, ui_group = 'vitals' WHERE metric = 'body_temp';
UPDATE metric_definitions SET ui_group = 'vitals'    WHERE metric IN ('heart_rate','systolic_bp','diastolic_bp','blood_glucose','spo2','respiration_rate','hrv_rmssd','ecg_irregular_pct');
UPDATE metric_definitions SET decimals = 1, ui_group = 'sleep' WHERE metric = 'sleep_hours';
UPDATE metric_definitions SET ui_group = 'mind'      WHERE metric IN ('mood','stress','eeg_drowsiness_z');
UPDATE metric_definitions SET decimals = 2, ui_group = 'radiation' WHERE metric = 'daily_radiation_msv';

-- -----------------------------------------------------------------------------
-- 5. Reference data seeds (INSERT OR IGNORE = safe to re-run)
-- -----------------------------------------------------------------------------
INSERT OR IGNORE INTO task_templates (task_key, kind, category, title, detail, points, icon, tutorial_id, metric, time_window, recurrence, sort_order) VALUES
 ('p-bp','protocol','advanced','Morning blood pressure','Seated cuff reading after waking',30,'HeartIcon','bp-cuff','systolic_bp','07:00','daily',1),
 ('p-ecg','protocol','advanced','ECG patch check','Confirm clean signal for the cardio model',40,'SignalIcon','ecg-patch','ecg_irregular_pct','07:15','daily',2),
 ('p-temp','protocol','advanced','Body temperature','Verify core temp sensor calibration',20,'FireIcon','temp-sensor','body_temp','07:20','daily',3),
 ('p-glucose','protocol','advanced','Glucose calibration','Fingerstick to calibrate the CGM',35,'BeakerIcon','glucose-cgm','blood_glucose','08:30','daily',4),
 ('p-dose','protocol','advanced','Dosimeter download','Log today''s radiation dose',15,'ShieldCheckIcon','dosimeter','daily_radiation_msv','12:00','daily',5),
 ('p-immune','protocol','advanced','Immune panel blood draw','Weekly sample for immune markers',80,'SparklesIcon','blood-draw','wbc','Weekly','weekly',6),
 ('p-bone','protocol','advanced','Bone ultrasound scan','Heel + hip density capture',60,'BoltIcon','ultrasound-bone','bone_hip_change_pct','Weekly','weekly',7),
 ('p-mood','protocol','advanced','Behavioral health check-in','Five-question survey + mood rating',25,'FaceSmileIcon','mood-checkin','mood','20:00','daily',8),
 ('p-sleep','protocol','advanced','Start sleep session','EEG headband on, lights to amber',25,'MoonIcon','sleep-setup','sleep_hours','22:30','daily',9),
 ('b-exercise','basic','basic','Exercise 2 hours','ARED + treadmill or CEVIS bike',40,'TrophyIcon',NULL,NULL,NULL,'daily',10),
 ('b-earth','basic','basic','Window time','10 minutes of Earth observation',15,'GlobeAmericasIcon',NULL,NULL,NULL,'daily',11),
 ('b-call','basic','basic','Call home','Connect with family or friends',20,'ChatBubbleLeftRightIcon',NULL,NULL,NULL,'daily',12),
 ('b-selfie','basic','basic','Daily selfie','Visual check-in on the Selfies page',15,'CameraIcon',NULL,NULL,NULL,'daily',13),
 ('b-light','basic','basic','Blue-light morning','Bright lighting profile for 30 min',10,'SunIcon',NULL,NULL,NULL,'daily',14);

INSERT OR IGNORE INTO tutorials (id, title, summary, category, minutes, points, steps, metric, sort_order) VALUES
 ('bp-cuff','Blood pressure with the cuff','Seat yourself with restraints, wrap the cuff and log a clean reading.','Vitals',4,30,
  '["Anchor feet in the foot restraints and rest 5 minutes","Wrap the cuff two fingers above the elbow","Keep your arm at heart level and stay still","Press start and breathe normally","Confirm the reading syncs to EVAde"]','systolic_bp',1),
 ('ecg-patch','Placing the ECG chest patch','Prep skin and place leads so the ECG model gets a clean signal.','Vitals',6,40,
  '["Clean skin with an alcohol wipe and let it dry","Peel the patch backing without touching the gel","Place the patch below the left collarbone","Press firmly for 30 seconds","Check the live waveform on the dashboard"]','heart_rate',2),
 ('temp-sensor','Core temperature sensor check','Verify the forehead sensor contact and calibration each morning.','Vitals',3,20,
  '["Wipe the sensor face","Seat it on the center of the forehead","Wait for the green calibration light","Compare against the reference thermometer"]','body_temp',3),
 ('glucose-cgm','Fingerstick & CGM calibration','Collect a droplet in microgravity without it floating away.','Blood',5,35,
  '["Wash and dry hands, warm the fingertip","Lance the side of the fingertip","Touch the strip to the droplet - do not squeeze","Enter the value to calibrate the CGM","Dispose of the lancet in the sharps bag"]','blood_glucose',4),
 ('blood-draw','Venous blood draw for immune panel','Draw, spin and freeze samples for the immune marker panel.','Blood',12,80,
  '["Set up the kit on the velcro tray","Apply the tourniquet and locate the vein","Draw two tubes in order","Centrifuge for 10 minutes","Stow samples in MELFI at -80 C"]','wbc',5),
 ('ultrasound-bone','Bone ultrasound self-scan','Guided heel and hip scans to track bone density loss.','Musculoskeletal',10,60,
  '["Apply gel to the probe","Follow the on-screen heel target","Hold steady for three captures","Repeat at the hip marker","Review the density estimate"]','bone_hip_change_pct',6),
 ('ared-form','ARED resistive exercise form','Squats and deadlifts on ARED to slow bone and muscle loss.','Musculoskeletal',8,50,
  '["Set load per the daily prescription","Clip into the harness","Keep a neutral spine through each rep","Log sets and reps"]',NULL,7),
 ('dosimeter','Reading your personal dosimeter','Download the daily dose and check for solar event alerts.','Radiation',2,15,
  '["Dock the dosimeter on the reader","Wait for the sync tone","Review the daily dose","Clip it back to your chest pocket"]','daily_radiation_msv',8),
 ('sleep-setup','Sleep station setup','Lighting, noise and headband EEG for better rest.','Mind & sleep',5,25,
  '["Switch station lighting to the pre-sleep amber profile","Fit the EEG headband snugly","Insert earplugs and secure the sleeping bag","Start the sleep session in EVAde"]','sleep_hours',9),
 ('mood-checkin','Behavioral health check-in','A quick self-assessment and breathing reset.','Mind & sleep',4,25,
  '["Find a quiet module","Answer the five-question survey honestly","Follow the 4-7-8 breathing guide","Write one line in your journal"]','mood',10);

INSERT OR IGNORE INTO foods (id, label, source, kcal_100g, protein_100g, carbs_100g, fat_100g) VALUES
 ('pantry-0','Thermostabilized beef brisket','space_pantry',210,24,2,12),
 ('pantry-1','Rehydratable scrambled eggs','space_pantry',155,12,2,11),
 ('pantry-2','Tortilla (flour)','space_pantry',310,8,52,8),
 ('pantry-3','Oatmeal with raisins','space_pantry',370,11,66,6),
 ('pantry-4','Shrimp cocktail','space_pantry',105,20,4,1),
 ('pantry-5','Macaroni and cheese','space_pantry',165,7,20,6),
 ('pantry-6','Chicken teriyaki','space_pantry',140,18,8,4),
 ('pantry-7','Dried apricots','space_pantry',240,3,63,0.5),
 ('pantry-8','Peanut butter','space_pantry',590,25,20,50),
 ('pantry-9','Granola bar','space_pantry',470,10,64,20),
 ('pantry-10','Fresh apple','space_pantry',52,0.3,14,0.2),
 ('pantry-11','Salmon (thermostabilized)','space_pantry',180,22,0,10),
 ('pantry-12','Protein shake','space_pantry',120,20,5,2),
 ('pantry-13','Brownie','space_pantry',405,5,60,16),
 ('pantry-14','Rice pilaf','space_pantry',130,3,28,1),
 ('pantry-15','Coffee with cream','space_pantry',30,1,2,2);

-- -----------------------------------------------------------------------------
-- 6. Convenience views (read-only, additive)
-- -----------------------------------------------------------------------------
-- Per-UTC-day nutrition + hydration totals (NutritionPanel, HydrationTracker history)
CREATE VIEW IF NOT EXISTS v_daily_nutrition AS
SELECT user_id, day,
       SUM(kcal) AS kcal, SUM(protein) AS protein_g, SUM(carbs) AS carbs_g, SUM(fat) AS fat_g,
       SUM(meals) AS meals, SUM(water_ml) AS water_ml
FROM (
  SELECT user_id, substr(ts,1,10) AS day, kcal, protein, carbs, fat, 1 AS meals, 0 AS water_ml FROM meals
  UNION ALL
  SELECT user_id, substr(ts,1,10), 0, 0, 0, 0, 0, amount_ml FROM hydration
)
GROUP BY user_id, day;

-- Daily mean/min/max per metric straight from the rollup table, with UI ranges attached
CREATE VIEW IF NOT EXISTS v_daily_trend AS
SELECT r.user_id, r.metric, r.day, r.n,
       CASE m.aggregation WHEN 'sum' THEN r.sum WHEN 'last' THEN r.last ELSE r.sum / r.n END AS value,
       r.min, r.max, r.n_green, r.n_yellow, r.n_red,
       m.unit, m.green_min, m.green_max, m.yellow_min, m.yellow_max
FROM daily_rollups r JOIN metric_definitions m USING (metric);
