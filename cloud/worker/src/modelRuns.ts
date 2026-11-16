// Runs Michael's served models (EVA-2, EVA-6, EVA-12, EVA-13, EVA-14) through evade-gateway with inputs his API accepts,
// and turns each response into a short, human-readable result. Request shapes follow backend-models/evade/api/schemas.py
// and deep_models.py, and the baseline sequence follows pi-sim/evade_sim/stream.py.
//
// What is real and what is synthetic:
//   EVA-12 reads live NOAA SWPC data on the model server (provider "noaa_swpc"): a real forecast.
//   EVA-2/6/13/14 need raw EEG or ECG waveforms. EVAde has no wearable streaming them, so the waveform is synthesized from
//   the astronaut's latest logged reading (heart rate drives the ECG, short sleep drives the hypnogram) and labelled
//   "simulated". The model and its weights are real; only the input recording is generated.

import { callModelApi, ModelApiError, modelUserId, type ModelEnv, type PredictKind } from "./models";
import { simulatedEcgDeep, simulatedSleepDeep } from "./simulationSignals";

export const RUNNABLE_MODELS = ["EVA-2", "EVA-6", "EVA-12", "EVA-13", "EVA-14"] as const;
export type RunnableModel = (typeof RUNNABLE_MODELS)[number];

export interface RunContext {
  heartRate: number | null;
  sleepHours: number | null;
  /** EEG only: mix a rhythmic seizure-like discharge into the synthetic EEG. */
  seizure: boolean;
}

export interface Probability { label: string; value: number; note?: string }

export interface ModelRunResult {
  model_id: RunnableModel;
  kind: PredictKind;
  ran: boolean;
  http_status: number;
  latency_ms: number;
  request_id: string | null;
  served_model_ids: string[];
  input: { source: "live NOAA SWPC" | "simulated waveform"; description: string };
  headline: string;
  probabilities: Probability[];
  flag: string | null;
  warnings: string[];
  output: unknown;
}

export const MODEL_KIND: Record<RunnableModel, PredictKind> = {
  "EVA-2": "eeg", "EVA-6": "ecg", "EVA-12": "space-weather", "EVA-13": "ecg-deep", "EVA-14": "sleep-deep",
};

const ECG_CLASSES: Record<string, string> = {
  NORM: "Normal ECG", MI: "Myocardial infarction pattern", STTC: "ST/T change", CD: "Conduction disturbance", HYP: "Hypertrophy",
};
const SLEEP_STAGES = ["W", "N1", "N2", "N3", "REM"] as const;

// ---------------------------------------------------------------- synthetic EEG (port of pi-sim signals.eeg_bipolar)
export const BIPOLAR_18 = ["FP1-F7", "F7-T7", "T7-P7", "P7-O1", "FP1-F3", "F3-C3", "C3-P3", "P3-O1", "FP2-F4", "F4-C4",
  "C4-P4", "P4-O2", "FP2-F8", "F8-T8", "T8-P8", "P8-O2", "FZ-CZ", "CZ-PZ"];
const EEG_FS = 256;
const EEG_WINDOW_S = 10;
const TAU = 2 * Math.PI;

// Deterministic PRNG so a run can be reproduced from its seed.
function rng(seed: string) {
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let n = Math.imul(state ^ (state >>> 15), 1 | state);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

// Unit-variance 1/f noise (Voss-McCartney octave bands), close to pi-sim's FFT pink noise.
function pink(random: () => number, n: number) {
  const bands = Array.from({ length: 10 }, () => random() * 2 - 1);
  let sum = bands.reduce((a, b) => a + b, 0);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const tick = (i + 1) % (1 << bands.length);
    if (tick !== 0) {
      const band = 31 - Math.clz32(tick & -tick);
      const next = random() * 2 - 1;
      sum += next - bands[band];
      bands[band] = next;
    }
    out[i] = (sum + random() * 2 - 1) / Math.sqrt(11 / 3);
  }
  return out;
}

/** 18-channel bipolar EEG in microvolts. seizure mixes in an evolving 10 -> 6 Hz rhythmic discharge, as in pi-sim. */
export function simulatedEeg(seed: string, seizure: boolean, seconds = EEG_WINDOW_S): number[][] {
  const random = rng(seed + ":eeg");
  const n = Math.round(seconds * EEG_FS);
  const common = pink(random, n);
  const level = seizure ? 1 : 0;
  const discharge = new Float64Array(n);
  if (seizure) {
    let phase = 0;
    for (let i = 0; i < n; i++) {
      phase += TAU * (10 - 4 * i / (n - 1)) / EEG_FS;
      discharge[i] = 150 * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase));
    }
  }
  return BIPOLAR_18.map((name, ch) => {
    const own = pink(random, n);
    const posterior = name.endsWith("O1") || name.endsWith("O2") || name.split("-")[1].includes("P");
    const gain = seizure ? (0.7 + 0.6 * random()) * (ch % 2 === 0 ? 1 : -1) : 0;
    const row: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / EEG_FS;
      let x = 12 * (0.6 * own[i] + 0.4 * common[i]) + (posterior ? 14 : 4) * Math.sin(TAU * 10 * t + ch * 0.7) * (1 - level);
      if (seizure) x = x * 0.5 + gain * discharge[i];
      row[i] = Math.round(x * 10) / 10;
    }
    return row;
  });
}

