-- 0014: drop empty tables nothing reads, and the rollup view that only read an empty table.
-- Live checks (2026-11-16): metric_forecasts, agent_jobs, phone_numbers, staff_threads,
-- and staff_messages each have 0 rows. No view selects from them. 0010 already copied
-- staff_threads / staff_messages into conversations / conversation_messages.
-- daily_rollups is also empty. v_daily_trend only reads it, and chart series already
-- come from observations, so both go. v_crew_overview, v_escalations, v_therapist_feed,
-- and v_daily_intake stay: the Worker still queries them.

DROP VIEW IF EXISTS v_daily_trend;
DROP TABLE IF EXISTS daily_rollups;
DROP TABLE IF EXISTS metric_forecasts;
DROP TABLE IF EXISTS agent_jobs;
DROP TABLE IF EXISTS phone_numbers;
DROP TABLE IF EXISTS staff_messages;
DROP TABLE IF EXISTS staff_threads;
