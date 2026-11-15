// Return-to-Earth forecast: per-metric trend analysis, days until each metric reaches its red limit, and the
// predicted days until the astronaut should go home, with the factor that drives it.
//
// Numbers are computed here with plain statistics (least-squares lines over daily means), so they are reproducible
// and auditable. The language model (Grok) only ranks which metric is most concerning, chosen from the metrics
// below, and explains the result in plain words; it never produces a number.
//
// Provider switch: PREDICTION_PROVIDER="model-api" takes the days-to-return figure from the custom model service
// (POST /v1/predict/risk behind the evade-gateway Worker, see models.ts). Until it is connected, or if it fails,
// the Worker falls back to the computation below. The response shape is the same either way.
import { grok, parseModelJson, type AiEnv } from "./ai";
import { levelFromThresholds, type Level, type MetricDef } from "./health";
import { callModelApi, modelUserId, modelsConfigured, type ModelEnv } from "./models";

export const WINDOW_DAYS = 30;
const DAY_MS = 864e5;
const HORIZON_DAYS = 365; // projections further out than this are reported as "not within a year"
const MIN_DAYS_FOR_TREND = 4; // daily points needed before a trend is fitted

// Driver names match the model service contract (mdtr_driver in backend-models api-schema.md).
export type ReturnDriver = "risk" | "trend" | "radiation_limit" | "bone_limit" | "acute" | "extreme_domain";
export type Direction = "rising" | "falling" | "steady";
export type Confidence = "high" | "medium" | "low";

export interface MetricTrend {
  metric: string;
  label: string;
  unit: string;
  domain: string;
  level: Level;
  latest: number;
  latest_ts: string;
  days_with_data: number;
  slope_per_week: number | null;
  direction: Direction | null;
  worsening: boolean;
  r2: number | null;
  confidence: Confidence | null;
  limit: number | null; // red boundary on the side the metric is heading toward
  days_to_limit: number | null; // 0 when already past the limit; null when not heading toward it
  days_to_limit_range: { low: number; high: number | null } | null;
  concern: number; // 0..1, used to rank metrics
}

export interface ReturnForecast {
  status: "ok" | "insufficient_data";
  days: number | null;
  display: string;
  driver: ReturnDriver | null;
  driver_metric: string | null;
  driver_label: string | null;
  interval_days: { low: number; high: number | null } | null;
  provisional: boolean;
  scheduled_days_left: number | null;
}

export interface Prediction {
  generated_at: string;
  source: "ai" | "model-api" | "rules";
  model: string | null;
  provider_fallback: string | null;
  window_days: number;
  return: ReturnForecast;
  most_concerning: { metric: string; label: string; level: Level; reason: string } | null;
  headline: string;
  explanation: string;
  trends: MetricTrend[];
  note: string;
}

export interface PredictionEnv extends AiEnv, ModelEnv {
  PREDICTION_PROVIDER?: string; // "ai" (default: trend math + Grok) or "model-api"
  LOGISTICS_FLOOR_DAYS?: string; // lead time to arrange a return, required by the model service
}

interface Point { day: number; value: number }

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

// Averages raw observations into one value per calendar day, oldest first.
export function dailyMeans(rows: { value: number; ts: string }[]): Point[] {
  const byDay = new Map<number, number[]>();
  for (const row of rows) {
    const day = Math.floor(Date.parse(row.ts) / DAY_MS);
    if (!Number.isFinite(day) || !Number.isFinite(row.value)) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), row.value]);
  }
  return [...byDay.entries()].sort(([a], [b]) => a - b)
    .map(([day, values]) => ({ day, value: values.reduce((s, v) => s + v, 0) / values.length }));
}

