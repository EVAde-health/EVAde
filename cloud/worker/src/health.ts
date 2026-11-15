// Health logic shared by the Worker: color levels, personal baselines, rule-based risk score + MDTR.
// Formulas follow EVAde-backend-models "lit review/planning/risk-score.md" (noisy-OR v2) and
// "max-days-to-return.md". This is the edge fallback; Michael's FastAPI /predict/risk is the full version.

export type Level = "green" | "yellow" | "red";

export interface MetricDef {
  metric: string;
  label: string;
  unit: string;
  domain: string;
  green_min: number | null;
  green_max: number | null;
  yellow_min: number | null;
  yellow_max: number | null;
  bad_direction: "up" | "down" | "both";
  what_to_do: string;
  escalate_when: string;
}

const inRange = (v: number, lo: number | null, hi: number | null) =>
  (lo === null || v >= lo) && (hi === null || v <= hi);

export function levelFromThresholds(v: number, d: MetricDef): Level {
  if (inRange(v, d.green_min, d.green_max)) return "green";
  if (inRange(v, d.yellow_min, d.yellow_max)) return "yellow";
  return "red";
}

/** Robust baseline: median and 1.4826*MAD, spread floored at 15% of |center|. */
export function robustBaseline(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const med = (a: number[]) => {
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const center = med(s);
  const mad = med(s.map((x) => Math.abs(x - center)).sort((a, b) => a - b));
  const spread = Math.max(1.4826 * mad, 0.15 * Math.abs(center), 1e-6);
  return { center, spread, n: values.length };
}

/** Signed z clipped to ±5, and level counting only the bad direction (green <1, yellow 1-2, red >2). */
export function levelFromBaseline(v: number, center: number, spread: number, dir: MetricDef["bad_direction"]) {
  const z = Math.max(-5, Math.min(5, (v - center) / spread));
  const bad = dir === "up" ? z : dir === "down" ? -z : Math.abs(z);
  const level: Level = bad < 1 ? "green" : bad <= 2 ? "yellow" : "red";
  return { z, level };
}

export const worst = (a: Level, b: Level): Level => {
  const r = { green: 0, yellow: 1, red: 2 };
  return r[a] >= r[b] ? a : b;
};

/** Linear interpolation over anchor points [(x, score)], clamped at both ends. */
export function anchor(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pts[pts.length - 1][1];
}
// Same, for features where *lower* is worse (anchors listed from good to bad, descending x).
const anchorDesc = (x: number, pts: [number, number][]) =>
  anchor(-x, pts.map(([a, b]) => [-a, b] as [number, number]));

const domainScore = (c: number[]) =>
  c.length ? 0.6 * Math.max(...c) + 0.4 * (c.reduce((a, b) => a + b, 0) / c.length) : null;

export interface Latest {
  [metric: string]: number | undefined;
}

export interface RiskInput {
  latest: Latest; // most recent value per metric
  hrZ?: number; // resting HR z vs baseline
  sleep7d?: number; // 7-day mean sleep hours
  phq9?: number;
  gad7?: number;
  phq9Item9?: number;
  cumulativeMsv?: number;
  speMsv?: number;
  doseRateRatio?: number;
  seizureEvents24h?: number;
}

export function computeRisk(inp: RiskInput) {
  const L = inp.latest;
  const card: number[] = [];
  if (inp.hrZ !== undefined) card.push(anchor(Math.abs(inp.hrZ), [[1, 0], [2, 0.3], [3, 0.6], [4, 1]]));
  if (L.ecg_irregular_pct !== undefined) card.push(anchor(L.ecg_irregular_pct, [[0, 0], [1, 0.3], [5, 0.6], [20, 1]]));
  if (L.spo2 !== undefined) card.push(anchorDesc(L.spo2, [[95, 0], [92, 0.5], [88, 1]]));
  if (L.respiration_rate !== undefined) {
    const rr = L.respiration_rate;
    card.push(rr < 12 ? anchorDesc(rr, [[12, 0], [10, 0.5], [8, 1]]) : anchor(rr, [[20, 0], [24, 0.5], [30, 1]]));
  }

  // EVAde extension (not in risk-score.md v2): fever as a vitals component, so infection shows up in R.
  if (L.body_temp !== undefined) card.push(anchor(L.body_temp, [[37.5, 0], [38, 0.3], [38.5, 0.6], [39.5, 1]]));

  const beh: number[] = [];
  const sleep = inp.sleep7d ?? L.sleep_hours;
  if (sleep !== undefined) beh.push(anchorDesc(sleep, [[7, 0], [6, 0.35], [5, 0.7], [4, 1]]));
  if (inp.phq9 !== undefined) beh.push(anchor(inp.phq9, [[0, 0], [5, 0.15], [10, 0.5], [15, 0.75], [20, 1]]));
  if (inp.gad7 !== undefined) beh.push(anchor(inp.gad7, [[0, 0], [5, 0.15], [10, 0.5], [15, 0.9], [21, 1]]));
  if (L.mood !== undefined) beh.push(anchorDesc(L.mood, [[3, 0], [2, 0.3], [1, 0.6]])); // self-report, capped 0.6

  const neu: number[] = [];
  if (inp.seizureEvents24h !== undefined) neu.push(anchor(inp.seizureEvents24h, [[0, 0], [1, 0.8], [2, 1]]));
  if (L.eeg_drowsiness_z !== undefined) neu.push(anchor(L.eeg_drowsiness_z, [[1, 0], [2, 0.3], [3, 0.6]]));

  const rad: number[] = [];
  if (inp.cumulativeMsv !== undefined)
    rad.push(anchor(inp.cumulativeMsv / 600, [[0.05, 0], [0.25, 0.25], [0.5, 0.5], [0.75, 0.8], [1, 1]]));
  if (inp.speMsv !== undefined) rad.push(anchor(inp.speMsv / 250, [[0, 0], [0.1, 0.2], [0.5, 0.6], [1, 1]]));
  if (inp.doseRateRatio !== undefined) rad.push(anchor(inp.doseRateRatio, [[1.5, 0], [1.5001, 0.2], [3, 0.6], [10, 1]]));

  const bone: number[] = [];
  if (L.bone_density_change_pct !== undefined)
    bone.push(anchorDesc(L.bone_density_change_pct, [[0, 0], [-3, 0.25], [-6, 0.5], [-10, 1]]));

  const s: Record<string, number | null> = {
    cardiac: domainScore(card),
    behavioral: domainScore(beh),
    neuro: neu.length ? Math.max(...neu) : null,
    radiation: rad.length ? Math.max(...rad) : null,
    bone: bone.length ? Math.max(...bone) : null,
  };
  const influence: Record<string, number> = { cardiac: 1, behavioral: 1, radiation: 0.8, neuro: 0.6, bone: 0.6 };

  let Lsum = 0;
  let flag = false;
  for (const [d, sd] of Object.entries(s)) {
    if (sd === null) continue;
    const p = influence[d] * 0.75 * Math.max(0, (sd - 0.1) / 0.9);
    Lsum += -Math.log(1 - p);
    if (sd >= 0.3) flag = true;
  }
  const rAgg = 0.005 + 0.99 * (1 - Math.exp(-Lsum));

  const overrides: string[] = [];
  if ((inp.phq9Item9 ?? 0) > 0) overrides.push("O1: PHQ-9 item 9 above 0, clinician contact within 1 hour");
  if (L.spo2 !== undefined && L.spo2 < 88) overrides.push("O2: SpO2 below 88%, confirm on a second sensor, immediate review");
  if ((inp.seizureEvents24h ?? 0) >= 1) overrides.push("O4: seizure event, immediate clinician review");
  if ((inp.speMsv ?? 0) >= 250) overrides.push("O5: solar particle event dose at or above 250 mSv");

  const ov = overrides.length > 0;
  const rDisp = Math.max(rAgg, flag ? 0.6 : 0, ov ? 0.8 : 0);
  const rMdtr = Math.max(rAgg, ov ? 0.8 : 0);
  const mdtrDays = 150 * Math.pow(1 - rMdtr, 1.5);
  const mdtr = mdtrDays < 5 ? "<5" : mdtrDays > 100 ? ">100" : String(Math.round(mdtrDays));

  const band =
    rDisp < 0.2 ? "low" : rDisp < 0.4 ? "guarded" : rDisp < 0.6 ? "elevated" : rDisp < 0.8 ? "high" : "critical";
  const action = {
    low: "Routine monitoring.",
    guarded: "Measure twice as often and include in the routine medical report.",
    elevated: "Flight surgeon review within 24 hours; start a countermeasure plan.",
    high: "Flight surgeon review within 4 hours; start return planning.",
    critical: "Contact the flight surgeon now; execute the return plan.",
  }[band];

  const top = Object.entries(s)
    .filter(([, v]) => v !== null)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 2)
    .map(([d]) => d);

  return {
    r: +rDisp.toFixed(3),
    r_agg: +rAgg.toFixed(3),
    band,
    action,
    mdtr,
    mdtr_days: +mdtrDays.toFixed(1),
    domains: s,
    top_domains: top,
    abnormal_flag: flag,
    overrides,
    note: "Rule-based edge estimate for review, not a diagnosis.",
  };
}

/** EVA go/no-go from NOAA space weather (proton S-scale and Kp). */
export function evaStatus(protonPfu: number | null, kp: number | null): "go" | "caution" | "no_go" | null {
  if (protonPfu === null && kp === null) return null; // no data -> never claim "go"
  if (protonPfu !== null && protonPfu >= 10) return "no_go"; // NOAA S1+ radiation storm
  if ((protonPfu !== null && protonPfu >= 1) || (kp !== null && kp >= 5)) return "caution";
  return "go";
}

export function stormLevel(pfu: number | null): string {
  if (pfu === null) return "unknown";
  if (pfu >= 1e5) return "S5";
  if (pfu >= 1e4) return "S4";
  if (pfu >= 1e3) return "S3";
  if (pfu >= 100) return "S2";
  if (pfu >= 10) return "S1";
  return "S0";
}

export function xrayClass(flux: number | null): string | null {
  if (flux === null || !(flux > 0)) return null;
  const classes: [string, number][] = [["X", 1e-4], ["M", 1e-5], ["C", 1e-6], ["B", 1e-7], ["A", 1e-8]];
  for (const [c, base] of classes) if (flux >= base) return `${c}${(flux / base).toFixed(1)}`;
  return "A0.0";
}
