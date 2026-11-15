// Journal / voice-session parser tests: extraction rules (pure), and the real Worker fetch handler against a D1 built
// from the migrations (node:sqlite) with a fake Workers AI binding. No schema changes are involved.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../src/index");
const P = await import("../src/journalParse");

const API = "https://api.evade.health";
const FRONTEND = "https://evade.health";
const ASTRONAUT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

// ---------- fakes ----------
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  // 0008 deletes the seeded demo astronaut. Keep the file, but do not apply it.
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "0008_remove_demo_data.sql").sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const reads = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  const stmt = (sql: string, args: unknown[] = []): any => ({
    execute: () => reads(sql)
      ? { success: true, results: db.prepare(sql).all(...(args as any[])), meta: {} }
      : { success: true, results: [], meta: db.prepare(sql).run(...(args as any[])) },
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async () => (db.prepare(sql).get(...(args as any[])) as any) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    run: async () => ({ success: true, meta: db.prepare(sql).run(...(args as any[])) }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: any[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    raw: db,
  };
}

function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string, type?: string) => {
      const v = store.get(k);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  };
}

const sha256 = async (s: string) =>
  btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Fake Workers AI: the parser prompt gets `extraction`, the journal analysis prompt gets `analysis`.
let extraction: any;
let analysis: any;
let aiFails: boolean;
let aiCalls: number;
const AI = {
  run: async (_model: string, input: any) => {
    aiCalls++;
    if (aiFails) throw new Error("AI down");
    const system = String(input?.messages?.[0]?.content ?? "");
    return { response: system.startsWith("You extract health data") ? extraction : analysis };
  },
};

let env: any;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

beforeEach(async () => {
  extraction = {};
  analysis = { summary: "A calm day.", sentiment: 0.4, mood_label: "calm", concern_level: "none", needs_human_review: false, themes: ["sleep"] };
  aiFails = false;
  aiCalls = 0;
  env = { DB: fakeD1(), SESSIONS: fakeKV(), AI, AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) }, ALLOWED_ORIGINS: FRONTEND };
  const raw: DatabaseSync = env.DB.raw;
  const add = raw.prepare("INSERT INTO users (user_id, display_name, role, mission_start) VALUES (?,?,?,?)");
  add.run(ASTRONAUT, "Cmdr. Test", "astronaut", "2026-11-01T00:00:00Z");
  add.run(OTHER, "Spc. Other", "astronaut", "2026-11-01T00:00:00Z");
  for (const [token, user_id] of [["astro", ASTRONAUT], ["other", OTHER]]) {
    await env.SESSIONS.put(`sess:${await sha256(token)}`, JSON.stringify({ user_id, role: "astronaut", email: null, provider: "cloudflare_access" }));
  }
  vi.stubGlobal("fetch", async () => { throw new Error("unexpected fetch"); });
});
afterEach(() => {
  env.DB.raw.close();
  vi.unstubAllGlobals();
});

