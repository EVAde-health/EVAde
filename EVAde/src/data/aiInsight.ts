// Metrics that have a model in Michael's registry (EVA-1..EVA-15). Keep in step with MATCHES in
// cloud/worker/src/metricModels.ts. Only these tiles open the AI insight dialog; the rest are plain readouts.
export const AI_INSIGHT_METRICS: ReadonlySet<string> = new Set([
  'heart_rate',
  'hrv_rmssd',
  'ecg_irregular_pct',
  'sleep_hours',
  'eeg_drowsiness_z',
  'daily_radiation_msv',
]);

export const hasAiInsight = (metric: string) => AI_INSIGHT_METRICS.has(metric);
