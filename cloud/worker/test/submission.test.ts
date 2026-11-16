import { describe, expect, it } from "vitest";
import { evaWindows, parseForecast, planEvaWindows, type EvaWindow } from "../src/evaWindow";
import { BIPOLAR_18, isRunnable, readResult, simulatedEeg } from "../src/modelRuns";
import { metricModelInfo, METRICS_WITH_MODELS } from "../src/metricModels";
import { MODEL_CATALOG } from "../src/modelCatalog";
import { needsSurgeonAttention, parseSelfieAssessment } from "../src/selfieAnalysis";
import { DEMO_SEED_SQL } from "../src/demoSeed.generated";

describe("demo seed", () => {
  const sql = DEMO_SEED_SQL.join("\n");
  it("keeps exactly the two demo people and leaves missions unchecked", () => {
    expect(sql).toContain("Demo Astronaut");
    expect(sql).toContain("Demo Flight Surgeon");
    expect(sql).not.toContain("Sato");
    expect(sql).not.toContain("Okafor");
    expect(sql).not.toContain("CASE WHEN sort_order");
    expect(sql).toContain("completed_at");
    expect(sql).toContain(", NULL");
  });
});

describe("EVA window rule", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  it("groups quiet Kp into a go window and stops at Kp 5", () => {
    const points = parseForecast([
      ["time_tag", "kp"],
      ["2026-11-16 12:00", 2],
      ["2026-11-16 15:00", 3],
      ["2026-11-16 18:00", 5],
      ["2026-11-16 21:00", 2],
    ]);
    const windows = evaWindows(points, { now, minHours: 6 });
    expect(windows).toHaveLength(1);
    expect(windows[0].status).toBe("go");
    expect(windows[0].source).toBe("noaa-kp-rule");
  });
  it("returns no window during a radiation storm", () => {
    expect(evaWindows([{ time: "2026-11-16T12:00:00Z", kp: 1 }], { now, protonPfu: 12 })).toEqual([]);
  });
});

describe("metric models", () => {
  it("has no model for blood pressure and says so", () => {
    const info = metricModelInfo("systolic_bp");
    expect(info.matches).toEqual([]);
    expect(info.note).toMatch(/No model in Michael's registry/);
  });
  it("points heart rate at the ECG models and labels the waveform as simulated", () => {
    const info = metricModelInfo("heart_rate");
    expect(info.matches.map(m => m.id)).toEqual(["EVA-13", "EVA-6"]);
    expect(info.matches.every(m => /simulated/.test(m.input))).toBe(true);
  });
  it("maps every matched model to one that the gateway serves", () => {
    for (const metric of METRICS_WITH_MODELS) {
      for (const m of metricModelInfo(metric).matches) expect(isRunnable(m.id), `${metric} -> ${m.id}`).toBe(true);
    }
  });
  it("only lists metrics that exist in the registry mapping", () => {
    expect(METRICS_WITH_MODELS).toContain("sleep_hours");
    expect(METRICS_WITH_MODELS).not.toContain("body_temp");
  });
});

describe("model catalog", () => {
  it("lists Michael's EVA-1 through EVA-15", () => {
    expect(MODEL_CATALOG.map(m => m.id)).toEqual(Array.from({ length: 15 }, (_, i) => `EVA-${i + 1}`));
    expect(MODEL_CATALOG.every(m => m.michael)).toBe(true);
    expect(MODEL_CATALOG.find(m => m.id === "EVA-12")?.served_as).toBe("/v1/predict/space-weather");
    expect(MODEL_CATALOG.find(m => m.id === "EVA-15")?.runnable_here).toBe("not_retained");
  });
});

describe("selfie assessment parser", () => {
  it("reads a structured vision reply", () => {
    const parsed = parseSelfieAssessment('Here:\n{"mood":"tired","explanation":"Eyes look heavy.","confidence":0.72}');
    expect(parsed.status).toBe("ok");
    expect(parsed.mood).toBe("tired");
    expect(parsed.confidence).toBe(0.72);
  });
  it("does not invent a mood when the model returns prose", () => {
    const parsed = parseSelfieAssessment("The astronaut looks happy.");
    expect(parsed.status).toBe("unparsed");
    expect(parsed.mood).toBeNull();
  });
});

describe("EVA window planner with EVA-12", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  const w = (start: string, end: string, status: "go" | "caution" = "go"): EvaWindow => ({ start, end, max_kp: 2, status, source: "noaa-kp-rule" });
  const windows = [w("2026-11-16T03:00Z", "2026-11-16T12:00Z"), w("2026-11-17T06:00Z", "2026-11-17T18:00Z")];
  it("keeps the Kp blocks when EVA-12 is under the caution line", () => {
    const plan = planEvaWindows(windows, 0.01, now);
    expect(plan.recommended?.start).toBe("2026-11-16T03:00Z");
    expect(plan.decision).toMatch(/1\.0%/);
  });
  it("downgrades blocks in the next 24 h to caution and recommends the later go block", () => {
    const plan = planEvaWindows(windows, 0.08, now);
    expect(plan.windows[0].status).toBe("caution");
    expect(plan.recommended?.start).toBe("2026-11-17T06:00Z");
  });
  it("drops blocks inside 24 h at the no-go line", () => {
    const plan = planEvaWindows(windows, 0.3, now);
    expect(plan.windows.map((x) => x.start)).toEqual(["2026-11-17T06:00Z"]);
  });
  it("says when it is using the Kp rule alone", () => {
    expect(planEvaWindows(windows, null, now).decision).toMatch(/NOAA Kp forecast alone/);
  });
});

