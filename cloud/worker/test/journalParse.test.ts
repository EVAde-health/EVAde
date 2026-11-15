// Journal / voice-session parser tests: extraction rules (pure), and the real Worker fetch handler against a D1 built
// from the migrations (node:sqlite) with xAI (api.x.ai) mocked through fetch. No schema changes are involved.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// 0008 and 0011_seed_surgeon_demo are data-only (demo rows, applied on live); the tests seed their own data.
const DATA_ONLY = new Set(["0008_remove_demo_data.sql", "0011_seed_surgeon_demo.sql"]);

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
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && !DATA_ONLY.has(f)).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
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

// Fake xAI (https://api.x.ai/v1): chat completions answer by system prompt. The parser prompt gets `extraction`, the
// journal analysis prompt gets `analysis` (both as JSON text, like structured outputs), the EVA companion gets
// `companion`, and the briefing gets `briefing`. POST /v1/stt returns `transcript`.
const XAI_KEY = "test-xai-key";
let extraction: any;
let analysis: any;
let companion: string;
let briefing: string;
let transcript: string;
let companionInputs: any[];
let xaiRequests: { url: string; model?: string; body: any; auth: string | null }[];
let aiFails: boolean | ((model: string) => boolean);
let aiCalls: number;
const xaiEnv = { XAI_API_KEY: XAI_KEY };

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const req = new Request(input as any, init);
  const url = new URL(req.url);
  if (url.hostname !== "api.x.ai") throw new Error(`unexpected fetch ${req.url}`);
  const auth = req.headers.get("Authorization");
  if (url.pathname === "/v1/stt") {
    const form = await req.formData();
    xaiRequests.push({ url: req.url, model: String(form.get("model")), body: [...form.keys()], auth });
    if (aiFails === true) return new Response("down", { status: 500 });
    return Response.json({ text: transcript, language: "en", duration: 3.2 });
  }
  if (url.pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
  const body: any = await req.json();
  xaiRequests.push({ url: req.url, model: body.model, body, auth });
  aiCalls++;
  if (auth !== `Bearer ${XAI_KEY}`) return new Response("unauthorized", { status: 401 });
  if (aiFails === true || (typeof aiFails === "function" && aiFails(body.model))) return new Response("upstream error", { status: 503 });
  const system = String(body.messages?.[0]?.content ?? "");
  let content: string;
  if (system.startsWith("# Role\nYou are EVAde")) { companionInputs.push(body); content = companion; }
  else if (system.startsWith("You extract health data")) content = JSON.stringify(extraction);
  else if (system.startsWith("You write a short daily health briefing")) content = briefing;
  else content = JSON.stringify(analysis);
  return Response.json({ id: "chatcmpl-test", object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] });
}

let env: any;
// Background work (journal analysis + parser after a chat reply) is collected so tests can wait for it.
let pending: Promise<unknown>[] = [];
const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;

beforeEach(async () => {
  extraction = {};
  analysis = { summary: "A calm day.", sentiment: 0.4, mood_label: "calm", concern_level: "none", needs_human_review: false, themes: ["sleep"] };
  companion = "Thanks for telling me. How many hours did you sleep last night?";
  briefing = "Overall you are green today.";
  transcript = "";
  companionInputs = [];
  xaiRequests = [];
  pending = [];
  aiFails = false;
  aiCalls = 0;
  env = { DB: fakeD1(), SESSIONS: fakeKV(), ...xaiEnv, AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) }, ALLOWED_ORIGINS: FRONTEND };
  const raw: DatabaseSync = env.DB.raw;
  const add = raw.prepare("INSERT INTO users (user_id, display_name, role, mission_start) VALUES (?,?,?,?)");
  add.run(ASTRONAUT, "Cmdr. Test", "astronaut", "2026-11-01T00:00:00Z");
  add.run(OTHER, "Spc. Other", "astronaut", "2026-11-01T00:00:00Z");
  for (const [token, user_id] of [["astro", ASTRONAUT], ["other", OTHER]]) {
    await env.SESSIONS.put(`sess:${await sha256(token)}`, JSON.stringify({ user_id, role: "astronaut", email: null, provider: "cloudflare_access" }));
  }
  vi.stubGlobal("fetch", fakeFetch);
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
    const x = await P.extractHealth(xaiEnv, "Me: feeling great, slept 9 hours, 130 over 85, not stressed", CHECKIN);
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
    const failed = await P.extractHealth(xaiEnv, "Me: slept 9 hours", { mood: 4 });
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
    expect(first.data.reply.content).toBe("Your voice check-in is saved to your journal."); // no summary shown
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
    expect(res.data.reply.content).toBe("Your voice check-in is saved to your journal.");
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
    await settle();
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
    await settle();
    expect(count("self_reports")).toBe(0);
    expect(count("observations")).toBe(0);
    expect(count("journal_entries")).toBe(1);
  });
});

