// Journal / voice check-in parser: turns what an astronaut wrote or said into rows for the EXISTING schema
// (self_reports + observations). No schema changes: every column used here already exists in migrations 0001-0007.
//
// Rules
// - Only values the crew member clearly stated are recorded. The model must quote the words it used, and a value
//   whose quote is not found in the crew member's own words (or whose number does not match the quote) is dropped.
// - Structured check-in values from the voice agent (save_checkin) override anything the model extracted.
// - Every value is range-checked; implausible values are dropped, never clamped.
// - Units are converted to the unit stored in metric_definitions (°C, mg/dL, hours, mmHg, bpm, %, 1-5).
// - If Workers AI is missing or fails, extraction falls back to the check-in values alone (possibly nothing).
import { FALLBACK_TEXT_MODEL, parseModelJson, TEXT_MODEL, type AiEnv } from "./ai";

export const RATINGS = ["mood", "stress", "fatigue", "sleep_quality"] as const;
export type Rating = (typeof RATINGS)[number];

/** Numeric metrics this parser can write, keyed by metric_definitions.metric, with the stored unit. */
export const VALUE_METRICS = {
  sleep_hours: "hours",
  systolic_bp: "mmHg",
  diastolic_bp: "mmHg",
  body_temp: "°C",
  blood_glucose: "mg/dL",
  heart_rate: "bpm",
  spo2: "%",
} as const;
export type ValueMetric = keyof typeof VALUE_METRICS;

/** Plausible ranges (inclusive) after unit conversion. Anything outside is dropped. */
const RANGES: Record<ValueMetric, [number, number]> = {
  sleep_hours: [0, 20],
  systolic_bp: [60, 250],
  diastolic_bp: [30, 150],
  body_temp: [33, 43],
  blood_glucose: [20, 600],
  heart_rate: [25, 220],
  spo2: [50, 100],
};

/** Shape of the voice agent's save_checkin arguments / saved check-in (worker/src/tools.ts). */
export interface CheckinIn {
  sleep_hours?: unknown;
  mood?: unknown;
  symptoms?: unknown;
  systolic?: unknown;
  diastolic?: unknown;
  temperature_c?: unknown;
  temperature?: unknown; // raw tool argument, Celsius or Fahrenheit
  blood_sugar_mg_dl?: unknown;
  notes?: unknown;
  level?: unknown;
  reasons?: unknown;
  actions?: unknown;
}

export type Origin = "checkin" | "ai";

export interface Extraction {
  ratings: Partial<Record<Rating, number>>;
  values: Partial<Record<ValueMetric, number>>;
  origin: Partial<Record<Rating | ValueMetric, Origin>>;
  symptoms: string[];
  note: string | null;
  checkin_level: "green" | "yellow" | "red" | null;
  reasons: string[];
  actions: string[];
  model: string | null; // model that produced the AI part, null when AI was not used or failed
  ai_ok: boolean;
}

// ---------- helpers ----------
const finite = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const inRange = (n: number | null, [lo, hi]: [number, number]) => (n !== null && n >= lo && n <= hi ? n : null);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const strList = (v: unknown, max = 10, len = 120): string[] =>
  Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).slice(0, max).map((s: string) => s.trim().slice(0, len)) : [];
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9.'/%° ]+/g, " ").replace(/\s+/g, " ").trim();

/** Celsius from a temperature with an optional unit. Unitless values are accepted only in unambiguous ranges. */
export function toCelsius(value: unknown, unit?: unknown): number | null {
  const n = finite(value);
  if (n === null) return null;
  const u = typeof unit === "string" ? unit.trim().toLowerCase().replace("°", "") : "";
  let c: number | null = null;
  if (u === "c" || u === "celsius") c = n;
  else if (u === "f" || u === "fahrenheit") c = ((n - 32) * 5) / 9;
  else if (n >= 33 && n <= 43) c = n; // clearly Celsius
  else if (n >= 91 && n <= 110) c = ((n - 32) * 5) / 9; // clearly Fahrenheit
  return inRange(c === null ? null : round(c, 1), RANGES.body_temp);
}

/** mg/dL from a blood sugar with an optional unit (mmol/L x 18.016). Unitless: >= 40 is mg/dL, <= 35 is mmol/L. */
export function toMgDl(value: unknown, unit?: unknown): number | null {
  const n = finite(value);
  if (n === null) return null;
  const u = typeof unit === "string" ? unit.trim().toLowerCase().replace(/\s/g, "") : "";
  let mg: number | null = null;
  if (u.startsWith("mmol")) mg = n * 18.016;
  else if (u.startsWith("mg")) mg = n;
  else if (n >= 40) mg = n;
  else if (n > 0 && n <= 35) mg = n * 18.016;
  return inRange(mg === null ? null : Math.round(mg), RANGES.blood_glucose);
}

