// Which dashboard metrics have a matching model from Michael's registry (EVA-1..EVA-15).
// A single vital is not the input those models were trained on. This module never invents a probability.

export interface MetricModelMatch {
  id: string;
  name: string;
  task: string;
  runnable_from_reading: false;
  reason: string;
}

export interface MetricModelInfo {
  metric: string;
  label: string;
  matches: MetricModelMatch[];
  probability: null;
  note: string;
}

const WAVEFORM = "This model needs the raw waveform it was trained on. A single logged number is not that input, so no percent chance is shown.";

const MATCHES: Record<string, { label: string; matches: MetricModelMatch[] }> = {
  heart_rate: {
    label: "Resting heart rate",
    matches: [
      { id: "EVA-6", name: "ptbxl-superclass-hgb beta", task: "5 ECG diagnostic superclasses", runnable_from_reading: false, reason: WAVEFORM },
      { id: "EVA-13", name: "ptbxl-superclass resnet1d_wang", task: "12-lead ECG superclass (ONNX)", runnable_from_reading: false, reason: WAVEFORM + " Served as /v1/predict/ecg-deep when the gateway has the ONNX file." },
    ],
  },
  hrv_rmssd: {
    label: "Heart rate variability",
    matches: [
      { id: "EVA-6", name: "ptbxl-superclass-hgb beta", task: "ECG diagnostic superclasses", runnable_from_reading: false, reason: WAVEFORM },
    ],
  },
  ecg_irregular_pct: {
    label: "ECG irregular rhythm",
    matches: [
      { id: "EVA-6", name: "ptbxl-superclass-hgb beta", task: "ECG diagnostic superclasses", runnable_from_reading: false, reason: WAVEFORM },
      { id: "EVA-13", name: "ptbxl-superclass resnet1d_wang", task: "12-lead ECG superclass (ONNX)", runnable_from_reading: false, reason: WAVEFORM },
    ],
  },
  sleep_hours: {
    label: "Sleep duration",
    matches: [
      { id: "EVA-4", name: "sleep-stage-hgb beta", task: "5-class sleep staging per 30 s EEG epoch", runnable_from_reading: false, reason: "Needs Fpz-Cz / Pz-Oz EEG epochs, not a sleep-hours total." },
      { id: "EVA-14", name: "sleep-edfx deep staging", task: "W/N1/N2/N3/REM per 30 s epoch", runnable_from_reading: false, reason: "Served as /v1/predict/sleep-deep from EEG epochs when the gateway has the ONNX file." },
    ],
  },
  eeg_drowsiness_z: {
    label: "EEG drowsiness",
    matches: [
      { id: "EVA-2", name: "seizure-window-hgb beta", task: "seizure-suspect flag per 4 s window", runnable_from_reading: false, reason: "The served seizure model needs 18-channel bipolar EEG. It does not score drowsiness from one number." },
    ],
  },
  daily_radiation_msv: {
    label: "Daily radiation dose",
    matches: [
      { id: "EVA-12", name: "spe-onset-24h logistic v2", task: "P(solar particle event onset within 24 h)", runnable_from_reading: false, reason: "Trained on 48 h of GOES proton and X-ray history, not on a personal dosimeter reading. The EVA window panel runs it when evade-gateway has the weights." },
    ],
  },
};

const NO_MODEL = "No model in Michael's registry (EVA-1 through EVA-15) is trained on this metric. No percent chance is shown.";

export function metricModelInfo(metric: string, label?: string): MetricModelInfo {
  const known = MATCHES[metric];
  if (!known) {
    return { metric, label: label || metric, matches: [], probability: null, note: NO_MODEL };
  }
  return { metric, label: label || known.label, matches: known.matches, probability: null, note: known.matches[0]?.reason ?? NO_MODEL };
}

export const METRICS_WITH_MODELS = Object.keys(MATCHES);
