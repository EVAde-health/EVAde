-- "Delete my account": removes one user's rows from every table in evade-db.
-- Not a migration (it lives outside migrations/ so wrangler never applies it).
--
-- Bind ?1 = the user_id from the verified session (never from the URL or request body).
-- Apply the current migrations first. Run the statements in ONE env.DB.batch([...]).
-- Most tables also have ON DELETE CASCADE, but each table is listed explicitly so the delete
-- does not depend on PRAGMA foreign_keys and stays correct if a future table forgets the FK.
--
-- Outside D1, the Worker must also:
--   1. Delete R2 objects: list media.r2_key for the user (and the prefix users/<user_id>/) BEFORE this batch.
--   2. Remove the active session from KV. Other sessions fail their D1 user check after deletion.
--   3. Delete Daniel's voice-agent rows (checkins / downlink_queue) if they still live in a separate DB.
-- Keep the shared catalogue tables (metric_definitions, space_weather): they hold no personal data.

-- Other people's records that point at this user: keep the record, drop the link.
UPDATE messages SET sender_id = NULL WHERE sender_id = ?1 AND user_id <> ?1;
UPDATE alerts   SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1;

UPDATE daily_goals SET set_by = NULL WHERE set_by = ?1 AND user_id <> ?1;
UPDATE emergencies SET acknowledged_by = NULL WHERE acknowledged_by = ?1 AND user_id <> ?1;
UPDATE emergencies SET resolved_by = NULL WHERE resolved_by = ?1 AND user_id <> ?1;
UPDATE user_goals SET set_by = NULL WHERE set_by = ?1 AND user_id <> ?1;
UPDATE vital_corrections SET corrected_by = NULL WHERE corrected_by = ?1 AND user_id <> ?1;
UPDATE user_notifications SET actor_id = NULL WHERE actor_id = ?1 AND user_id <> ?1;
DELETE FROM conversation_messages WHERE sender_id = ?1 OR conversation_id IN (SELECT id FROM conversations WHERE astronaut_id = ?1 OR surgeon_id = ?1);
DELETE FROM conversations WHERE astronaut_id = ?1 OR surgeon_id = ?1;
DELETE FROM user_goals WHERE user_id = ?1;
DELETE FROM vital_corrections WHERE user_id = ?1;
DELETE FROM user_notifications WHERE user_id = ?1;
DELETE FROM staff_messages WHERE sender_id = ?1 OR thread_id IN (SELECT id FROM staff_threads WHERE astronaut_id = ?1 OR staff_id = ?1);
DELETE FROM staff_threads WHERE astronaut_id = ?1 OR staff_id = ?1;
DELETE FROM daily_goals WHERE user_id = ?1;
DELETE FROM emergencies WHERE user_id = ?1;

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
DELETE FROM journal_messages WHERE user_id = ?1;
DELETE FROM journal_entries WHERE user_id = ?1;
DELETE FROM instruments     WHERE user_id = ?1;
DELETE FROM self_reports    WHERE user_id = ?1;
DELETE FROM baselines       WHERE user_id = ?1;
DELETE FROM observations    WHERE user_id = ?1;
DELETE FROM auth_identities WHERE user_id = ?1;
DELETE FROM action_log      WHERE user_id = ?1;   -- no FK on this table, so it must be explicit

DELETE FROM tutorial_progress WHERE user_id = ?1;
DELETE FROM user_settings     WHERE user_id = ?1;
DELETE FROM daily_rollups     WHERE user_id = ?1;
DELETE FROM metric_forecasts  WHERE user_id = ?1;
DELETE FROM agent_jobs        WHERE user_id = ?1;

DELETE FROM users           WHERE user_id = ?1;
