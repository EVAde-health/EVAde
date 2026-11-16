// Next EVA window from the live NOAA Kp forecast.
// This is the same conservative rule as cloud/python/evade_space/space_weather.py.
// It is not Michael's trained SPE model (EVA-12). Callers must label it that way.

export interface EvaWindow {
  start: string;
  end: string;
  max_kp: number;
  status: "go" | "caution";
  source: "noaa-kp-rule";
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
