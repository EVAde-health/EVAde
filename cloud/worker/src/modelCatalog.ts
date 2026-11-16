// Static inventory of Michael's registry (Mikeblackbelt/EVAde-backend-models MODEL_REGISTRY.md, EVA-1..EVA-15).
// Weight files are not in git. They are joblib/ONNX artifacts in the evade-models R2 bucket, loaded by evade-gateway.
// `weights_sha256` stays null until a loaded artifact reports its hash. This file's own sha256 is computed over the
// catalog JSON so a judge can confirm the list was not edited in the browser.

export interface CatalogModel {
  id: string;
  type: "arch" | "model";
  name: string;
  parent: string | null;
  module: string;
  task: string;
  status: string;
  served_as: string | null;
  michael: true;
  weights: string;
  inputs: string;
  runnable_here: "gateway" | "not_retained" | "architecture_only";
  why: string;
}

export const MODEL_CATALOG: CatalogModel[] = [
  { id: "EVA-1", type: "arch", name: "seizure-window-hgb", parent: null, module: "EEG", task: "seizure-suspect flag per 4 s window", status: "draft", served_as: null, michael: true, weights: "architecture only", inputs: "18-channel bipolar EEG features", runnable_here: "architecture_only", why: "Architecture spec. The trained instance is EVA-2." },
  { id: "EVA-2", type: "model", name: "seizure-window-hgb beta", parent: "EVA-1", module: "EEG", task: "seizure-suspect flag per 4 s window", status: "draft", served_as: "/v1/predict/eeg", michael: true, weights: "R2 models/seizure/model.joblib (legacy folder)", inputs: "18-channel bipolar EEG, 4 s window", runnable_here: "gateway", why: "HistGradientBoosting joblib. Workers cannot unpickle it. evade-gateway loads it." },
  { id: "EVA-3", type: "arch", name: "sleep-stage-hgb", parent: null, module: "EEG", task: "5-class sleep staging per 30 s epoch", status: "draft", served_as: null, michael: true, weights: "architecture only", inputs: "EEG epoch features", runnable_here: "architecture_only", why: "Architecture spec. The trained instance is EVA-4." },
  { id: "EVA-4", type: "model", name: "sleep-stage-hgb beta", parent: "EVA-3", module: "EEG", task: "5-class sleep staging per 30 s epoch", status: "draft", served_as: null, michael: true, weights: "not served; joblib from training", inputs: "Sleep-EDFx EEG features", runnable_here: "gateway", why: "Superseded for serving by EVA-14. Weights are not in this repository." },
  { id: "EVA-5", type: "arch", name: "ptbxl-superclass-hgb", parent: null, module: "ECG", task: "5 diagnostic superclasses, 12-lead 10 s", status: "draft", served_as: null, michael: true, weights: "architecture only", inputs: "12-lead ECG features", runnable_here: "architecture_only", why: "Architecture spec. The trained instance is EVA-6." },
  { id: "EVA-6", type: "model", name: "ptbxl-superclass-hgb beta", parent: "EVA-5", module: "ECG", task: "5 diagnostic superclasses, 12-lead 10 s", status: "draft", served_as: "/v1/predict/ecg", michael: true, weights: "R2 models/ecg/model.joblib (legacy folder)", inputs: "12-lead 10 s ECG features", runnable_here: "gateway", why: "Joblib one-vs-rest classifiers. Loaded only inside evade-gateway." },
  { id: "EVA-7", type: "arch", name: "spe-onset-24h", parent: null, module: "radiation", task: "P(proton flux reaches 10 pfu within 24 h)", status: "draft", served_as: null, michael: true, weights: "architecture only", inputs: "19 GOES proton and X-ray history features, 48 h", runnable_here: "architecture_only", why: "Architecture spec. Served model is EVA-12." },
  { id: "EVA-8", type: "model", name: "spe-onset-24h logistic beta", parent: "EVA-7", module: "radiation", task: "SPE onset within 24 h", status: "draft", served_as: null, michael: true, weights: "earlier artifact, not the served file", inputs: "GOES-8..15 history", runnable_here: "not_retained", why: "Kept for the record. Serving uses EVA-12." },
  { id: "EVA-9", type: "model", name: "spe-onset-24h logistic v2 (background-corrected)", parent: "EVA-7", module: "radiation", task: "SPE onset within 24 h", status: "draft", served_as: null, michael: true, weights: "not served", inputs: "GOES history with background correction", runnable_here: "not_retained", why: "Replaced by EVA-12 on the same split, without the correction." },
  { id: "EVA-10", type: "arch", name: "spe-onset-24h-cme", parent: null, module: "radiation", task: "EVA-7 features plus CME speed and width", status: "draft", served_as: null, michael: true, weights: "architecture only", inputs: "GOES features + CME catalogue", runnable_here: "architecture_only", why: "Architecture spec. EVA-11 was the fit and its weights were not retained." },
  { id: "EVA-11", type: "model", name: "spe-onset-24h-cme logistic", parent: "EVA-10", module: "radiation", task: "SPE onset within 24 h with CME features", status: "draft", served_as: null, michael: true, weights: "not retained", inputs: "GOES + CME", runnable_here: "not_retained", why: "Registry says weights were not kept. Retraining would not be this artifact." },
  { id: "EVA-12", type: "model", name: "spe-onset-24h logistic v2 (GOES-R, no background correction)", parent: "EVA-7", module: "radiation", task: "P(SPE onset within 24 h)", status: "draft", served_as: "/v1/predict/space-weather", michael: true, weights: "R2 models/spaceweather/model.joblib", inputs: "48 h GOES proton and X-ray fluxes", runnable_here: "gateway", why: "Logistic regression in a joblib file. The Worker does not have the coefficients, so it does not invent P(onset)." },
  { id: "EVA-13", type: "model", name: "ptbxl-superclass resnet1d_wang", parent: null, module: "ECG", task: "5 diagnostic superclasses at 100 Hz", status: "draft", served_as: "/v1/predict/ecg-deep", michael: true, weights: "R2 ONNX (~2 MB)", inputs: "12-lead 10 s ECG at 100 Hz", runnable_here: "gateway", why: "ONNX runtime is in the gateway container, not in the Worker." },
  { id: "EVA-14", type: "model", name: "sleep-edfx 5-stage deep sleep staging", parent: null, module: "EEG", task: "W/N1/N2/N3/REM per 30 s epoch", status: "draft", served_as: "/v1/predict/sleep-deep", michael: true, weights: "R2 ONNX", inputs: "1-20 EEG epochs at 100 Hz", runnable_here: "gateway", why: "ONNX epoch CNN + bi-GRU. Runs in evade-gateway." },
  { id: "EVA-15", type: "model", name: "chb-mit seizure-suspect deep 1D ResNet", parent: null, module: "EEG", task: "seizure-suspect per 4 s window", status: "draft (not served)", served_as: null, michael: true, weights: "trained, not served", inputs: "18-channel 4 s windows at 256 Hz", runnable_here: "not_retained", why: "Registry: worse than EVA-2, so seizure-deep stays on placeholders and is not served." },
];

export function catalogById(id: string) {
  return MODEL_CATALOG.find((m) => m.id === id) ?? null;
}

/** Canonical JSON used for the catalog hash. Key order is the array order above. */
export function catalogDocument() {
  return JSON.stringify(MODEL_CATALOG);
}