// ---------- xAI Grok client ----------
describe("xAI Grok", () => {
  const A = () => import("../src/ai");

  it("calls chat completions with the key, the default Grok model and a strict JSON schema", async () => {
    extraction = { mood: { value: 4, scale_max: 5, quote: "mood is a 4" } };
    const x = await P.extractHealth(xaiEnv, "Me: my mood is a 4", null);
    expect(x).toMatchObject({ ai_ok: true, model: "grok-4.20-0309-non-reasoning", ratings: { mood: 4 } });
    const [r] = xaiRequests;
    expect(r.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(r.auth).toBe(`Bearer ${XAI_KEY}`);
    expect(r.body).toMatchObject({ model: "grok-4.20-0309-non-reasoning", temperature: 0, max_completion_tokens: 500 });
    expect(r.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "health_extraction", strict: true } });
    expect(r.body.response_format.json_schema.schema.properties.mood).toBeDefined();
  });

  it("falls back to the second Grok model, honours XAI_TEXT_MODEL, and never calls a non-Grok model", async () => {
    aiFails = (model) => model === "grok-4.20-0309-non-reasoning";
    const a = await (await A()).analyzeJournal(xaiEnv, "Long day.");
    expect(a).toMatchObject({ model: "grok-4.3", summary: "A calm day." });
    expect(xaiRequests.map((r) => r.model)).toEqual(["grok-4.20-0309-non-reasoning", "grok-4.3"]);
    aiFails = false;
    xaiRequests = [];
    await (await A()).analyzeJournal({ ...xaiEnv, XAI_TEXT_MODEL: "grok-4.7", XAI_FALLBACK_TEXT_MODEL: "" }, "Long day.");
    expect(xaiRequests.map((r) => r.model)).toEqual(["grok-4.7"]);
    expect((await A()).textModels({})).toEqual(["grok-4.20-0309-non-reasoning", "grok-4.3"]);
    expect((await A()).textModels({}).every((m) => m.startsWith("grok-"))).toBe(true);
  });

  it("makes no call without XAI_API_KEY and keeps the safety net", async () => {
    const a = await (await A()).analyzeJournal({}, "I don't want to wake up anymore.");
    expect(a).toMatchObject({ model: null, concern_level: "high", needs_human_review: true });
    expect(await (await A()).dailyBriefing({}, { overall: "green" })).toBeNull();
    expect(xaiRequests).toEqual([]);
  });

  it("transcribes voice journals with xAI speech-to-text", async () => {
    transcript = "Slept about six hours. Mood is a 3.";
    const headers = new Headers({ Origin: FRONTEND, Cookie: "__Host-evade_session=astro", "Content-Type": "audio/webm" });
    const res = await worker.fetch(new Request(`${API}/journal/voice`, { method: "POST", headers, body: new Uint8Array([26, 69, 223, 163, 1, 2, 3]) }), env, ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ transcript, analysis: "queued" });
    const stt = xaiRequests.find((r) => r.url.endsWith("/v1/stt"))!;
    expect(stt).toMatchObject({ model: "grok-voice-transcribe-2.0", auth: `Bearer ${XAI_KEY}` });
    expect(stt.body).toEqual(["model", "file"]); // the file is the last field
    await settle();
    expect(rows("SELECT source, content FROM journal_entries WHERE user_id=?", ASTRONAUT)).toEqual([{ source: "voice", content: transcript }]);
  });

  it("reports speech-to-text as not configured without the key", async () => {
    delete env.XAI_API_KEY;
    const headers = new Headers({ Origin: FRONTEND, Cookie: "__Host-evade_session=astro", "Content-Type": "audio/webm" });
    const res = await worker.fetch(new Request(`${API}/journal/voice`, { method: "POST", headers, body: new Uint8Array([1, 2, 3]) }), env, ctx);
    expect(res.status).toBe(503);
    expect(xaiRequests).toEqual([]);
  });

  it("generates the daily briefing with Grok and labels it with the model", async () => {
    const res = await call("GET", `/users/${ASTRONAUT}/briefing?refresh=1`);
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ briefing: briefing, generated_by: "grok-4.20-0309-non-reasoning" });
  });

  it("gives the companion's friendly fallback without a key", async () => {
    delete env.XAI_API_KEY;
    const res = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Hello?" } });
    await settle();
    expect(res.data.reply.content).toBe((await import("../src/evaCompanion")).FALLBACK_REPLY);
    expect(xaiRequests).toEqual([]);
    expect(count("journal_entries")).toBe(1);
  });
});