// Least-squares line through daily points: slope per day, its standard error, fit quality.
export function fitLine(points: Point[]) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.day, 0) / n;
  const my = points.reduce((s, p) => s + p.value, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of points) {
    sxx += (p.day - mx) ** 2;
    sxy += (p.day - mx) * (p.value - my);
    syy += (p.value - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const ssRes = points.reduce((s, p) => s + (p.value - (intercept + slope * p.day)) ** 2, 0);
  const r2 = syy === 0 ? 1 : Math.max(0, 1 - ssRes / syy);
  const se = n > 2 ? Math.sqrt(ssRes / (n - 2) / sxx) : Math.abs(slope);
  return { slope, intercept, r2, se };
}

// Red boundary on one side of a metric's bands; a missing yellow bound means that side has no red zone.
function redLimit(def: MetricDef, side: "up" | "down") {
  return side === "up" ? def.yellow_max ?? null : def.yellow_min ?? null;
}

// Days for a line starting at `from` with `slope` to reach `limit`; null if it never does.
function daysUntil(from: number, slope: number, limit: number) {
  if (slope === 0) return null;
  const days = (limit - from) / slope;
  return days >= 0 ? days : null;
}

// Trend, projected days to the red limit and a 0..1 concern score for one metric.
export function analyzeMetric(def: MetricDef, rows: { value: number; ts: string }[]): MetricTrend | null {
  if (!rows.length) return null;
  const latestRow = rows.reduce((a, b) => (a.ts > b.ts ? a : b));
  const level = levelFromThresholds(latestRow.value, def);
  const points = dailyMeans(rows);
  const base: MetricTrend = {
    metric: def.metric, label: def.label, unit: def.unit, domain: def.domain, level,
    latest: round(latestRow.value, 2), latest_ts: latestRow.ts, days_with_data: points.length,
    slope_per_week: null, direction: null, worsening: false, r2: null, confidence: null,
    limit: null, days_to_limit: null, days_to_limit_range: null,
    concern: level === "red" ? 1 : level === "yellow" ? 0.5 : 0,
  };
  const fit = points.length >= MIN_DAYS_FOR_TREND ? fitLine(points) : null;
  if (!fit) return base;

  const lastDay = points[points.length - 1].day;
  const fitted = fit.intercept + fit.slope * lastDay;
  const side: "up" | "down" = def.bad_direction === "both" ? (fit.slope >= 0 ? "up" : "down") : def.bad_direction;
  const limit = redLimit(def, side);
  // "Steady" when two weeks of this slope would move less than 10% of the distance from the normal band to red.
  const greenEdge = side === "up" ? def.green_max : def.green_min;
  const margin = limit !== null && greenEdge !== null && limit !== greenEdge ? Math.abs(limit - greenEdge) : Math.abs(fitted) * 0.05 || 1;
  const steady = Math.abs(fit.slope) * 14 < margin * 0.1;
  const direction: Direction = steady ? "steady" : fit.slope > 0 ? "rising" : "falling";
  const worsening = !steady && (side === "up" ? fit.slope > 0 : fit.slope < 0);
  const confidence: Confidence = points.length >= 14 && fit.r2 >= 0.5 ? "high" : points.length >= 7 && fit.r2 >= 0.25 ? "medium" : "low";

  let daysToLimit: number | null = null;
  let range: MetricTrend["days_to_limit_range"] = null;
  if (level === "red") {
    daysToLimit = 0;
  } else if (worsening && limit !== null) {
    const central = daysUntil(fitted, fit.slope, limit);
    if (central !== null && central <= HORIZON_DAYS) {
      daysToLimit = round(central);
      // Faster and slower slopes (one standard error each way) bound the estimate.
      const fast = daysUntil(fitted, fit.slope + Math.sign(fit.slope) * fit.se, limit);
      const slowSlope = fit.slope - Math.sign(fit.slope) * fit.se;
      const slow = Math.sign(slowSlope) === Math.sign(fit.slope) ? daysUntil(fitted, slowSlope, limit) : null;
      range = { low: round(fast ?? central), high: slow !== null && slow <= HORIZON_DAYS ? round(slow) : null };
    }
  }

  const weight = { high: 1, medium: 0.8, low: 0.5 }[confidence];
  const timeConcern = daysToLimit === null ? 0 : Math.max(0, 1 - daysToLimit / 120) * weight;
  return {
    ...base,
    slope_per_week: round(fit.slope * 7, 3),
    direction, worsening, r2: round(fit.r2, 2), confidence,
    limit, days_to_limit: daysToLimit, days_to_limit_range: range,
    concern: round(Math.max(base.concern, timeConcern), 3),
  };
}

// Cumulative radiation dose against the career limit at the recent daily rate.
export function radiationTrend(
  doses: { ts: string; cumulative_msv: number | null; daily_dose_msv: number | null }[], limitMsv: number,
): MetricTrend | null {
  const withTotal = doses.filter((d) => d.cumulative_msv !== null);
  if (!withTotal.length) return null;
  const latest = withTotal.reduce((a, b) => (a.ts > b.ts ? a : b));
  const total = latest.cumulative_msv!;
  const daily = dailyMeans(doses.filter((d) => d.daily_dose_msv !== null).map((d) => ({ value: d.daily_dose_msv!, ts: d.ts })));
  const rate = daily.length ? daily.reduce((s, p) => s + p.value, 0) / daily.length : null;
  const share = total / limitMsv;
  const level: Level = share >= 1 ? "red" : share >= 0.75 ? "yellow" : "green";
  const days = share >= 1 ? 0 : rate && rate > 0 ? (limitMsv - total) / rate : null;
  const daysToLimit = days !== null && days <= HORIZON_DAYS ? round(days) : null;
  return {
    metric: "cumulative_radiation_msv", label: "Mission radiation dose", unit: "mSv", domain: "radiation", level,
    latest: round(total, 2), latest_ts: latest.ts, days_with_data: daily.length,
    slope_per_week: rate !== null ? round(rate * 7, 3) : null, direction: rate && rate > 0 ? "rising" : "steady",
    worsening: !!rate && rate > 0, r2: null, confidence: daily.length >= 14 ? "high" : daily.length >= 7 ? "medium" : "low",
    limit: limitMsv, days_to_limit: daysToLimit, days_to_limit_range: null,
    concern: round(Math.max(level === "red" ? 1 : level === "yellow" ? 0.5 : 0, daysToLimit === null ? 0 : Math.max(0, 1 - daysToLimit / 120)), 3),
  };
}

// Display string in the model service's format: "<5 days", "N days" (5-100), ">100 days".
export function displayDays(days: number | null) {
  if (days === null) return "Not enough data";
  if (days < 5) return "<5 days";
  if (days > 100) return ">100 days";
  return `${Math.round(days)} days`;
}

// Earliest of the risk-based estimate and every metric's projected limit decides the return date.
export function combineReturn(trends: MetricTrend[], riskMdtrDays: number | null, scheduledDaysLeft: number | null): ReturnForecast {
  const candidates: { days: number; driver: ReturnDriver; trend: MetricTrend | null }[] = [];
  if (riskMdtrDays !== null && trends.length) candidates.push({ days: riskMdtrDays, driver: "risk", trend: null });
  for (const t of trends) {
    // A metric already past its limit is an acute problem for the surgeon; its effect on return comes from risk.
    if (t.days_to_limit === null || t.days_to_limit === 0) continue;
    const driver: ReturnDriver = t.domain === "radiation" && t.metric === "cumulative_radiation_msv" ? "radiation_limit"
      : t.domain === "bone" ? "bone_limit" : "trend";
    candidates.push({ days: t.days_to_limit, driver, trend: t });
  }
  if (!candidates.length) {
    return { status: "insufficient_data", days: null, display: displayDays(null), driver: null, driver_metric: null, driver_label: null,
      interval_days: null, provisional: true, scheduled_days_left: scheduledDaysLeft };
  }
  const best = candidates.reduce((a, b) => (b.days < a.days ? b : a));
  return {
    status: "ok",
    days: round(best.days),
    display: displayDays(best.days),
    driver: best.driver,
    driver_metric: best.trend?.metric ?? null,
    driver_label: best.trend?.label ?? "Overall risk score",
    interval_days: best.trend?.days_to_limit_range ?? null,
    provisional: best.trend ? best.trend.confidence !== "high" : trends.every((t) => t.days_with_data < 7),
    scheduled_days_left: scheduledDaysLeft,
  };
}

// One-sentence reason a metric ranks as most concerning, from its numbers only.
function ruleReason(t: MetricTrend) {
  const rate = t.slope_per_week !== null && t.direction !== "steady"
    ? `${t.direction} about ${Math.abs(t.slope_per_week)} ${t.unit} per week` : "holding steady";
  const limit = t.days_to_limit === 0 ? "already past its red limit"
    : t.days_to_limit !== null ? `projected to reach its red limit in about ${Math.round(t.days_to_limit)} days` : `currently ${t.level}`;
  return `${t.label} is ${rate} and ${limit}.`;
}

// Plain-language fallback when the language model is unavailable.
function ruleText(forecast: ReturnForecast, top: MetricTrend | null) {
  if (forecast.status !== "ok") {
    return { headline: "Not enough readings for a forecast yet", explanation: "A forecast appears once a few days of readings have synced." };
  }
  const headline = `Projected return window: ${forecast.display}`;
  const driver = forecast.driver === "risk" ? "the overall risk score" : forecast.driver_label?.toLowerCase();
  return { headline, explanation: `The earliest limit comes from ${driver}.${top ? ` ${ruleReason(top)}` : ""}` };
}

const AI_SCHEMA = (metrics: string[]) => ({
  type: "object",
  properties: {
    most_concerning_metric: { type: "string", enum: metrics },
    reason: { type: "string" },
    headline: { type: "string" },
    explanation: { type: "string" },
  },
  required: ["most_concerning_metric", "reason", "headline", "explanation"],
  additionalProperties: false,
});

const AI_SYSTEM = `You review health trends for a long-duration space mission. The JSON facts were computed from sensor data.
Return JSON only:
- most_concerning_metric: the metric key (from the list given) that most threatens the astronaut's ability to stay on mission.
  Weigh a metric already red or yellow, a short days_to_limit, a worsening direction and higher confidence.
- reason: one sentence on why that metric is most concerning, using only numbers from the facts.
- headline: under 12 words stating the projected return window from return.display.
- explanation: 2-3 short plain sentences on the main trends. Neutral wording, no names, do not address anyone.
Never invent numbers, never diagnose, never give treatment advice. Say this is a projection for the flight surgeon to review.`;

// Asks Grok to rank the most concerning metric and explain; null when unavailable or invalid.
async function narrate(env: AiEnv, forecast: ReturnForecast, trends: MetricTrend[]) {
  if (!trends.length) return null;
  const ranked = trends.slice(0, 8);
  const facts = {
    return: forecast,
    metrics: ranked.map((t) => ({
      key: t.metric, label: t.label, latest: t.latest, unit: t.unit, level: t.level, direction: t.direction,
      change_per_week: t.slope_per_week, days_to_limit: t.days_to_limit, confidence: t.confidence,
    })),
  };
  const r = await grok(env, {
    messages: [{ role: "system", content: AI_SYSTEM }, { role: "user", content: JSON.stringify(facts) }],
    schema: { name: "return_forecast", schema: AI_SCHEMA(ranked.map((t) => t.metric)) },
    max_tokens: 400,
    temperature: 0.2,
  }, (t) => {
    const out = parseModelJson(t);
    const pick = ranked.find((m) => m.metric === out?.most_concerning_metric);
    if (!pick || typeof out.headline !== "string" || typeof out.explanation !== "string") return null;
    return {
      pick,
      reason: typeof out.reason === "string" ? out.reason.slice(0, 300) : ruleReason(pick),
      headline: out.headline.slice(0, 120),
      explanation: out.explanation.slice(0, 700),
    };
  }, "prediction narrative");
  return r ? { model: r.model, ...r.value } : null;
}

// Days-to-return from the custom model service, mapped onto the same forecast shape.
async function modelApiReturn(env: PredictionEnv, userId: string, fallback: ReturnForecast): Promise<ReturnForecast> {
  const floor = Number(env.LOGISTICS_FLOOR_DAYS ?? 3);
  const r = await callModelApi(env, "POST", "/v1/predict/risk", { user_id: await modelUserId(env, userId), logistics_floor_days: floor });
  const mdtr = r.out?.data?.mdtr;
  if (!r.ok || !mdtr || mdtr.status === "withheld" || typeof mdtr.value_days !== "number") throw new Error(`model api returned ${r.status}`);
  const low = mdtr.interval_days?.low, high = mdtr.interval_days?.high;
  return {
    ...fallback,
    status: "ok",
    days: mdtr.value_days,
    display: typeof mdtr.display === "string" ? mdtr.display : displayDays(mdtr.value_days),
    driver: mdtr.driver ?? null,
    driver_metric: null,
    driver_label: mdtr.driver === "trend" ? "Worsening trend" : mdtr.driver ?? null,
    interval_days: typeof low === "number" ? { low, high: typeof high === "number" ? high : null } : null,
    provisional: !!mdtr.provisional,
  };
}

export interface PredictionInputs {
  defs: Map<string, MetricDef>;
  observations: { metric: string; value: number; ts: string }[];
  doses: { ts: string; cumulative_msv: number | null; daily_dose_msv: number | null }[];
  radiationLimitMsv: number;
  riskMdtrDays: number | null;
  scheduledDaysLeft: number | null;
}

// Every metric's trend, sorted most concerning first.
export function buildTrends(inp: PredictionInputs): MetricTrend[] {
  const byMetric = new Map<string, { value: number; ts: string }[]>();
  for (const o of inp.observations) byMetric.set(o.metric, [...(byMetric.get(o.metric) ?? []), o]);
  const trends: MetricTrend[] = [];
  for (const [metric, rows] of byMetric) {
    const def = inp.defs.get(metric);
    const t = def ? analyzeMetric(def, rows) : null;
    if (t) trends.push(t);
  }
  const rad = radiationTrend(inp.doses, inp.radiationLimitMsv);
  if (rad) trends.push(rad);
  return trends.sort((a, b) => b.concern - a.concern || (a.days_to_limit ?? Infinity) - (b.days_to_limit ?? Infinity));
}

// Full forecast: trends, return window, most concerning metric and the explanation.
export async function predict(env: PredictionEnv, userId: string, inp: PredictionInputs): Promise<Prediction> {
  const trends = buildTrends(inp);
  let forecast = combineReturn(trends, inp.riskMdtrDays, inp.scheduledDaysLeft);
  let source: Prediction["source"] = "rules";
  let providerFallback: string | null = null;
  if (env.PREDICTION_PROVIDER === "model-api") {
    if (!modelsConfigured(env)) providerFallback = "Model service is not connected; using the Worker forecast.";
    else {
      try {
        forecast = await modelApiReturn(env, userId, forecast);
        source = "model-api";
      } catch (e) {
        console.log("model api forecast failed", String(e));
        providerFallback = "Model service did not return a forecast; using the Worker forecast.";
      }
    }
  }
  const ai = await narrate(env, forecast, trends);
  const top = ai?.pick ?? trends.find((t) => t.concern > 0) ?? null;
  const text = ai ?? ruleText(forecast, top);
  return {
    generated_at: new Date().toISOString(),
    source: source === "model-api" ? "model-api" : ai ? "ai" : "rules",
    model: ai?.model ?? null,
    provider_fallback: providerFallback,
    window_days: WINDOW_DAYS,
    return: forecast,
    most_concerning: top ? { metric: top.metric, label: top.label, level: top.level, reason: ai?.reason ?? ruleReason(top) } : null,
    headline: text.headline,
    explanation: text.explanation,
    trends,
    note: "Projection from recent readings for the flight surgeon to review. Not a diagnosis.",
  };
}
