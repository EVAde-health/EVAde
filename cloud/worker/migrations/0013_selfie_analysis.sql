-- 0013: selfie mood analysis stored on the photo, plus optional provenance columns on model results.
-- Analysis is written by the Worker after Workers AI returns. Null means the model was not run.
-- model_sha256 is filled only when the loaded artifact reports a hash. It is never invented.

ALTER TABLE media ADD COLUMN analysis TEXT;
ALTER TABLE media ADD COLUMN analysis_model TEXT;
ALTER TABLE media ADD COLUMN analyzed_at TEXT;
ALTER TABLE media ADD COLUMN mood_label TEXT;
ALTER TABLE media ADD COLUMN analysis_confidence REAL;

ALTER TABLE model_results ADD COLUMN model_sha256 TEXT;
ALTER TABLE model_results ADD COLUMN latency_ms INTEGER;
