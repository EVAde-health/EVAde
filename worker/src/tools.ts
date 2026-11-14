/**
 * Adapter between the voice agent and EVAde's health logic + storage.
 * Port of api/voice_tools.py: the function-tool schemas Grok sees and the code that
 * runs when it calls them. SQLite (data/evade.db) is replaced by Cloudflare D1.
 *
 * STAND-IN: keep the return shapes (the agent reads them aloud) if the team's real
 * check-in store and downlink queue replace these.
 */
import { envStr, isoNow, type EnvLike } from "./config";
import { assess, normaliseTemperatureC } from "./rules";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type ToolResult = Record<string, unknown>;
type Args = Record<string, unknown>;

export interface ToolContext {
  db: D1Database;
  env: EnvLike;
  now?: () => Date;
}

/** mode: [status on insert, one-way delay in seconds or null] */
export const COMMS_MODES: Record<string, [string, number | null]> = {
  online: ["sent", 0], // ISS: near real-time link
  mars: ["in_transit", 20 * 60], // Mars: ~20-min one-way delay (3-22 min range)
  blackout: ["queued", null], // conjunction / LOS: hold until link returns
};

const FLOAT_RE = /^[+-]?(\d+(_?\d+)*\.?(\d+(_?\d+)*)?|\.\d+(_?\d+)*)([eE][+-]?\d+)?$/;
const INT_RE = /^[+-]?\d+(_?\d+)*$/;

/** Port of _num(value, cast): None/"" -> null, bad values -> null. */
export function num(value: unknown, cast: "float" | "int" = "float"): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return cast === "int" ? null : value;
    return cast === "int" ? Math.trunc(value) : value;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (cast === "int") return INT_RE.test(s) ? parseInt(s.replace(/_/g, ""), 10) : null;
    return FLOAT_RE.test(s) ? Number(s.replace(/_/g, "")) : null;
  }
  return null;
}

/** Personal baseline = average of the last 7 check-ins (needs at least 3). */
async function baselines(db: D1Database, crewId: string): Promise<[number | null, number | null]> {
  const { results } = await db
    .prepare("SELECT sleep_hours, mood FROM checkins WHERE crew_id = ? ORDER BY id DESC LIMIT 7")
    .bind(crewId)
    .all<{ sleep_hours: number | null; mood: number | null }>();
  const sleeps = results.map((r) => r.sleep_hours).filter((v): v is number => v !== null);
  const moods = results.map((r) => r.mood).filter((v): v is number => v !== null);
  const avg = (xs: number[]) => (xs.length >= 3 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return [avg(sleeps), avg(moods)];
}

function toList(symptoms: unknown): string[] {
  if (symptoms === null || symptoms === undefined || symptoms === "" || symptoms === false) return [];
  if (typeof symptoms === "string") return symptoms.split(",").map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(symptoms)) return symptoms.map((s) => (typeof s === "string" ? s : String(s ?? "")));
  // Python's list(<int>) raises TypeError, which run_tool turns into an error result.
  throw new TypeError(`'${typeof symptoms}' object is not iterable`);
}