/** Hours from a duration with an optional unit (minutes are converted). */
export function toHours(value: unknown, unit?: unknown): number | null {
  const n = finite(value);
  if (n === null) return null;
  const u = typeof unit === "string" ? unit.trim().toLowerCase() : "";
  const h = u.startsWith("min") ? n / 60 : n;
  return inRange(round(h, 2), RANGES.sleep_hours);
}

/** A 1-5 rating from a value on a stated scale (5 or 10). Other scales are dropped. */
export function toRating(value: unknown, scaleMax: unknown = 5): number | null {
  const n = finite(value);
  const s = finite(scaleMax) ?? 5;
  if (n === null) return null;
  if (s === 5) return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  if (s === 10) return n >= 1 && n <= 10 ? Math.round(1 + ((n - 1) * 4) / 9) : null;
  return null;
}

/** Numbers written with digits in a quote, e.g. "120 over 80" -> [120, 80]. */
const numbersIn = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * The quote must appear in the crew member's own words. If it contains digits, the stated number must be one of them
 * (spoken numbers such as "seven hours" are accepted on the quote match alone).
 */
export function supported(crewText: string, quote: unknown, stated?: number | null): boolean {
  if (typeof quote !== "string") return false;
  const q = norm(quote);
  if (q.length < 2 || !norm(crewText).includes(q)) return false;
  if (stated === undefined || stated === null) return true;
  const nums = numbersIn(q);
  return nums.length === 0 || nums.some((x) => Math.abs(x - stated) < 1e-6);
}

// Words that must appear around a value for it to count as that metric. Real model output showed why: it copied
// "92" from "Heart rate 92 at rest" into SpO2 too, and read "Felt connected" as mood 5.
const CONTEXT: Record<Rating | ValueMetric, RegExp> = {
  mood: /\b(mood|happy|sad|depress\w*|down|low|great|good|bad|terrible|awful|fantastic|miserable|cheer\w*|upset|lonely|fine|okay|ok|joy\w*|blue)\b/i,
  stress: /\b(stress\w*|anxi\w*|overwhelm\w*|tense|pressure|calm|relax\w*|worr\w*|nervous)\b/i,
  fatigue: /\b(tired\w*|exhaust\w*|fatigue\w*|drained|energ\w*|rested|sleepy|worn out|wiped)\b/i,
  sleep_quality: /\b(sleep\w*|slept|rest\w*|insomnia|woke)\b/i,
  sleep_hours: /\b(sleep\w*|slept|nap\w*|bed|hours?|hrs?)\b/i,
  systolic_bp: /\b(bp|blood pressure|pressure|over)\b|\d\s*\/\s*\d/i,
  diastolic_bp: /\b(bp|blood pressure|pressure|over)\b|\d\s*\/\s*\d/i,
  body_temp: /\b(temp\w*|fever\w*|degrees?|celsius|fahrenheit)\b|°|\d\s*[fc]\b/i,
  blood_glucose: /\b(sugar|glucose|mg\s*\/?\s*dl|mmol\w*)\b/i,
  heart_rate: /\b(heart\w*|pulse|bpm|hr|beats?)\b/i,
  spo2: /\b(sp\s?o2|oxygen|o2|sat|sats|saturation|pulse ?ox\w*)\b/i,
};

/**
 * The text around a quote: the line it is on plus the line before it (so "about seven" answering EVAde's
 * "How many hours did you sleep?" keeps its context). Null when the quote is not in the crew member's own lines.
 */
export function contextOf(text: string, quote: unknown): string | null {
  if (typeof quote !== "string" || norm(quote).length < 1) return null;
  const q = norm(quote);
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(evade|assistant|agent)\s*:/i.test(lines[i])) continue;
    if (norm(lines[i]).includes(q)) return `${i > 0 ? lines[i - 1] : ""}\n${lines[i]}`;
  }
  return null;
}

/** Explicit numeric ratings such as "stress is a 4 out of 5" or "mood 8/10" (the model sometimes skips them). */
export function explicitRatings(crewText: string): Partial<Record<Rating, number>> {
  const out: Partial<Record<Rating, number>> = {};
  const re = /\b(mood|stress(?:\s+level)?|fatigue|tiredness|sleep quality)\b[^.\d\n]{0,25}?(\d{1,2}(?:\.\d)?)\s*(?:\/|out of)\s*(5|10)\b/gi;
  for (const m of crewText.matchAll(re)) {
    const word = m[1].toLowerCase();
    const key: Rating = word.startsWith("mood") ? "mood" : word.startsWith("stress") ? "stress" : word.startsWith("sleep") ? "sleep_quality" : "fatigue";
    const v = toRating(Number(m[2]), Number(m[3]));
    if (v !== null && out[key] === undefined) out[key] = v;
  }
  return out;
}