async function call(method: string, path: string, { token = "astro", body }: { token?: string | null; body?: unknown } = {}) {
  const headers = new Headers({ Origin: FRONTEND });
  if (token) headers.set("Cookie", `__Host-evade_session=${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await worker.fetch(new Request(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}
const rows = (sql: string, ...args: any[]) => (env.DB.raw as DatabaseSync).prepare(sql).all(...args) as any[];
const count = (table: string) => (rows(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, ASTRONAUT)[0].n as number);

const TURNS = [
  { sender: "assistant", content: "Good morning. How many hours did you sleep?", ts: "2026-11-15T06:00:00.000Z" },
  { sender: "user", content: "About seven hours, but I feel pretty stressed about the EVA.", ts: "2026-11-15T06:00:05.000Z" },
  { sender: "assistant", content: "Normal temperature is 36 to 37 C. Did you take yours?", ts: "2026-11-15T06:00:10.000Z" },
  { sender: "user", content: "Yes, it was 37.2 and my heart rate is 64.", ts: "2026-11-15T06:00:15.000Z" },
];
const CHECKIN = { sleep_hours: 6.5, mood: 3, symptoms: ["headache"], systolic: 118, diastolic: 76, temperature_c: null, blood_sugar_mg_dl: null, notes: "EVA tomorrow", level: "yellow", reasons: ["sleep under 7 hours"], actions: ["protect tonight's sleep"] };

// ---------- extraction rules ----------
describe("extraction rules", () => {
  it("converts units to what metric_definitions stores", () => {
    expect(P.toCelsius(98.6, "F")).toBe(37);
    expect(P.toCelsius(37.2)).toBe(37.2);
    expect(P.toCelsius(70)).toBeNull(); // neither a plausible C nor F body temperature
    expect(P.toMgDl(5.5, "mmol/L")).toBe(99);
    expect(P.toMgDl(110)).toBe(110);
    expect(P.toHours(450, "minutes")).toBe(7.5);
    expect(P.toRating(8, 10)).toBe(4);
    expect(P.toRating(4.5, 5)).toBeNull();
    expect(P.toRating(7, 5)).toBeNull();
  });

  it("drops values the crew member did not state, or that the agent said", () => {
    const crew = P.crewWords("EVAde: Normal temperature is 36 to 37 C.\nMe: I slept 6 hours and feel exhausted.");
    const out = P.validateAi({
      temperature: { value: 37, unit: "C", quote: "Normal temperature is 36 to 37 C" }, // assistant line
      sleep_duration: { value: 8, unit: "hours", quote: "I slept 6 hours" }, // number does not match the quote
      fatigue: { value: 5, scale_max: 5, quote: "feel exhausted" },
      mood: { value: 2, scale_max: 5, quote: "I feel sad" }, // not in the text
      heart_rate: { value: 400, quote: "slept 6 hours" },
    }, crew);
    expect(out.values).toEqual({});
    expect(out.ratings).toEqual({ fatigue: 5 });
  });

  it("keeps blood pressure only as a plausible pair", () => {
    expect(P.validateAi({ blood_pressure: { systolic: 120, diastolic: 80, quote: "BP was 120 over 80" } }, "my BP was 120 over 80").values)
      .toEqual({ systolic_bp: 120, diastolic_bp: 80 });
    expect(P.validateAi({ blood_pressure: { systolic: 80, diastolic: 120, quote: "120 over 80" } }, "120 over 80").values).toEqual({});
  });

  it("lets the agent's check-in override AI values", async () => {
    extraction = {
      mood: { value: 5, scale_max: 5, quote: "feeling great" },
      sleep_duration: { value: 9, unit: "hours", quote: "slept 9 hours" },
      blood_pressure: { systolic: 130, diastolic: 85, quote: "130 over 85" },
      stress: { value: 2, scale_max: 5, quote: "not stressed" },
    };
    const x = await P.extractHealth({ AI } as any, "Me: feeling great, slept 9 hours, 130 over 85, not stressed", CHECKIN);
    expect(x.ratings).toEqual({ mood: 3, stress: 2 });
    expect(x.values).toEqual({ sleep_hours: 6.5, systolic_bp: 118, diastolic_bp: 76 });
    expect(x.origin).toMatchObject({ mood: "checkin", stress: "ai", sleep_hours: "checkin", systolic_bp: "checkin" });
    const { selfReport, observations } = P.rowsFor(x, "voice:u:s1", "2026-11-15T06:00:00.000Z", "voice", "s1");
    expect(selfReport).toMatchObject({ client_id: "voice:u:s1:sr", mood: 3, stress: 2, sleep_hours: 6.5, source: "voice_web", checkin_level: "yellow", call_ref: "s1" });
    expect(observations.find((o) => o.metric === "stress")).toMatchObject({ source: "model", device: "journal_parser", client_id: "voice:u:s1:stress" });
    expect(observations.find((o) => o.metric === "mood")).toMatchObject({ source: "manual", device: "voice_agent" });
  });

  it("drops implausible check-in values instead of clamping them", () => {
    const c = P.fromCheckin({ sleep_hours: 30, mood: 9, systolic: 70, diastolic: 90, temperature: 101.3, blood_sugar_mg_dl: 5000 });
    expect(c.ratings).toEqual({});
    expect(c.values).toEqual({ body_temp: 38.5 });
  });

  it("falls back to the check-in when AI is missing or fails", async () => {
    aiFails = true;
    const failed = await P.extractHealth({ AI } as any, "Me: slept 9 hours", { mood: 4 });
    expect(failed).toMatchObject({ ai_ok: false, model: null, ratings: { mood: 4 }, values: {} });
    const none = await P.extractHealth({} as any, "Me: slept 9 hours", null);
    expect(none.ratings).toEqual({});
    expect(P.rowsFor(none, "b", "2026-11-15T00:00:00.000Z", "text").selfReport).toBeNull();
  });

  it("makes stable UUID-shaped ids", async () => {
    const a = await P.stableId("voice:u:s:turn:0");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await P.stableId("voice:u:s:turn:0")).toBe(a);
    expect(await P.stableId("voice:u:s:turn:1")).not.toBe(a);
  });
});

// ---------- POST /journal/voice-sessions ----------
describe("POST /journal/voice-sessions", () => {
  beforeEach(() => {
    extraction = {
      stress: { value: 4, scale_max: 5, quote: "I feel pretty stressed" },
      sleep_duration: { value: 7, unit: "hours", quote: "About seven hours" },
      temperature: { value: 37.2, unit: "unknown", quote: "it was 37.2" },
      heart_rate: { value: 64, quote: "my heart rate is 64" },
    };
  });

  it("writes the entry, turns, self-report and observations, and is idempotent", async () => {
    const first = await call("POST", "/journal/voice-sessions", { body: { session_id: "sess-1", turns: TURNS, checkin: CHECKIN } });
    expect(first.status).toBe(201);
    expect(first.data.duplicate).toBe(false);
    expect(first.data.messages).toHaveLength(4);
    expect(first.data.reply.content).toContain("A calm day.");
    expect(first.data.extracted.ai).toBe(true);

    const [entry] = rows("SELECT * FROM journal_entries WHERE user_id=?", ASTRONAUT);
    expect(entry).toMatchObject({ client_id: `voice:${ASTRONAUT}:sess-1`, source: "voice", ts: "2026-11-15T06:00:00.000Z", mood_label: "calm", concern_level: "none" });
    expect(entry.content).toContain("Me: About seven hours");
    expect(entry.content).toContain("EVAde: Good morning.");

    const msgs = rows("SELECT sender, content, entry_id, thread_id FROM journal_messages WHERE user_id=? ORDER BY ts", ASTRONAUT);
    expect(msgs.map((m) => m.sender)).toEqual(["assistant", "user", "assistant", "user", "assistant"]);
    expect(msgs.every((m) => m.entry_id === entry.id && m.thread_id === null)).toBe(true);

    const [sr] = rows("SELECT * FROM self_reports WHERE user_id=?", ASTRONAUT);
    expect(sr).toMatchObject({ mood: 3, stress: 4, fatigue: null, sleep_hours: 6.5, source: "voice_web", call_ref: "sess-1", checkin_level: "yellow", note: "EVA tomorrow" });
    expect(JSON.parse(sr.symptoms)).toEqual(["headache"]);

    const obs = Object.fromEntries(rows("SELECT metric, value, unit, source, device FROM observations WHERE user_id=?", ASTRONAUT).map((o) => [o.metric, o]));
    expect(Object.keys(obs).sort()).toEqual(["body_temp", "diastolic_bp", "heart_rate", "mood", "sleep_hours", "stress", "systolic_bp"]);
    expect(obs.sleep_hours).toMatchObject({ value: 6.5, unit: "hours", source: "manual", device: "voice_agent" }); // check-in wins over "seven"
    expect(obs.body_temp).toMatchObject({ value: 37.2, unit: "°C", source: "model", device: "journal_parser" });
    expect(obs.systolic_bp).toMatchObject({ value: 118, unit: "mmHg", source: "manual" });

    const before = { e: count("journal_entries"), m: count("journal_messages"), s: count("self_reports"), o: count("observations"), a: count("alerts") };
    const again = await call("POST", "/journal/voice-sessions", { body: { session_id: "sess-1", turns: TURNS, checkin: CHECKIN } });
    expect(again.status).toBe(200);
    expect(again.data.duplicate).toBe(true);
    expect(again.data.reply.id).toBe(first.data.reply.id);
    expect({ e: count("journal_entries"), m: count("journal_messages"), s: count("self_reports"), o: count("observations"), a: count("alerts") }).toEqual(before);
  });

  it("still stores the session when AI fails, using check-in values only", async () => {
    aiFails = true;
    const res = await call("POST", "/journal/voice-sessions", { body: { session_id: "sess-ai-down", turns: TURNS, checkin: CHECKIN } });
    expect(res.status).toBe(201);
    expect(res.data.reply.content).toBe("Saved to your journal.");
    expect(res.data.extracted.ai).toBe(false);
    expect(count("journal_entries")).toBe(1);
    expect(rows("SELECT stress, mood FROM self_reports WHERE user_id=?", ASTRONAUT)).toEqual([{ stress: null, mood: 3 }]);
    expect(rows("SELECT metric FROM observations WHERE user_id=? ORDER BY metric", ASTRONAUT).map((o) => o.metric))
      .toEqual(["diastolic_bp", "mood", "sleep_hours", "systolic_bp"]);
  });

  it("works with turns only (no check-in)", async () => {
    const res = await call("POST", "/journal/voice-sessions", { body: { session_id: "sess-turns", turns: TURNS } });
    expect(res.status).toBe(201);
    expect(rows("SELECT mood, stress, sleep_hours, source FROM self_reports WHERE user_id=?", ASTRONAUT))
      .toEqual([{ mood: null, stress: 4, sleep_hours: 7, source: "voice_web" }]);
    // Values read from free text are 'model' readings: they do not close the mood/sleep tasks or pay points.
    expect(rows("SELECT DISTINCT source FROM observations WHERE user_id=?", ASTRONAUT)).toEqual([{ source: "model" }]);
  });

  it("validates input and keeps users apart", async () => {
    expect((await call("POST", "/journal/voice-sessions", { body: { turns: TURNS } })).status).toBe(422);
    expect((await call("POST", "/journal/voice-sessions", { body: { session_id: "x", turns: [{ sender: "assistant", content: "hi" }] } })).status).toBe(422);
    expect((await call("POST", "/journal/voice-sessions", { body: { session_id: "x", turns: [{ sender: "robot", content: "hi" }] } })).status).toBe(422);
    expect((await call("POST", "/journal/voice-sessions", { body: { session_id: "x y", turns: TURNS } })).status).toBe(422);
    expect((await call("POST", "/journal/voice-sessions", { body: { user_id: OTHER, session_id: "x", turns: TURNS } })).status).toBe(403);
    expect((await call("POST", "/journal/voice-sessions", { token: null, body: { session_id: "x", turns: TURNS } })).status).toBe(401);
    // Same session id from another astronaut is a separate entry (ids are scoped to the user).
    expect((await call("POST", "/journal/voice-sessions", { body: { session_id: "shared", turns: TURNS } })).status).toBe(201);
    expect((await call("POST", "/journal/voice-sessions", { token: "other", body: { session_id: "shared", turns: TURNS } })).status).toBe(201);
  });
});

// ---------- typed entries ----------
describe("typed journal entries", () => {
  it("parses POST /journal/messages into self_reports + observations once", async () => {
    extraction = {
      fatigue: { value: 5, scale_max: 5, quote: "completely exhausted" },
      blood_sugar: { value: 5.5, unit: "mmol/L", quote: "glucose was 5.5 mmol" },
    };
    const id = crypto.randomUUID();
    const sent = await call("POST", "/journal/messages", { body: { id, content: "Completely exhausted today. Fasting glucose was 5.5 mmol." } });
    expect(sent.status).toBe(201);
    expect(Object.keys(sent.data).sort()).toEqual(["message", "reply"]); // response shape unchanged
    expect(rows("SELECT client_id, fatigue, mood, source FROM self_reports WHERE user_id=?", ASTRONAUT))
      .toEqual([{ client_id: `msg:${id}:sr`, fatigue: 5, mood: null, source: "app" }]);
    expect(rows("SELECT client_id, metric, value, unit, source FROM observations WHERE user_id=?", ASTRONAUT))
      .toEqual([{ client_id: `msg:${id}:blood_glucose`, metric: "blood_glucose", value: 99, unit: "mg/dL", source: "model" }]);

    // Re-running the analysis (staff tool) must not duplicate anything.
    const [entry] = rows("SELECT id FROM journal_entries WHERE user_id=?", ASTRONAUT);
    env.EVADE_API_KEY = "test-service-key";
    const rerun = await worker.fetch(new Request(`${API}/journal/${entry.id}/analyze`, { method: "POST", headers: { "X-EVAde-Key": "test-service-key" } }), env, ctx);
    expect(rerun.status).toBe(200);
    expect(count("self_reports")).toBe(1);
    expect(count("observations")).toBe(1);
  });

  it("parses POST /journal with ?analyze=sync and keeps its response shape", async () => {
    extraction = { mood: { value: 8, scale_max: 10, quote: "mood is 8/10" } };
    const res = await call("POST", "/journal?analyze=sync", { body: { client_id: "j-1", content: "My mood is 8/10 today." } });
    expect(res.status).toBe(201);
    expect(Object.keys(res.data).sort()).toEqual(["analysis", "id"]);
    expect(rows("SELECT client_id, mood FROM self_reports WHERE user_id=?", ASTRONAUT)).toEqual([{ client_id: "j-1:sr", mood: 4 }]);
    expect(rows("SELECT client_id, metric, value FROM observations WHERE user_id=?", ASTRONAUT)).toEqual([{ client_id: "j-1:mood", metric: "mood", value: 4 }]);
  });

  it("writes nothing extra for an entry with no stated values", async () => {
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Quiet day on station." } });
    expect(count("self_reports")).toBe(0);
    expect(count("observations")).toBe(0);
    expect(count("journal_entries")).toBe(1);
  });
});

// ---------- real Workers AI output (captured from @cf/meta/llama-3.3-70b-instruct-fp8-fast via wrangler dev) ----------
describe("real model output", () => {
  it("drops a heart rate the model also copied into SpO2", () => {
    const text = "Rough day. My temperature was 100.4 F this morning and I am completely exhausted. Heart rate 92 at rest.";
    const raw = { temperature: { value: 100.4, unit: "F", quote: "100.4 F" }, heart_rate: { value: 92, quote: "92" }, spo2: { value: 92, quote: "92 at rest" } };
    expect(P.validateAi(raw, text).values).toEqual({ body_temp: 38, heart_rate: 92 });
  });

  it("does not turn tone into a mood rating", () => {
    const raw = { mood: { value: 5, scale_max: 5, quote: "Felt connected" } };
    expect(P.validateAi(raw, "Watched Earth rise over the Pacific and talked to my family. Felt connected.").ratings).toEqual({});
  });

  it("ignores empty placeholder fields and picks up an explicit rating the model skipped", async () => {
    const text = [
      "EVAde: Hi, how did you sleep last night?",
      "Me: Not great. I slept about 5 hours and woke up with a headache.",
      "EVAde: Sorry to hear that. A normal body temperature is 36.5 to 37.5 degrees. How is your stress?",
      "Me: Stress is a 4 out of 5 with the EVA prep. BP was 128 over 82 this morning.",
    ].join("\n");
    extraction = {
      sleep_duration: { value: 5, unit: "hours", quote: "5 hours" },
      blood_pressure: { systolic: 128, diastolic: 82, quote: "128 over 82" },
      temperature: { value: 36.5, unit: "C", quote: "" },
      blood_sugar: { value: 0, unit: "unknown", quote: "" },
      heart_rate: { value: 0, quote: "" },
      spo2: { value: 0, quote: "" },
    };
    const x = await P.extractHealth({ AI } as any, text, null);
    expect(x.values).toEqual({ sleep_hours: 5, systolic_bp: 128, diastolic_bp: 82 });
    expect(x.ratings).toEqual({ stress: 4 });
  });

  it("keeps a short answer to the agent's question", () => {
    const text = "EVAde: How many hours did you sleep?\nMe: About seven.";
    expect(P.validateAi({ sleep_duration: { value: 7, unit: "hours", quote: "About seven" } }, text).values).toEqual({ sleep_hours: 7 });
    expect(P.explicitRatings("mood 8/10, stress level is 2 out of 5")).toEqual({ mood: 4, stress: 2 });
  });
});