describe("model run results", () => {
  it("reads EVA-12's probability from the forecast block", () => {
    const r = readResult("EVA-12", { data: { forecast: { status: "ok", p_onset_24h: 0.0123, climatology: 0.015 } } });
    expect(r.probabilities).toEqual([{ label: "Solar particle event within 24 h", value: 0.0123 }]);
    expect(r.headline).toMatch(/1\.2%/);
  });
  it("ranks EVA-13 classes and names the top abnormal one", () => {
    const r = readResult("EVA-13", { data: { probabilities: { NORM: 0.9, MI: 0.05, STTC: 0.2, CD: 0.01, HYP: 0.02 } } });
    expect(r.probabilities[0].label).toBe("Normal ECG");
    expect(r.headline).toMatch(/^Reads as a normal ECG \(90\.0%\)\. Highest abnormal class: ST\/T change, 20\.0%/);
  });
  it("reports the EEG baseline state instead of a number", () => {
    expect(readResult("EVA-2", { data: { seizure: { needs_baseline: true } } }).probabilities).toEqual([]);
  });
  it("builds 18 equal-length EEG channels in the 256 Hz shape the seizure model expects", () => {
    const x = simulatedEeg("seed", true);
    expect(x).toHaveLength(BIPOLAR_18.length);
    expect(new Set(x.map((row) => row.length))).toEqual(new Set([2560]));
    expect(x.flat().every(Number.isFinite)).toBe(true);
    expect(isRunnable("EVA-15")).toBe(false);
  });
});

describe("selfie assessment detail", () => {
  it("keeps observations and raises surgeon attention for fatigue", () => {
    const a = parseSelfieAssessment(JSON.stringify({ mood: "tired", confidence: 0.7, fatigue: "moderate", stress: "mild",
      explanation: "Eyelids look heavy.", observations: { eyes: "dark circles", expression: "flat", posture: "slumped", skin: "pale" }, follow_up: "Ask about sleep." }));
    expect(a.observations?.eyes).toBe("dark circles");
    expect(needsSurgeonAttention(a)).toBe(true);
  });
  it("does not alert for a calm selfie", () => {
    const a = parseSelfieAssessment('{"mood":"calm","confidence":0.8,"explanation":"Relaxed face.","fatigue":"none","stress":"none"}');
    expect(needsSurgeonAttention(a)).toBe(false);
  });
});