/** The crew member's own words: drops lines spoken by the EVAde agent / assistant. */
export function crewWords(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(evade|assistant|agent)\s*:/i.test(line))
    .map((line) => line.replace(/^\s*(crew|me|user|astronaut)\s*:\s*/i, ""))
    .join("\n");
}

// ---------- check-in ----------
/** Validated values from the voice agent's structured check-in (these always win over AI values). */
export function fromCheckin(c: CheckinIn | null | undefined) {
  const ratings: Partial<Record<Rating, number>> = {};
  const values: Partial<Record<ValueMetric, number>> = {};
  if (!c || typeof c !== "object") return { ratings, values, symptoms: [] as string[], note: null as string | null, level: null, reasons: [] as string[], actions: [] as string[] };
  const mood = toRating(c.mood, 5);
  if (mood !== null) ratings.mood = mood;
  const sleep = toHours(c.sleep_hours);
  if (sleep !== null) values.sleep_hours = sleep;
  let sys = inRange(finite(c.systolic), RANGES.systolic_bp);
  let dia = inRange(finite(c.diastolic), RANGES.diastolic_bp);
  if (sys !== null && dia !== null && sys <= dia) sys = dia = null; // impossible pair: keep neither
  if (sys !== null) values.systolic_bp = Math.round(sys);
  if (dia !== null) values.diastolic_bp = Math.round(dia);
  const temp = c.temperature_c !== undefined && c.temperature_c !== null ? toCelsius(c.temperature_c, "c") : toCelsius(c.temperature);
  if (temp !== null) values.body_temp = temp;
  const sugar = toMgDl(c.blood_sugar_mg_dl, "mg/dl");
  if (sugar !== null) values.blood_glucose = sugar;
  const level = typeof c.level === "string" && ["green", "yellow", "red"].includes(c.level) ? (c.level as "green" | "yellow" | "red") : null;
  const note = typeof c.notes === "string" && c.notes.trim() ? c.notes.trim().slice(0, 1000) : null;
  return { ratings, values, symptoms: strList(c.symptoms, 10, 80), note, level, reasons: strList(c.reasons), actions: strList(c.actions) };
}

// ---------- AI ----------
const quoted = (extra: Record<string, unknown>) => ({ type: "object", properties: { ...extra, quote: { type: "string" } }, required: [...Object.keys(extra), "quote"] });
const SCHEMA = {
  type: "object",
  properties: {
    mood: quoted({ value: { type: "number" }, scale_max: { type: "number" } }),
    stress: quoted({ value: { type: "number" }, scale_max: { type: "number" } }),
    fatigue: quoted({ value: { type: "number" }, scale_max: { type: "number" } }),
    sleep_quality: quoted({ value: { type: "number" }, scale_max: { type: "number" } }),
    sleep_duration: quoted({ value: { type: "number" }, unit: { type: "string", enum: ["hours", "minutes"] } }),
    blood_pressure: quoted({ systolic: { type: "number" }, diastolic: { type: "number" } }),
    temperature: quoted({ value: { type: "number" }, unit: { type: "string", enum: ["C", "F", "unknown"] } }),
    blood_sugar: quoted({ value: { type: "number" }, unit: { type: "string", enum: ["mg/dL", "mmol/L", "unknown"] } }),
    heart_rate: quoted({ value: { type: "number" } }),
    spo2: quoted({ value: { type: "number" } }),
  },
};

const SYSTEM = `You extract health data that an astronaut explicitly stated in a journal entry or voice check-in transcript.
Return JSON only. Include a field ONLY when the astronaut clearly stated it; otherwise leave the field out entirely.
Never guess, infer from tone, estimate, or use defaults. Lines starting with "EVAde:" are the assistant: never take values
from them (a short answer such as "about seven" to EVAde's question counts as the astronaut's statement).
For every field, "quote" must be the astronaut's exact words (copied verbatim, at most 12 words) that state the value.
- mood, stress, fatigue, sleep_quality: a rating the astronaut gave or plainly described. value is the number on the
  stated scale, scale_max 5 or 10. For a plain description without a number use scale_max 5:
  mood 1 very low .. 5 very good; stress 1 none .. 5 extreme; fatigue 1 rested .. 5 exhausted; sleep_quality 1 terrible .. 5 great.
  Only use a description when it is about that exact dimension (for example "I'm exhausted" is fatigue, not mood).
- sleep_duration: how long they slept, in hours or minutes as stated.
- blood_pressure: systolic and diastolic as stated (for example "120 over 80").
- temperature: body temperature with unit C or F if stated, else unknown.
- blood_sugar: blood glucose with unit mg/dL or mmol/L if stated, else unknown.
- heart_rate: beats per minute. spo2: blood oxygen percent.`;

