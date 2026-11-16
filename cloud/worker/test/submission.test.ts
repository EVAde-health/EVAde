import { describe, expect, it } from "vitest";
import { evaWindows, parseForecast } from "../src/evaWindow";
import { metricModelInfo, METRICS_WITH_MODELS } from "../src/metricModels";
import { MODEL_CATALOG } from "../src/modelCatalog";
import { parseSelfieAssessment } from "../src/selfieAnalysis";
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
  it("does not invent a probability for blood pressure", () => {
    const info = metricModelInfo("systolic_bp");
    expect(info.matches).toEqual([]);
    expect(info.probability).toBeNull();
  });
  it("points heart rate at the ECG models without calling them runnable from one number", () => {
    const info = metricModelInfo("heart_rate");
    expect(info.matches.map(m => m.id)).toEqual(["EVA-6", "EVA-13"]);
    expect(info.matches.every(m => m.runnable_from_reading === false)).toBe(true);
    expect(info.probability).toBeNull();
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
