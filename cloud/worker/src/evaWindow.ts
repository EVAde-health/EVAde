// Next EVA window: the NOAA Kp forecast gives candidate blocks (the same conservative rule as
// cloud/python/evade_space/space_weather.py), and Michael's EVA-12 P(solar particle event within 24 h) then decides
// whether blocks in the next 24 h stay go, drop to caution, or are pushed past the 24 h horizon.

export interface EvaWindow {
  start: string;
  end: string;
  max_kp: number;
  status: "go" | "caution";
  source: "noaa-kp-rule";
  reason?: string;
}

/** Our own key for the model service's pseudonymous user that runs the crew-wide EVA-12 forecast. */
export const EVA_WINDOW_MODEL_USER = "eva-window-service";

/** EVAde's decision thresholds on EVA-12 (not Michael's): the long-run base rate is about 1-2% per day. */
export const SPE_CAUTION_P = 0.05;
export const SPE_NO_GO_P = 0.2;
const DAY_MS = 86_400_000;

/** Applies EVA-12's probability to the Kp blocks. With no probability, the Kp blocks stand and the decision says so. */
export function planEvaWindows(windows: EvaWindow[], pOnset: number | null, now = new Date()) {
  const horizon = now.getTime() + DAY_MS;
  let decision: string;
  let planned: EvaWindow[] = windows;
  if (pOnset == null) {
    decision = "EVA-12 did not return a probability, so these blocks use the NOAA Kp forecast alone.";
  } else if (pOnset >= SPE_NO_GO_P) {
    decision = `EVA-12 gives ${(pOnset * 100).toFixed(1)}% for a solar particle event in 24 h (no-go at ${SPE_NO_GO_P * 100}%), so nothing starts before ${new Date(horizon).toISOString().slice(0, 16)}Z.`;
    planned = windows.flatMap((w) => {
      const end = Date.parse(w.end);
      if (end <= horizon) return [];
      const start = Math.max(Date.parse(w.start), horizon);
      if (end - start < 6 * 3_600_000) return [];
      return [{ ...w, start: new Date(start).toISOString().slice(0, 16) + "Z", reason: "Starts after EVA-12's 24 h risk horizon." }];
    });
  } else if (pOnset >= SPE_CAUTION_P) {
    decision = `EVA-12 gives ${(pOnset * 100).toFixed(1)}% for a solar particle event in 24 h (caution at ${SPE_CAUTION_P * 100}%), so blocks starting in the next 24 h are caution.`;
    planned = windows.map((w) => Date.parse(w.start) < horizon
      ? { ...w, status: "caution" as const, reason: "Elevated EVA-12 solar particle event risk in the next 24 h." } : w);
  } else {
    decision = `EVA-12 gives ${(pOnset * 100).toFixed(1)}% for a solar particle event in 24 h, under the ${SPE_CAUTION_P * 100}% caution line, so the Kp blocks stand.`;
  }
  const recommended = planned.find((w) => w.status === "go") ?? planned[0] ?? null;
  return { windows: planned, recommended, decision };
}

export interface ForecastPoint {
  time: string;
  kp: number;
}

const ISO = (d: Date) => d.toISOString().slice(0, 16) + "Z";

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** SWPC "products" feeds are a header row plus lists, or a list of objects. */
export function parseForecast(data: unknown): ForecastPoint[] {
  if (!Array.isArray(data) || !data.length) return [];
  const rows = Array.isArray(data[0])
    ? (() => {
      const header = (data[0] as unknown[]).map((h) => String(h).toLowerCase());
      return (data as unknown[][]).slice(1).map((row) => Object.fromEntries(header.map((h, i) => [h, row[i]])));
    })()
    : (data as Record<string, unknown>[]);
  const out: ForecastPoint[] = [];
  for (const row of rows) {
    const raw = row.time_tag ?? row.time ?? row.date;
    const kp = num(row.kp ?? row.kp_index ?? row.estimated_kp);
    if (raw == null || kp === null) continue;
    let time = String(raw).replace(" ", "T");
    if (!time.endsWith("Z") && !time.includes("+")) time = time.split(".")[0] + "Z";
    out.push({ time, kp });
  }
  return out;
}

/** Contiguous forecast blocks with Kp under 5, at least `minHours` long. A radiation storm (protons >= 10 pfu) yields none. */
export function evaWindows(
  points: ForecastPoint[],
  opts: { protonPfu?: number | null; minHours?: number; now?: Date } = {},
): EvaWindow[] {
  const now = opts.now ?? new Date();
  const minHours = opts.minHours ?? 6;
  if (opts.protonPfu != null && opts.protonPfu >= 10) return [];
  const rows = points
    .map((p) => ({ start: new Date(p.time), kp: p.kp }))
    .filter((p) => !Number.isNaN(p.start.getTime()) && p.start.getTime() + 3 * 3_600_000 > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const windows: EvaWindow[] = [];
  let cur: { start: Date; kp: number }[] = [];
  const flush = () => {
    if (cur.length * 3 >= minHours) {
      const maxKp = Math.max(...cur.map((p) => p.kp));
      const end = new Date(cur[cur.length - 1].start.getTime() + 3 * 3_600_000);
      windows.push({
        start: ISO(cur[0].start),
        end: ISO(end),
        max_kp: Math.round(maxKp * 100) / 100,
        status: maxKp < 4 ? "go" : "caution",
        source: "noaa-kp-rule",
      });
    }
    cur = [];
  };
  for (const row of rows) {
    if (row.kp < 5) cur.push(row);
    else flush();
  }
  flush();
  return windows;
}