const runOpts = (env: AiEnv) => (env.AI_GATEWAY ? { gateway: { id: env.AI_GATEWAY } } : undefined);

/**
 * Validates raw model output against the text. A value is kept only when its quote is in the crew member's own
 * lines, any number in the quote matches, and the words around it name that metric. Exported for tests.
 */
export function validateAi(out: any, text: string) {
  const ratings: Partial<Record<Rating, number>> = {};
  const values: Partial<Record<ValueMetric, number>> = {};
  if (!out || typeof out !== "object") return { ratings, values };
  const crewText = crewWords(text);
  const field = (k: string) => (out[k] && typeof out[k] === "object" ? out[k] : null);
  const about = (f: any, metric: Rating | ValueMetric) => {
    const ctx = contextOf(text, f?.quote);
    return ctx !== null && CONTEXT[metric].test(ctx);
  };
  for (const r of RATINGS) {
    const f = field(r);
    if (!f) continue;
    const v = toRating(f.value, f.scale_max ?? 5);
    if (v !== null && supported(crewText, f.quote, finite(f.value)) && about(f, r)) ratings[r] = v;
  }
  const sd = field("sleep_duration");
  if (sd && supported(crewText, sd.quote, finite(sd.value)) && about(sd, "sleep_hours")) {
    const h = toHours(sd.value, sd.unit);
    if (h !== null) values.sleep_hours = h;
  }
  const bp = field("blood_pressure");
  if (bp) {
    const sys = inRange(finite(bp.systolic), RANGES.systolic_bp);
    const dia = inRange(finite(bp.diastolic), RANGES.diastolic_bp);
    if (sys !== null && dia !== null && sys > dia && supported(crewText, bp.quote, sys) && supported(crewText, bp.quote, dia) && about(bp, "systolic_bp")) {
      values.systolic_bp = Math.round(sys);
      values.diastolic_bp = Math.round(dia);
    }
  }
  const t = field("temperature");
  if (t && supported(crewText, t.quote, finite(t.value)) && about(t, "body_temp")) {
    const c = toCelsius(t.value, t.unit === "unknown" ? undefined : t.unit);
    if (c !== null) values.body_temp = c;
  }
  const g = field("blood_sugar");
  if (g && supported(crewText, g.quote, finite(g.value)) && about(g, "blood_glucose")) {
    const mg = toMgDl(g.value, g.unit === "unknown" ? undefined : g.unit);
    if (mg !== null) values.blood_glucose = mg;
  }
  for (const [k, metric] of [["heart_rate", "heart_rate"], ["spo2", "spo2"]] as const) {
    const f = field(k);
    const v = f ? inRange(finite(f.value), RANGES[metric]) : null;
    if (v !== null && supported(crewText, f.quote, v) && about(f, metric)) values[metric] = Math.round(v);
  }
  return { ratings, values };
}

/** Runs Workers AI with a strict JSON schema; null when AI is unavailable or every model failed. */
async function aiExtract(env: AiEnv, text: string): Promise<{ out: any; model: string } | null> {
  if (!env.AI || !text.trim()) return null;
  const input = {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text.slice(0, 6000) }],
    response_format: { type: "json_schema", json_schema: SCHEMA },
    max_tokens: 500,
    temperature: 0,
  };
  for (const model of [TEXT_MODEL, FALLBACK_TEXT_MODEL]) {
    try {
      const out = parseModelJson(await env.AI.run(model as any, input as any, runOpts(env)));
      if (out && typeof out === "object") return { out, model };
    } catch (e) {
      console.log("journal extraction failed on", model, String(e));
    }
  }
  return null;
}

/**
 * Extracts ratings and stated values from a transcript or typed entry, merged with the voice agent's check-in.
 * Never throws: AI problems fall back to check-in values only.
 */
