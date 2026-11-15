-- 0003: link logins to astronauts (works with any auth Ryan B picks) + views for the doctor/therapist panel.

-- One row per login method. provider = 'google' | 'github' | 'cloudflare_access' | 'auth0' | ...
-- subject = the provider's stable user id (OAuth "sub"), never the email.
CREATE TABLE IF NOT EXISTS auth_identities (
  provider    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login  TEXT,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX IF NOT EXISTS idx_auth_user ON auth_identities(user_id);

-- Latest reading per astronaut per metric
CREATE VIEW IF NOT EXISTS v_latest_indicators AS
SELECT o.user_id, u.display_name, o.metric, m.label, m.domain, o.value, o.unit, o.level, o.z, o.ts
FROM observations o
JOIN users u USING (user_id)
JOIN metric_definitions m USING (metric)
WHERE o.ts = (SELECT MAX(ts) FROM observations WHERE user_id = o.user_id AND metric = o.metric);

-- One row per astronaut for the crew overview screen
CREATE VIEW IF NOT EXISTS v_crew_overview AS
SELECT u.user_id, u.display_name, u.environment, u.mission_name, u.points, u.last_active,
  (SELECT r    FROM risk_scores rs WHERE rs.user_id = u.user_id ORDER BY ts DESC LIMIT 1) AS last_r,
  (SELECT band FROM risk_scores rs WHERE rs.user_id = u.user_id ORDER BY ts DESC LIMIT 1) AS last_band,
  (SELECT mdtr FROM risk_scores rs WHERE rs.user_id = u.user_id ORDER BY ts DESC LIMIT 1) AS last_mdtr,
  (SELECT COUNT(*) FROM alerts a WHERE a.user_id = u.user_id AND a.acknowledged = 0) AS open_alerts,
  (SELECT COUNT(*) FROM alerts a WHERE a.user_id = u.user_id AND a.acknowledged = 0 AND a.escalate = 1) AS escalated_alerts,
  (SELECT COUNT(*) FROM v_latest_indicators v WHERE v.user_id = u.user_id AND v.level = 'red') AS red_indicators
FROM users u WHERE u.role = 'astronaut';

-- Escalations waiting for the flight surgeon
CREATE VIEW IF NOT EXISTS v_escalations AS
SELECT a.id, a.ts, u.display_name, a.user_id, a.metric, a.message, a.action
FROM alerts a JOIN users u USING (user_id)
WHERE a.escalate = 1 AND a.acknowledged = 0;

-- Journal + mood for the therapist view (summaries first; full text only on demand)
CREATE VIEW IF NOT EXISTS v_therapist_feed AS
SELECT j.id, j.user_id, u.display_name, j.ts, j.source, j.ai_summary, j.sentiment, j.flags,
  (SELECT mood   FROM self_reports s WHERE s.user_id = j.user_id AND s.ts <= j.ts ORDER BY s.ts DESC LIMIT 1) AS mood_that_day,
  (SELECT stress FROM self_reports s WHERE s.user_id = j.user_id AND s.ts <= j.ts ORDER BY s.ts DESC LIMIT 1) AS stress_that_day
FROM journal_entries j JOIN users u USING (user_id);
