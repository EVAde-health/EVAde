-- 0006: seeded demo astronaut for the judges' "Try demo" login. FAKE DATA ONLY.
-- Every id below starts with 'demo-' or uses the fixed demo UUIDs, so it is easy to find and remove:
--   run queries/delete_user.sql with each demo user_id.
-- Safe to re-run: INSERT OR IGNORE everywhere.
-- Times are relative to when the migration is applied, so the dashboard looks current on demo day.

-- Demo astronaut (pseudonymous UUID, no real person) and a demo flight surgeon who sends messages.
INSERT OR IGNORE INTO users (user_id, display_name, role, environment, mission_name, mission_start, consent, points, streak_days, last_active) VALUES
('00000000-0000-4000-8000-00000000d001', 'Cmdr. Vega (demo)', 'astronaut', 'station', 'EVAde Demo Mission',
 strftime('%Y-%m-%dT%H:%M:%fZ','now','-42 days'), 1, 1240, 12, strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours')),
('00000000-0000-4000-8000-00000000d002', 'Dr. Ortiz (demo flight surgeon)', 'flight_surgeon', 'station', 'EVAde Demo Mission',
 strftime('%Y-%m-%dT%H:%M:%fZ','now','-42 days'), 1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours'));

-- Login identity for the "Try demo" button. provider 'demo' is not an OAuth provider; the Worker's
-- demo route must look this row up by (provider, subject) and must never accept a user-supplied id.
INSERT OR IGNORE INTO auth_identities (provider, subject, user_id, email) VALUES
('demo', 'vega', '00000000-0000-4000-8000-00000000d001', NULL);

-- Vitals over the last few days (one slightly elevated heart rate so a yellow shows up).
INSERT OR IGNORE INTO observations (client_id, user_id, metric, value, unit, ts, source, device, level) VALUES
('demo-obs-hr-3',   '00000000-0000-4000-8000-00000000d001', 'heart_rate',  66,  'bpm',   strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 days'),  'synthetic', 'demo', 'green'),
('demo-obs-hr-2',   '00000000-0000-4000-8000-00000000d001', 'heart_rate',  71,  'bpm',   strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days'),  'synthetic', 'demo', 'green'),
('demo-obs-hr-1',   '00000000-0000-4000-8000-00000000d001', 'heart_rate',  104, 'bpm',   strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 'synthetic', 'demo', 'yellow'),
('demo-obs-spo2-1', '00000000-0000-4000-8000-00000000d001', 'spo2',        97,  '%',     strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 'synthetic', 'demo', 'green'),
('demo-obs-sys-1',  '00000000-0000-4000-8000-00000000d001', 'systolic_bp', 118, 'mmHg',  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 'synthetic', 'demo', 'green'),
('demo-obs-dia-1',  '00000000-0000-4000-8000-00000000d001', 'diastolic_bp',76,  'mmHg',  strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 'synthetic', 'demo', 'green'),
('demo-obs-sleep-2','00000000-0000-4000-8000-00000000d001', 'sleep_hours', 6.5, 'hours', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'),  'synthetic', 'demo', 'yellow'),
('demo-obs-sleep-1','00000000-0000-4000-8000-00000000d001', 'sleep_hours', 5.5, 'hours', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours'), 'synthetic', 'demo', 'yellow'),
('demo-obs-rad-1',  '00000000-0000-4000-8000-00000000d001', 'daily_radiation_msv', 0.5, 'mSv', strftime('%Y-%m-%dT%H:%M:%fZ','now','-4 hours'), 'synthetic', 'demo', 'green');

-- App check-in and a voice check-in (shows the 0005 voice mapping).
INSERT OR IGNORE INTO self_reports (client_id, user_id, ts, mood, stress, fatigue, sleep_quality, note, source, sleep_hours, symptoms, checkin_level, reasons, actions) VALUES
('demo-sr-1', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'), 4, 2, 2, 3,
 'Good EVA prep day.', 'app', 6.5, '[]', 'green', '[]', '[]'),
('demo-sr-2', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 3, 3, 4, 2,
 'Slept badly, mild headache.', 'voice_web', 5.5, '["headache"]', 'yellow',
 '["sleep under 6 hours","resting heart rate above 100"]', '["rest 10 minutes and re-measure","protect tonight''s sleep period"]');

INSERT OR IGNORE INTO journal_entries (client_id, user_id, ts, source, content, ai_summary, sentiment, mood_label, concern_level) VALUES
('demo-j-1', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 days'), 'text',
 'Watched the sunrise over the Pacific from the cupola. Missing home a little, but the crew dinner helped.',
 'Positive day with mild homesickness; social time with the crew helped.', 0.4, 'calm', 'low');

-- Meals and hydration today (Ryan B's MealLogger / HydrationTracker).
INSERT OR IGNORE INTO meals (client_id, user_id, ts, name, food_source, grams, kcal, protein_g, carbs_g, fat_g, points) VALUES
('demo-meal-1', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours'), 'Oatmeal with raisins', 'space_pantry', 80, 300, 9, 54, 5, 10),
('demo-meal-2', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours'), 'Thermostabilized salmon', 'space_pantry', 100, 180, 22, 0, 10, 10);

INSERT OR IGNORE INTO hydration (client_id, user_id, ts, volume_ml, points) VALUES
('demo-h2o-1', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 hours'), 250, 5),
('demo-h2o-2', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 250, 5),
('demo-h2o-3', '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hours'), 250, 5);

INSERT OR IGNORE INTO tasks (id, user_id, title, category, metric, recurrence, points, completed_at) VALUES
(900001, '00000000-0000-4000-8000-00000000d001', 'Morning heart rate',  'basic',    'heart_rate',  'daily', 10, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours')),
(900002, '00000000-0000-4000-8000-00000000d001', 'Blood pressure',      'basic',    'systolic_bp', 'daily', 10, strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours')),
(900003, '00000000-0000-4000-8000-00000000d001', 'Log sleep',           'basic',    'sleep_hours', 'daily', 10, NULL),
(900004, '00000000-0000-4000-8000-00000000d001', 'Weekly bone scan',    'advanced', 'bone_density_change_pct', 'weekly', 30, NULL);

INSERT OR IGNORE INTO risk_scores (id, user_id, ts, r, band, mdtr, domains, top_domains, source) VALUES
(900001, '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours'), 0.28, 'moderate', '>100',
 '{"cardiac":0.32,"behavioral":0.35,"radiation":0.08,"bone":0.12,"nutrition":0.1}', '["behavioral","cardiac"]', 'worker');

INSERT OR IGNORE INTO alerts (id, user_id, ts, level, metric, message, action, escalate, source, self_report_id) VALUES
(900001, '00000000-0000-4000-8000-00000000d001', strftime('%Y-%m-%dT%H:%M:%fZ','now','-3 hours'), 'yellow', 'heart_rate',
 'Resting heart rate 104 bpm after a short night (demo).', 'Rest 10 minutes and re-measure.', 0, 'voice',
 (SELECT id FROM self_reports WHERE client_id = 'demo-sr-2'));

INSERT OR IGNORE INTO messages (client_id, user_id, sender_id, direction, sender_role, priority, body, comms_mode, status, arrives_at, alert_id, ts) VALUES
('demo-msg-1', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d002', 'downlink', 'flight_surgeon', 'routine',
 'Saw your heart rate this morning. Please re-measure after rest and log tonight''s sleep. No action needed yet.',
 'mars', 'delivered', strftime('%Y-%m-%dT%H:%M:%fZ','now','-150 minutes'), 900001, strftime('%Y-%m-%dT%H:%M:%fZ','now','-170 minutes')),
('demo-msg-2', '00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000d001', 'uplink', 'astronaut', 'routine',
 'Copy. Re-measured at 82 bpm.', 'mars', 'in_transit', strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes'), NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now','-10 minutes'));