export async function extractHealth(env: AiEnv, text: string, checkin?: CheckinIn | null): Promise<Extraction> {
  const c = fromCheckin(checkin);
  const result: Extraction = {
    ratings: {}, values: {}, origin: {}, symptoms: c.symptoms, note: c.note, checkin_level: c.level,
    reasons: c.reasons, actions: c.actions, model: null, ai_ok: false,
  };
  let ai: ReturnType<typeof validateAi> = { ratings: {}, values: {} };
  try {
    const r = await aiExtract(env, text);
    if (r) {
      ai = validateAi(r.out, text);
      // Explicit "X out of 5 / X/10" ratings the model skipped (seen with real output: "Stress is a 4 out of 5").
      for (const [k, v] of Object.entries(explicitRatings(crewWords(text)))) if (ai.ratings[k as Rating] === undefined) ai.ratings[k as Rating] = v;
      result.model = r.model;
      result.ai_ok = true;
    }
  } catch (e) {
    console.log("journal extraction failed", String(e));
  }
  for (const [k, v] of Object.entries(ai.ratings)) { result.ratings[k as Rating] = v; result.origin[k as Rating] = "ai"; }
  for (const [k, v] of Object.entries(ai.values)) { result.values[k as ValueMetric] = v; result.origin[k as ValueMetric] = "ai"; }
  // The agent's structured check-in wins. A check-in blood pressure replaces both AI numbers as a pair.
  if (c.values.systolic_bp !== undefined || c.values.diastolic_bp !== undefined) {
    delete result.values.systolic_bp; delete result.values.diastolic_bp;
    delete result.origin.systolic_bp; delete result.origin.diastolic_bp;
  }
  for (const [k, v] of Object.entries(c.ratings)) { result.ratings[k as Rating] = v; result.origin[k as Rating] = "checkin"; }
  for (const [k, v] of Object.entries(c.values)) { result.values[k as ValueMetric] = v; result.origin[k as ValueMetric] = "checkin"; }
  return result;
}

// ---------- rows for the existing tables ----------
export interface SelfReportRow {
  client_id: string; ts: string; mood: number | null; stress: number | null; fatigue: number | null; sleep_quality: number | null;
  note: string | null; source: "app" | "voice_web"; sleep_hours: number | null; symptoms: string | null;
  checkin_level: string | null; reasons: string | null; actions: string | null; call_ref: string | null;
}
export interface ObservationRow {
  client_id: string; metric: "mood" | "stress" | ValueMetric; value: number; unit: string; ts: string;
  source: "manual" | "model"; device: string;
}

/**
 * Rows to write for one journal entry. client_ids derive from `base` (the journal entry's client_id), so writing the
 * same entry twice inserts nothing new. Check-in values are self-reported ('manual', device voice_agent); values the
 * model read out of free text are stored as source 'model' (device journal_parser) so they stay distinguishable and
 * do not close measurement tasks or pay points on their own.
 */
export function rowsFor(x: Extraction, base: string, ts: string, kind: "text" | "voice", callRef: string | null = null) {
  const r = x.ratings;
  const hasReport = RATINGS.some((k) => r[k] !== undefined) || x.values.sleep_hours !== undefined || x.symptoms.length > 0 || x.checkin_level !== null;
  const selfReport: SelfReportRow | null = hasReport ? {
    client_id: `${base}:sr`, ts,
    mood: r.mood ?? null, stress: r.stress ?? null, fatigue: r.fatigue ?? null, sleep_quality: r.sleep_quality ?? null,
    note: x.note, source: kind === "voice" ? "voice_web" : "app", sleep_hours: x.values.sleep_hours ?? null,
    symptoms: x.symptoms.length ? JSON.stringify(x.symptoms) : null, checkin_level: x.checkin_level,
    reasons: x.reasons.length ? JSON.stringify(x.reasons) : null, actions: x.actions.length ? JSON.stringify(x.actions) : null,
    call_ref: callRef,
  } : null;
  const observations: ObservationRow[] = [];
  const add = (metric: ObservationRow["metric"], value: number, unit: string, origin: Origin | undefined) =>
    observations.push({
      client_id: `${base}:${metric}`, metric, value, unit, ts,
      source: origin === "checkin" ? "manual" : "model", device: origin === "checkin" ? "voice_agent" : "journal_parser",
    });
  if (r.mood !== undefined) add("mood", r.mood, "1-5", x.origin.mood);
  if (r.stress !== undefined) add("stress", r.stress, "1-5", x.origin.stress);
  for (const metric of Object.keys(VALUE_METRICS) as ValueMetric[]) {
    const v = x.values[metric];
    if (v !== undefined) add(metric, v, VALUE_METRICS[metric], x.origin[metric]);
  }
  return { selfReport, observations };
}

/** Deterministic UUID-formatted id (SHA-256 of a name), so re-posting a voice session reuses the same message ids. */
export async function stableId(name: string) {
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
