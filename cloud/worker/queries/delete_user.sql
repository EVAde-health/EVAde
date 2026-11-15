-- "Delete my account": removes one user's rows from every table in evade-db.
-- Not a migration (it lives outside migrations/ so wrangler never applies it).
--
-- Bind ?1 = the user_id from the verified session (never from the URL or request body).
-- Run every statement in ONE env.DB.batch([...]) so it is all-or-nothing.
-- Most tables also have ON DELETE CASCADE, but each table is listed explicitly so the delete
-- does not depend on PRAGMA foreign_keys and stays correct if a future table forgets the FK.
--
-- Outside D1, the Worker must also:
--   1. Delete R2 objects: list media.r2_key for the user (and the prefix users/<user_id>/) BEFORE this batch.
--   2. Delete the user's KV sessions (sess:*) so open logins stop working immediately.
--   3. Delete Daniel's voice-agent rows (checkins / downlink_queue) if they still live in a separate DB.
-- Keep the shared catalogue tables (metric_definitions, space_weather): they hold no personal data.

-- Other people's records that point at this user: keep the record, drop the link.
UPDATE messages SET sender_id = NULL WHERE sender_id = ?1 AND user_id <> ?1;
UPDATE alerts   SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1;

-- Messages and alerts first (they reference self_reports).
DELETE FROM messages        WHERE user_id = ?1;
DELETE FROM alerts          WHERE user_id = ?1;

DELETE FROM phone_numbers   WHERE user_id = ?1;
DELETE FROM meals           WHERE user_id = ?1;
DELETE FROM hydration       WHERE user_id = ?1;
DELETE FROM media           WHERE user_id = ?1;
DELETE FROM tasks           WHERE user_id = ?1;
DELETE FROM risk_scores     WHERE user_id = ?1;
DELETE FROM model_results   WHERE user_id = ?1;
DELETE FROM radiation_doses WHERE user_id = ?1;
DELETE FROM journal_messages WHERE user_id = ?1;  -- chat rows point at journal_entries
DELETE FROM journal_entries WHERE user_id = ?1;
DELETE FROM instruments     WHERE user_id = ?1;
DELETE FROM self_reports    WHERE user_id = ?1;
DELETE FROM baselines       WHERE user_id = ?1;
DELETE FROM observations    WHERE user_id = ?1;
DELETE FROM auth_identities WHERE user_id = ?1;
DELETE FROM action_log      WHERE user_id = ?1;   -- no FK on this table, so it must be explicit
DELETE FROM tutorial_progress WHERE user_id = ?1;
DELETE FROM user_settings   WHERE user_id = ?1;
DELETE FROM daily_rollups   WHERE user_id = ?1;
DELETE FROM metric_forecasts WHERE user_id = ?1;
DELETE FROM agent_jobs      WHERE user_id = ?1;

DELETE FROM users           WHERE user_id = ?1;
