-- apply after 0010_surgeon_console.sql
-- Keep the deployed CHECK constraints and foreign keys on the existing source columns.
-- The explicit simulation source takes precedence in API representations.
ALTER TABLE observations ADD COLUMN simulation_source TEXT CHECK(simulation_source IS NULL OR simulation_source='simulated');
ALTER TABLE self_reports ADD COLUMN simulation_source TEXT CHECK(simulation_source IS NULL OR simulation_source='simulated');
ALTER TABLE alerts ADD COLUMN simulation_source TEXT CHECK(simulation_source IS NULL OR simulation_source='simulated');
ALTER TABLE meals ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE hydration ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE model_results ADD COLUMN source TEXT NOT NULL DEFAULT 'model';

CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_alert ON alerts(user_id, ts, metric) WHERE simulation_source='simulated';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_model ON model_results(user_id, endpoint, ts) WHERE source='simulated';
CREATE UNIQUE INDEX IF NOT EXISTS idx_sim_risk ON risk_scores(user_id, ts) WHERE source='simulated';
