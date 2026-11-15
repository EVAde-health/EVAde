// Return-to-Earth forecast: trend math, days to limit, the return decision, and the AI / model-api guards.
import { describe, expect, it } from "vitest";
import type { MetricDef } from "../src/health";
import {
  analyzeMetric, combineReturn, dailyMeans, displayDays, fitLine, predict, radiationTrend, type PredictionInputs,
} from "../src/prediction";

const DAY = 864e5;
const T0 = Date.parse("2026-10-01T08:00:00.000Z");

// Catalogue row with the fields the forecast reads.
function def(over: Partial<MetricDef>): MetricDef {
  return {
    metric: "sleep_hours", label: "Sleep duration", unit: "hours", domain: "behavioral",
    green_min: 7, green_max: 10, yellow_min: 5, yellow_max: 12, bad_direction: "down",
    what_to_do: "", escalate_when: "", ...over,
  };
}

// One reading per day following value(day).
function series(days: number, value: (d: number) => number) {
  return Array.from({ length: days }, (_, d) => ({ value: value(d), ts: new Date(T0 + d * DAY).toISOString() }));
}

describe("trend math", () => {
  it("averages several readings on the same day", () => {
    const rows = [{ value: 60, ts: "2026-10-01T01:00:00Z" }, { value: 70, ts: "2026-10-01T20:00:00Z" }, { value: 80, ts: "2026-10-02T09:00:00Z" }];
    expect(dailyMeans(rows).map((p) => p.value)).toEqual([65, 80]);
  });

  it("fits an exact line", () => {
    const fit = fitLine([0, 1, 2, 3].map((d) => ({ day: d, value: 10 - 0.5 * d })))!;
    expect(fit.slope).toBeCloseTo(-0.5);
    expect(fit.r2).toBeCloseTo(1);
  });

  it("projects when a falling metric reaches its red limit", () => {
    // Sleep falls 0.1 h/day from 8 h; red below 5 h, so about 30 days after the last reading (day 13 at 6.7 h -> 17 days).
    const t = analyzeMetric(def({}), series(14, (d) => 8 - 0.1 * d))!;
    expect(t.direction).toBe("falling");
    expect(t.worsening).toBe(true);
    expect(t.slope_per_week).toBeCloseTo(-0.7);
    expect(t.days_to_limit).toBeCloseTo(17, 0);
    expect(t.confidence).toBe("high");
    expect(t.concern).toBeGreaterThan(0.5);
  });

  it("does not project when a metric moves toward the good side", () => {
    const t = analyzeMetric(def({}), series(14, (d) => 7 + 0.1 * d))!;
    expect(t.worsening).toBe(false);
    expect(t.days_to_limit).toBeNull();
  });

  it("calls a flat noisy metric steady", () => {
    const t = analyzeMetric(def({}), series(20, (d) => 8 + (d % 2 ? 0.05 : -0.05)))!;
    expect(t.direction).toBe("steady");
    expect(t.days_to_limit).toBeNull();
  });

  it("reports zero days when the latest reading is already red", () => {
    const t = analyzeMetric(def({}), series(6, (d) => 6 - 0.3 * d))!;
    expect(t.level).toBe("red");
    expect(t.days_to_limit).toBe(0);
    expect(t.concern).toBe(1);
  });

  it("skips the trend with too few days but keeps the level", () => {
    const t = analyzeMetric(def({}), series(2, () => 6))!;
    expect(t.level).toBe("yellow");
    expect(t.direction).toBeNull();
  });

  it("uses the side a two-sided metric is heading toward", () => {
    const hr = def({ metric: "heart_rate", label: "Resting heart rate", unit: "bpm", domain: "cardiac",
      green_min: 50, green_max: 100, yellow_min: 40, yellow_max: 120, bad_direction: "both" });
    const t = analyzeMetric(hr, series(10, (d) => 90 + 2 * d))!;
    expect(t.limit).toBe(120);
    expect(t.days_to_limit).toBeCloseTo(6, 0);
  });

  it("has no red limit on a side whose yellow bound is open", () => {
    const open = def({ yellow_min: null, bad_direction: "down" });
    const t = analyzeMetric(open, series(14, (d) => 8 - 0.1 * d))!;
    expect(t.limit).toBeNull();
    expect(t.days_to_limit).toBeNull();
  });
});

describe("radiation", () => {
  it("projects days to the career limit at the recent daily rate", () => {
    const doses = series(10, (d) => d).map((r, d) => ({ ts: r.ts, cumulative_msv: 400 + d * 2, daily_dose_msv: 2 }));
    const t = radiationTrend(doses, 600)!;
    expect(t.latest).toBe(418);
    expect(t.days_to_limit).toBe(91);
    expect(t.level).toBe("green");
  });
});

describe("return decision", () => {
  const sleep = analyzeMetric(def({}), series(14, (d) => 8 - 0.1 * d))!;

  it("takes the earliest limit and names its driver", () => {
    const out = combineReturn([sleep], 120, 60);
    expect(out.driver).toBe("trend");
    expect(out.driver_metric).toBe("sleep_hours");
    expect(out.display).toBe("17 days");
    expect(out.scheduled_days_left).toBe(60);
  });

  it("falls back to the risk estimate when no metric is heading to a limit", () => {
    const flat = analyzeMetric(def({}), series(14, () => 8))!;
    const out = combineReturn([flat], 140, null);
    expect(out.driver).toBe("risk");
    expect(out.display).toBe(">100 days");
  });

  it("reports insufficient data without readings", () => {
    expect(combineReturn([], null, null).status).toBe("insufficient_data");
  });

  it("formats days like the model service", () => {
    expect(displayDays(3)).toBe("<5 days");
    expect(displayDays(42.4)).toBe("42 days");
    expect(displayDays(150)).toBe(">100 days");
  });
});

describe("predict()", () => {
  const inputs: PredictionInputs = {
    defs: new Map([["sleep_hours", def({})]]),
    observations: series(14, (d) => 8 - 0.1 * d).map((r) => ({ metric: "sleep_hours", ...r })),
    doses: [], radiationLimitMsv: 600, riskMdtrDays: 120, scheduledDaysLeft: null,
  };
  const fakeAi = (response: unknown) => ({ run: async () => ({ response }) }) as unknown as Ai;

  it("uses the model's pick and words, never its numbers", async () => {
    const out = await predict({ AI: fakeAi({
      most_concerning_metric: "sleep_hours", reason: "Sleep is falling.", headline: "Return in about 17 days", explanation: "Sleep is down.",
    }) } as any, "u1", inputs);
    expect(out.source).toBe("workers-ai");
    expect(out.most_concerning?.metric).toBe("sleep_hours");
    expect(out.return.days).toBe(17);
  });

  it("ignores a metric the model made up and falls back to rules", async () => {
    const out = await predict({ AI: fakeAi({
      most_concerning_metric: "made_up", reason: "x", headline: "x", explanation: "x",
    }) } as any, "u1", inputs);
    expect(out.source).toBe("rules");
    expect(out.most_concerning?.metric).toBe("sleep_hours");
  });

  it("falls back to the Worker forecast when the model service is not connected", async () => {
    const out = await predict({ PREDICTION_PROVIDER: "model-api" } as any, "u1", inputs);
    expect(out.provider_fallback).toMatch(/not connected/);
    expect(out.return.driver).toBe("trend");
  });
});