const eegWindow = (t0: Date, samples: number[][]) => ({
  modality: "eeg", t0_utc: t0.toISOString(), fs_hz: EEG_FS, unit: "uv", channels: BIPOLAR_18, samples, source: "simulated",
});

/** Seizure model baseline: 8 calm 10 s windows (32 four-second sub-windows; the model needs 30), two per request (< 1 MB). */
async function submitEegBaseline(env: ModelEnv, modelUser: string, seed: string) {
  const start = Date.now() - 20 * 60_000;
  for (let call = 0; call < 4; call++) {
    const windows = [0, 1].map((i) => {
      const k = call * 2 + i;
      return eegWindow(new Date(start + k * EEG_WINDOW_S * 1000), simulatedEeg(`${seed}:baseline:${k}`, false));
    });
    const r = await callModelApi(env, "POST", "/v1/baseline/eeg", { user_id: modelUser, windows, mode: "demo" });
    if (!r.ok) throw new ModelApiError(r.status, "The seizure model could not record a baseline");
  }
}

// ---------------------------------------------------------------- payloads
function payloadFor(model: RunnableModel, modelUser: string, ctx: RunContext, seed: string) {
  const hr = Math.min(Math.max(ctx.heartRate ?? 70, 30), 200);
  if (model === "EVA-12") {
    return { body: { user_id: modelUser, provider: "noaa_swpc" }, source: "live NOAA SWPC" as const,
      description: "Last 72 h of GOES proton and X-ray flux and the Kp index, fetched from NOAA SWPC by the model server." };
  }
  if (model === "EVA-13" || model === "EVA-6") {
    const ecg = simulatedEcgDeep(seed, hr);
    const description = `10 s, 12-lead ECG at 100 Hz, synthesized at ${Math.round(hr)} bpm from ${ctx.heartRate == null ? "a default rate (no heart-rate reading yet)" : "the latest heart-rate reading"}.`;
    if (model === "EVA-13") return { body: { user_id: modelUser, ...ecg }, source: "simulated waveform" as const, description };
    return {
      body: { user_id: modelUser, window: { modality: "ecg", t0_utc: new Date(Date.now() - 15_000).toISOString(), fs_hz: 100, unit: "mv",
        channels: ecg.leads, samples: ecg.samples, source: "simulated" } },
      source: "simulated waveform" as const, description,
    };
  }
  if (model === "EVA-14") {
    const poor = ctx.sleepHours != null && ctx.sleepHours < 6;
    return { body: { user_id: modelUser, ...simulatedSleepDeep(seed, poor) }, source: "simulated waveform" as const,
      description: `Ten 30 s epochs of Fpz-Cz / Pz-Oz EEG at 100 Hz, synthesized as ${poor ? "fragmented sleep (latest sleep under 6 h)" : "a normal sleep cycle"}.` };
  }
  return {
    body: { user_id: modelUser, window: eegWindow(new Date(Date.now() - 15_000), simulatedEeg(seed, ctx.seizure)) },
    source: "simulated waveform" as const,
    description: `10 s of 18-channel bipolar EEG at 256 Hz, synthesized ${ctx.seizure ? "with a rhythmic seizure-like discharge" : "as calm background EEG"}.`,
  };
}

// ---------------------------------------------------------------- readable results
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const prob = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

