// Which dashboard metrics have a matching model in Michael's registry (EVA-1..EVA-15), and how EVAde runs it.
// The probability itself always comes from a stored or fresh gateway run (modelRuns.ts); this module never invents one.

export interface MetricModelMatch {
  id: string;
  name: string;
  task: string;
  /** What the model is given when EVAde runs it from this metric. */
  input: string;
  reason: string;
}

export interface MetricModelInfo {
  metric: string;
  label: string;
  matches: MetricModelMatch[];
  note: string;
}

const ECG_INPUT = "A 10 s, 12-lead ECG synthesized at the latest heart rate. No ECG patch streams to EVAde, so the recording is simulated; the model and its weights are Michael's.";
const ECG13 = { id: "EVA-13", name: "ptbxl-superclass resnet1d_wang (ONNX)", task: "Probability of 5 ECG superclasses: normal, infarction pattern, ST/T change, conduction disturbance, hypertrophy", input: ECG_INPUT, reason: "Deep 12-lead ECG model, test macro AUROC 0.93 on PTB-XL." };
const ECG6 = { id: "EVA-6", name: "ptbxl-superclass-hgb beta", task: "The same 5 ECG superclasses from hand-built ECG features, plus a rate and rhythm rule", input: ECG_INPUT, reason: "Gradient-boosted beta model, test macro AUROC 0.87 on PTB-XL." };
const SLEEP14 = { id: "EVA-14", name: "sleep-edfx 5-stage deep sleep staging (ONNX)", task: "Sleep stage (W, N1, N2, N3, REM) for each 30 s epoch", input: "Ten 30 s epochs of 2-channel sleep EEG, synthesized as fragmented sleep when the latest night was under 6 h.", reason: "Deep epoch model trained on Sleep-EDF Expanded." };
const SEIZURE2 = { id: "EVA-2", name: "seizure-window-hgb beta", task: "Seizure-suspect probability per 4 s window of 18-channel EEG", input: "10 s of 18-channel bipolar EEG, calm or with a seizure-like discharge (you choose). The first run records a calm per-person baseline, as the model requires.", reason: "Leave-one-subject-out AUROC 0.97 on CHB-MIT, 0.92 on the external Siena set." };
const SPE12 = { id: "EVA-12", name: "spe-onset-24h logistic v2", task: "Probability that >=10 MeV protons reach 10 pfu (a solar particle event) within 24 h", input: "The last 72 h of real GOES proton and X-ray flux from NOAA SWPC, fetched by the model server.", reason: "Held-out 2017-2026 AUROC 0.89. This also drives the next-EVA-window planner." };

const MATCHES: Record<string, { label: string; matches: MetricModelMatch[] }> = {
  heart_rate: { label: "Resting heart rate", matches: [ECG13, ECG6] },
  hrv_rmssd: { label: "Heart rate variability", matches: [ECG13, ECG6] },
  ecg_irregular_pct: { label: "ECG irregular rhythm", matches: [ECG13, ECG6] },
  sleep_hours: { label: "Sleep duration", matches: [SLEEP14] },
  sleep_deep_hours: { label: "Deep sleep", matches: [SLEEP14] },
  sleep_rem_hours: { label: "REM sleep", matches: [SLEEP14] },
  sleep_light_hours: { label: "Light sleep", matches: [SLEEP14] },
  eeg_drowsiness_z: { label: "EEG drowsiness", matches: [SEIZURE2] },
  daily_radiation_msv: { label: "Daily radiation dose", matches: [SPE12] },
};

const NO_MODEL = "No model in Michael's registry (EVA-1 through EVA-15) is trained on this vital, so no percent chance is shown. The rule-based thresholds on the dashboard still apply.";

export function metricModelInfo(metric: string, label?: string): MetricModelInfo {
  const known = MATCHES[metric];
  if (!known) return { metric, label: label || metric, matches: [], note: NO_MODEL };
  return { metric, label: label || known.label, matches: known.matches,
    note: "Each percent below is the model's own output from a run on this astronaut. Run it again to see it respond to the latest reading." };
}

export const METRICS_WITH_MODELS = Object.keys(MATCHES);