/** Store a spoken check-in and return a green/yellow/red assessment. */
export async function saveCheckin(ctx: ToolContext, crewId: string, args: Args): Promise<ToolResult> {
  const symptoms = toList(args.symptoms);
  let mood = num(args.mood, "int");
  if (mood !== null) mood = Math.max(1, Math.min(5, mood));
  const values = {
    sleep_hours: num(args.sleep_hours),
    mood,
    symptoms,
    systolic: num(args.systolic, "int"),
    diastolic: num(args.diastolic, "int"),
    temperature_c: normaliseTemperatureC(num(args.temperature)),
    blood_sugar_mg_dl: num(args.blood_sugar_mg_dl),
  };
  const [baseSleep, baseMood] = await baselines(ctx.db, crewId);
  const result = assess({ ...values, baseline_sleep: baseSleep, baseline_mood: baseMood });
  const notes = args.notes === undefined || args.notes === null ? null : String(args.notes);
  const row = await ctx.db
    .prepare(
      `INSERT INTO checkins (created_at, crew_id, source, sleep_hours, mood, symptoms,
       systolic, diastolic, temperature_c, blood_sugar_mg_dl, notes, level, reasons, actions)
       VALUES (?, ?, 'voice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(isoNow(ctx.now?.()), crewId, values.sleep_hours, values.mood, JSON.stringify(values.symptoms),
      values.systolic, values.diastolic, values.temperature_c, values.blood_sugar_mg_dl, notes,
      result.level, JSON.stringify(result.reasons), JSON.stringify(result.actions))
    .first<{ id: number }>();
  return {
    checkin_id: row?.id ?? null,
    level: result.level,
    reasons: result.reasons,
    actions: result.actions,
    reminder: "Decision support only, not a medical device.",
  };
}

const SPOKEN: Record<string, string> = {
  online: "Sent to the flight surgeon now.",
  mars: "Transmitting; it will reach Earth in about 20 minutes.",
  blackout: "Comms are down, so it is queued and will send when the link is back.",
};

/** Add a message to the flight-surgeon downlink queue. */
export async function queueFlightSurgeonMessage(ctx: ToolContext, crewId: string, args: Args): Promise<ToolResult> {
  let mode = String(args.comms_mode || envStr(ctx.env, "EVADE_COMMS_MODE") || "online").toLowerCase();
  if (!(mode in COMMS_MODES)) mode = "online";
  let priority = String(args.priority || "routine").toLowerCase();
  if (priority !== "routine" && priority !== "urgent") priority = "routine";
  const message = String(args.message || "").trim() || "Crew member requested contact.";
  const [status, delay] = COMMS_MODES[mode];
  const now = ctx.now?.() ?? new Date();
  const arrivesAt = delay !== null ? isoNow(new Date(now.getTime() + delay * 1000)) : null;
  const row = await ctx.db
    .prepare(
      `INSERT INTO downlink_queue (created_at, crew_id, priority, message, checkin_id,
       comms_mode, status, arrives_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(isoNow(now), crewId, priority, message, num(args.checkin_id, "int"), mode, status, arrivesAt)
    .first<{ id: number }>();
  return { queue_id: row?.id ?? null, comms_mode: mode, status, arrives_at: arrivesAt, summary: SPOKEN[mode] };
}

// ---------------------------------------------------------------- tool schemas
export const TOOLS = [
  {
    type: "function",
    name: "save_checkin",
    description:
      "Save the crew member's daily health check-in and get an assessment " +
      "(green/yellow/red) with reasons and recommended actions. Call this once " +
      "you have at least sleep hours and mood; include anything else they told you.",
    parameters: {
      type: "object",
      properties: {
        sleep_hours: { type: "number", description: "Hours slept last sleep period" },
        mood: { type: "integer", description: "Mood from 1 (very low) to 5 (very good)" },
        symptoms: { type: "array", items: { type: "string" },
                    description: "Symptoms in their own words; empty list if none" },
        systolic: { type: "integer", description: "Systolic blood pressure (top number), mmHg" },
        diastolic: { type: "integer", description: "Diastolic blood pressure (bottom number), mmHg" },
        temperature: { type: "number", description: "Body temperature, Celsius or Fahrenheit" },
        blood_sugar_mg_dl: { type: "number", description: "Blood sugar in mg/dL" },
        notes: { type: "string", description: "Anything else worth recording" },
      },
      required: ["sleep_hours", "mood"],
    },
  },
  {
    type: "function",
    name: "queue_flight_surgeon_message",
    description:
      "Send a message to the flight surgeon through the downlink queue. Use it when the " +
      "assessment is red, or whenever the crew member asks to contact the flight surgeon.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Short summary for the flight surgeon" },
        priority: { type: "string", enum: ["routine", "urgent"] },
        checkin_id: { type: "integer", description: "checkin_id from save_checkin, if any" },
        comms_mode: { type: "string", enum: ["online", "mars", "blackout"],
                      description: "Leave out to use the current mission setting" },
      },
      required: ["message", "priority"],
    },
  },
] as const;

export const HANDLERS: Record<string, (ctx: ToolContext, crewId: string, args: Args) => Promise<ToolResult>> = {
  save_checkin: saveCheckin,
  queue_flight_surgeon_message: queueFlightSurgeonMessage,
};

/** Execute a tool call from the model. Never throws: errors go back to the model. */
export async function runTool(ctx: ToolContext, name: string, crewId: string, args: unknown): Promise<ToolResult> {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, name) ? HANDLERS[name] : undefined;
  if (!handler) return { error: `Unknown tool: ${name}` };
  let parsed: Args;
  try {
    const raw = typeof args === "string" ? JSON.parse(args) : { ...((args as Args) ?? {}) };
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("arguments must be an object");
    parsed = raw as Args;
  } catch (e) {
    if (e instanceof SyntaxError) return { error: "Arguments were not valid JSON." };
    return { error: `${(e as Error).name}: ${(e as Error).message}` };
  }
  try {
    return await handler(ctx, crewId, parsed);
  } catch (e) {
    const err = e as Error;
    return { error: `${err?.name ?? "Error"}: ${err?.message ?? String(e)}` };
  }
}

// ------------------------------------------------------------ read helpers
type Row = Record<string, unknown>;

/** Most recent check-in (optionally for one crew member), or null. */
export async function latestCheckin(db: D1Database, crewId?: string | null): Promise<Row | null> {
  let sql = "SELECT * FROM checkins";
  const params: unknown[] = [];
  if (crewId) { sql += " WHERE crew_id = ?"; params.push(crewId); }
  const row = await db.prepare(sql + " ORDER BY id DESC LIMIT 1").bind(...params).first<Row>();
  if (!row) return null;
  for (const key of ["symptoms", "reasons", "actions"]) {
    const v = row[key];
    row[key] = typeof v === "string" && v ? JSON.parse(v) : [];
  }
  return row;
}

/** Newest flight-surgeon downlink messages first. */
export async function listDownlink(db: D1Database, limit = 10, crewId?: string | null): Promise<Row[]> {
  const lim = Math.max(1, Math.min(Math.trunc(limit), 100));
  let sql = "SELECT * FROM downlink_queue";
  const params: unknown[] = [];
  if (crewId) { sql += " WHERE crew_id = ?"; params.push(crewId); }
  params.push(lim);
  const { results } = await db.prepare(sql + " ORDER BY id DESC LIMIT ?").bind(...params).all<Row>();
  return results;
}