export function readResult(model: RunnableModel, out: any): Pick<ModelRunResult, "headline" | "probabilities" | "flag"> {
  const d = out?.data ?? {};
  if (model === "EVA-12") {
    const f = d.forecast ?? {};
    if (prob(f.p_onset_24h)) {
      const clim = prob(f.climatology) ? ` (long-run base rate ${pct(f.climatology)})` : "";
      return { headline: `${pct(f.p_onset_24h)} chance of a solar particle event (>=10 MeV protons reaching 10 pfu) in the next 24 h${clim}.`,
        probabilities: [{ label: "Solar particle event within 24 h", value: f.p_onset_24h }], flag: d.nowcast?.level ?? null };
    }
    return { headline: f.status === "event_in_progress" ? "A solar particle event is already in progress, so the onset forecast does not apply."
      : `No forecast: ${f.reason ?? f.status ?? "the model returned no probability"}.`, probabilities: [], flag: d.nowcast?.level ?? null };
  }
  if (model === "EVA-13" || model === "EVA-6") {
    const raw = model === "EVA-13" ? d.probabilities : d.superclass_probability;
    const probabilities = Object.entries(raw ?? {}).filter(([, v]) => prob(v))
      .map(([k, v]) => ({ label: ECG_CLASSES[k] ?? k, value: v as number }))
      .sort((a, b) => b.value - a.value);
    const normal = probabilities.find((p) => p.label === ECG_CLASSES.NORM);
    const top = probabilities.filter((p) => p.label !== ECG_CLASSES.NORM)[0];
    const rhythm = d.rhythm?.flag && d.rhythm.flag !== "none" ? ` Rhythm rule: ${String(d.rhythm.flag).replace(/_/g, " ")}.` : "";
    const lead = normal && top && normal.value >= top.value ? `Reads as a normal ECG (${pct(normal.value)}). ` : "";
    return {
      headline: top ? `${lead}Highest abnormal class: ${top.label}, ${pct(top.value)}.${rhythm}` : `The model returned no class probabilities.${rhythm}`,
      probabilities, flag: d.rhythm?.flag ?? (Array.isArray(d.top_classes) ? d.top_classes.map((c: any) => c.class).join(", ") || null : null),
    };
  }
  if (model === "EVA-14") {
    const minutes = d.summary?.minutes_per_stage ?? {};
    const total = SLEEP_STAGES.reduce((s, k) => s + (typeof minutes[k] === "number" ? minutes[k] : 0), 0);
    const probabilities = total > 0 ? SLEEP_STAGES.map((k) => ({ label: `${k} share of epochs`, value: (minutes[k] ?? 0) / total })) : [];
    const stages = Array.isArray(d.epochs) ? d.epochs.map((e: any) => e?.stage).filter(Boolean).join(" ") : "";
    return { headline: stages ? `Stages per 30 s epoch: ${stages}.` : "The model returned no stages.", probabilities, flag: null };
  }
  const s = d.seizure ?? {};
  if (prob(s.probability)) {
    const t = s.thresholds ?? {};
    return {
      headline: `Seizure-suspect probability ${pct(s.probability)}: ${s.level === "red" ? "suspect seizure" : s.level === "yellow" ? "needs review" : "no flag"}.`,
      probabilities: [{ label: "Seizure-suspect (4 s windows, max)", value: s.probability,
        note: prob(t.review_5pct_fpr) && prob(t.suspect_1pct_fpr) ? `review above ${pct(t.review_5pct_fpr)}, suspect above ${pct(t.suspect_1pct_fpr)}` : undefined }],
      flag: s.flag ?? null,
    };
  }
  return { headline: s.needs_baseline ? "The seizure model is still collecting this person's EEG baseline." : s.low_quality ? "EEG quality too low to score." : "The model returned no probability.",
    probabilities: [], flag: null };
}

/** Runs one model for one EVAde user. Throws ModelApiError only when the service is unreachable or not configured. */
export async function runModel(env: ModelEnv, userId: string, model: RunnableModel, ctx: RunContext): Promise<ModelRunResult> {
  const kind = MODEL_KIND[model];
  const modelUser = await modelUserId(env, userId);
  const seed = `${userId}:${model}:${Date.now()}`;
  const { body, source, description } = payloadFor(model, modelUser, ctx, seed);
  const started = Date.now();
  let r = await callModelApi(env, "POST", `/v1/predict/${kind}`, body);
  if (model === "EVA-2" && r.ok && r.out?.data?.seizure?.needs_baseline) {
    // First EEG run for this person: record a calm baseline (Michael's per-person normalization), then score again.
    await submitEegBaseline(env, modelUser, `${userId}:eeg-baseline`);
    r = await callModelApi(env, "POST", `/v1/predict/${kind}`, body);
  }
  const out = r.out ?? {};
  const served = Array.isArray(out.model_ids) ? out.model_ids.map(String) : [];
  const readable = r.ok ? readResult(model, out) : { headline: `The model service answered HTTP ${r.status}: ${out?.error?.message ?? "no prediction"}.`, probabilities: [], flag: null };
  const { user_id: _drop, ...safeOut } = out;
  return {
    model_id: model, kind, ran: r.ok && served.length > 0, http_status: r.status, latency_ms: Date.now() - started,
    request_id: typeof out.request_id === "string" ? out.request_id : null, served_model_ids: served,
    input: { source, description }, ...readable,
    warnings: Array.isArray(out.warnings) ? out.warnings.map(String).slice(0, 8) : [], output: safeOut,
  };
}

export function isRunnable(id: string): id is RunnableModel {
  return (RUNNABLE_MODELS as readonly string[]).includes(id);
}