// ---------- EVA companion (text version of the voice agent) ----------
describe("EVA companion chat", () => {
  const C = () => import("../src/evaCompanion");

  it("replies conversationally from the thread history and never shows the analysis", async () => {
    const id1 = crypto.randomUUID();
    const first = await call("POST", "/journal/messages", { body: { id: id1, content: "Hi, ready for the check-in." } });
    expect(first.status).toBe(201);
    expect(first.data.reply.content).toBe(companion);
    expect(first.data.reply.content).not.toContain("A calm day.");
    companion = "Got it. On a scale of 1 to 5, how is your mood today?";
    const second = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "About 7 hours." } });
    expect(second.data.reply.content).toBe(companion);
    // The model saw the persona and the whole conversation, alternating user / assistant, ending with the new message.
    const input = companionInputs[1];
    expect(input.messages[0].content).toContain("# Check-in");
    expect(input.messages.slice(1)).toEqual([
      { role: "user", content: "Hi, ready for the check-in." },
      { role: "assistant", content: "Thanks for telling me. How many hours did you sleep last night?" },
      { role: "user", content: "About 7 hours." },
    ]);
    const stored = rows("SELECT sender, content, model FROM journal_messages WHERE user_id=? AND sender='assistant' ORDER BY ts", ASTRONAUT);
    expect(stored.map((m) => m.model)).toEqual(["grok-4.20-0309-non-reasoning", "grok-4.20-0309-non-reasoning"]);
    // The analyzer still ran behind the scenes, on each message.
    await settle();
    expect(rows("SELECT ai_summary, mood_label FROM journal_entries WHERE user_id=? ORDER BY id", ASTRONAUT))
      .toEqual([{ ai_summary: "A calm day.", mood_label: "calm" }, { ai_summary: "A calm day.", mood_label: "calm" }]);
  });

  it("parses a short answer with the companion's question, once, and never re-parses earlier messages", async () => {
    extraction = { mood: { value: 4, scale_max: 5, quote: "mood is a 4" } };
    const id1 = crypto.randomUUID();
    await call("POST", "/journal/messages", { body: { id: id1, content: "Morning. My mood is a 4." } });
    await settle();
    // The model repeats the earlier mood and adds the sleep answer: only the new message's value is kept.
    extraction = { mood: { value: 4, scale_max: 5, quote: "mood is a 4" }, sleep_duration: { value: 7, unit: "hours", quote: "About 7" } };
    const id2 = crypto.randomUUID();
    await call("POST", "/journal/messages", { body: { id: id2, content: "About 7" } });
    await settle();
    expect(rows("SELECT client_id, metric, value, source, device FROM observations WHERE user_id=? ORDER BY client_id", ASTRONAUT).sort((a, b) => a.client_id.localeCompare(b.client_id))).toEqual([
      { client_id: `msg:${id1}:mood`, metric: "mood", value: 4, source: "model", device: "journal_parser" },
      { client_id: `msg:${id2}:sleep_hours`, metric: "sleep_hours", value: 7, source: "model", device: "journal_parser" },
    ].sort((a, b) => a.client_id.localeCompare(b.client_id)));
    expect(count("self_reports")).toBe(2);

    // Re-sending the same message (a retry) returns the stored reply and writes nothing.
    const before = { m: count("journal_messages"), s: count("self_reports"), o: count("observations"), e: count("journal_entries") };
    const again = await call("POST", "/journal/messages", { body: { id: id2, content: "About 7" } });
    await settle();
    expect(again.data.duplicate).toBe(true);
    expect(again.data.reply.content).toBe(companion);
    expect({ m: count("journal_messages"), s: count("self_reports"), o: count("observations"), e: count("journal_entries") }).toEqual(before);
  });

  it("saves the message with a fallback reply when the model is down", async () => {
    aiFails = true;
    const res = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Long day." } });
    await settle();
    expect(res.status).toBe(201);
    expect(res.data.reply.content).toBe((await C()).FALLBACK_REPLY);
    expect(rows("SELECT model FROM journal_messages WHERE sender='assistant'")).toEqual([{ model: "rules" }]);
    expect(count("journal_entries")).toBe(1);
  });

  it("always adds the support line and alerts staff for safety language", async () => {
    analysis = { ...analysis, concern_level: "low", needs_human_review: false };
    companion = "I'm really glad you told me.";
    const res = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Some days I don't want to wake up." } });
    await settle();
    expect(res.data.reply.content).toContain((await C()).SUPPORT_LINE);
    expect(rows("SELECT level, metric, escalate FROM alerts WHERE user_id=?", ASTRONAUT)).toEqual([{ level: "red", metric: "journal", escalate: 1 }]);
  });

  it("keeps the voice agent's check-in and safety rules", async () => {
    // The voice agent (worker/src/agent.ts) lives on main, not on this branch; the "# Safety" section is a word-for-word copy.
    const text = (await C()).COMPANION_INSTRUCTIONS;
    expect(text).toContain("Ask how many hours they slept.");
    expect(text).toContain("# Safety\n- If they describe chest pain, trouble breathing, fainting, confusion, slurred speech, or");
    expect(text).toContain("Never diagnose or prescribe medication. Never make up readings they did not give you.");
  });

  it("reads a bare rating that answers the companion's scale question", () => {
    const q = "EVAde: Now, how is your mood, on a scale from 1, which is very low, to 5, which is very good?";
    expect(P.answeredRatings(`${q}\nMe: I'd say a 3. Bit flat today.`)).toEqual({ mood: 3 });
    expect(P.answeredRatings(`${q}\nMe: 4`)).toEqual({ mood: 4 });
    expect(P.answeredRatings("EVAde: How stressed are you from 1 to 10?\nMe: Maybe a 7.")).toEqual({ stress: 4 });
    expect(P.answeredRatings(`${q}\nMe: 3 hours of sleep, honestly.`)).toEqual({});
    expect(P.answeredRatings("EVAde: How is your mood today?\nMe: 3")).toEqual({}); // no scale in the question
    expect(P.answeredRatings("EVAde: Rate your mood and stress from 1 to 5.\nMe: 3")).toEqual({}); // which one?
    expect(P.answeredRatings(`Me: mood?\n${q}`)).toEqual({});
  });

  it("keeps stated symptoms and drops denied or unquoted ones", () => {
    const text = "EVAde: Any symptoms, like a headache or nausea?\nMe: A bit of a headache since this morning, no nausea.";
    const raw = { symptoms: [
      { name: "headache", quote: "A bit of a headache since this morning" },
      { name: "nausea", quote: "no nausea" },
      { name: "rash", quote: "a rash" },
      { name: "headache", quote: "headache" },
    ] };
    expect(P.validateAi(raw, text).symptoms).toEqual(["headache"]);
  });

  it("writes chat symptoms and a bare mood answer to the self-report", async () => {
    companion = "On a scale from 1 to 5, how is your mood? And any symptoms, like a headache?";
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Ready for the check-in." } });
    await settle();
    extraction = { symptoms: [{ name: "headache", quote: "headache since this morning" }] };
    const id = crypto.randomUUID();
    await call("POST", "/journal/messages", { body: { id, content: "A 3. And a headache since this morning." } });
    await settle();
    const [sr] = rows("SELECT client_id, mood, symptoms, source FROM self_reports WHERE user_id=?", ASTRONAUT);
    expect(sr).toEqual({ client_id: `msg:${id}:sr`, mood: 3, symptoms: JSON.stringify(["headache"]), source: "app" });
  });

  it("drops old summary replies and starts the thread with the user", async () => {
    const { companionMessages } = await C();
    const m = companionMessages([
      { sender: "assistant", content: "Saved to your journal." },
      { sender: "user", content: "hello" },
      { sender: "assistant", content: "The astronaut had a calm day.\n\nMood: calm" },
      { sender: "user", content: "slept 6 hours" },
    ]);
    expect(m.slice(1)).toEqual([{ role: "user", content: "hello\nslept 6 hours" }]);
  });
});

// ---------- real model output ----------
// Raw outputs captured from a live model (Llama 3.3 on Workers AI, before the switch to Grok). They are kept because
// the validation they test (quotes, context words, placeholders) runs on any model's JSON; Grok output still needs to
// be captured once XAI_API_KEY is available.
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
    const x = await P.extractHealth(xaiEnv, text, null);
    expect(x.values).toEqual({ sleep_hours: 5, systolic_bp: 128, diastolic_bp: 82 });
    expect(x.ratings).toEqual({ stress: 4 });
  });

  it("keeps a short answer to the agent's question", () => {
    const text = "EVAde: How many hours did you sleep?\nMe: About seven.";
    expect(P.validateAi({ sleep_duration: { value: 7, unit: "hours", quote: "About seven" } }, text).values).toEqual({ sleep_hours: 7 });
    expect(P.explicitRatings("mood 8/10, stress level is 2 out of 5")).toEqual({ mood: 4, stress: 2 });
  });
});
