// Web app route tests: the real Worker fetch handler, real D1 schema (migrations in node:sqlite), in-memory KV.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// 0008 and 0011_seed_surgeon_demo are data-only (demo rows, applied on live); the tests seed their own data.
const DATA_ONLY = new Set(["0008_remove_demo_data.sql", "0011_seed_surgeon_demo.sql"]);

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../src/index");
const { streakFrom, trackingDay, weekStart, settingsPatch, voiceSavedReply } = await import("../src/webapp");

const API = "https://api.evade.health";
const FRONTEND = "https://evade.health";
const ASTRONAUT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SURGEON = "33333333-3333-4333-8333-333333333333";

// ---------- fakes ----------
// Fake xAI REST API: chat completions answer through `chat`, speech-to-text returns `stt`. Records every request.
const XAI_KEY = "test-xai-key";
type XaiRequest = { url: string; auth: string | null; body: any };
function stubGrok(chat: (body: any) => string | Promise<string>, stt = "") {
  const requests: XaiRequest[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const auth = new Headers(init?.headers).get("Authorization");
    if (url === "https://api.x.ai/v1/stt") {
      const form = init?.body as FormData;
      requests.push({ url, auth, body: [...form.keys()].map((k) => k === "model" ? "model=" + form.get(k) : k) });
      return Response.json({ text: stt, language: "en", duration: 2.5 });
    }
    if (url !== "https://api.x.ai/v1/chat/completions") throw new Error("unexpected fetch " + url);
    const body = JSON.parse(String(init?.body));
    requests.push({ url, auth, body });
    const content = await chat(body);
    return Response.json({ choices: [{ message: { role: "assistant", content } }] });
  });
  return requests;
}

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

let env: any;
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnException: () => {} } as unknown as ExecutionContext;
/** Waits for the work routes hand to ctx.waitUntil (journal analysis, the parser). */
const settle = async () => { while (pending.length) await Promise.allSettled(pending.splice(0)); };

beforeEach(async () => {
  pending.length = 0; // work a previous test left hanging (a model call that never answers) is not awaited
  env = { DB: fakeD1(), SESSIONS: fakeKV(), AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) }, ALLOWED_ORIGINS: FRONTEND };
  const raw: DatabaseSync = env.DB.raw;
  const add = raw.prepare("INSERT INTO users (user_id, display_name, role, mission_start) VALUES (?,?,?,?)");
  add.run(ASTRONAUT, "Cmdr. Test", "astronaut", "2026-11-01T00:00:00Z");
  add.run(OTHER, "Spc. Other", "astronaut", "2026-11-01T00:00:00Z");
  add.run(SURGEON, "Dr. Surgeon", "flight_surgeon", "2026-11-01T00:00:00Z");
  for (const [token, user_id, role] of [["astro", ASTRONAUT, "astronaut"], ["other", OTHER, "astronaut"]]) {
    await env.SESSIONS.put(`sess:${await sha256(token)}`, JSON.stringify({ user_id, role, email: null, provider: "cloudflare_access" }));
  }
  vi.stubGlobal("fetch", async () => { throw new Error("unexpected fetch"); });
});
afterEach(() => {
  env.DB.raw.close();
  vi.unstubAllGlobals();
});

async function call(method: string, path: string, { token = "astro", body, origin = FRONTEND }: { token?: string | null; body?: unknown; origin?: string } = {}) {
  const headers = new Headers({ Origin: origin });
  if (token) headers.set("Cookie", `__Host-evade_session=${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await worker.fetch(new Request(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

const today = () => new Date().toISOString().slice(0, 10);

it("summarizes model runs without result contents or cross-account exposure to demo and personal users", async () => {
  env.DEMO_LOGIN = "true";
  const demoId = "00000000-0000-4000-8000-00000000d001";
  const raw: DatabaseSync = env.DB.raw;
  raw.prepare("INSERT OR IGNORE INTO users (user_id, display_name, role) VALUES (?, 'Demo', 'astronaut')").run(demoId);
  await env.SESSIONS.put("sess:" + await sha256("runs-demo"), JSON.stringify({ user_id: demoId, role: "astronaut", provider: "demo" }));
  await env.SESSIONS.put("sess:" + await sha256("runs-staff"), JSON.stringify({ user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access" }));
  raw.prepare("DELETE FROM model_results").run();
  const insert = raw.prepare("INSERT INTO model_results(user_id, ts, endpoint, model_id, source, output, flag) VALUES (?, ?, '/v1/predict/ecg', ?, ?, ?, 'private flag')");
  insert.run(demoId, "2026-11-15T00:00:00Z", "EVA-6", "simulated", '{"data":{}}');
  insert.run(demoId, "2026-11-15T09:00:00Z", "EVA-6", "simulated", '{"data":{"source":"mock"}}');
  insert.run(OTHER, "2026-11-15T08:00:00Z", "EVA-6", "model", '{"data":{}}');
  insert.run(OTHER, "2026-11-15T11:00:00Z", "EVA-6", "mock", '{"data":{}}');
  insert.run(ASTRONAUT, "2026-11-15T01:00:00Z", "EVA-13", "model", '{"data":{}}');
  const path = "/models/runs";
  expect((await call("GET", path, { token: null })).status).toBe(401);
  expect(await call("GET", path, { token: "runs-demo" })).toEqual({ status: 200, data: {
    scope: "demo", models: [{ model_id: "EVA-6", count: 1, last_run: "2026-11-15T00:00:00.000Z" }],
  } });
  expect(await call("GET", path + "?user_id=" + OTHER)).toEqual({ status: 200, data: {
    scope: "personal", models: [{ model_id: "EVA-13", count: 1, last_run: "2026-11-15T01:00:00.000Z" }],
  } });
  expect(await call("GET", path, { token: "runs-staff" })).toEqual({ status: 200, data: {
    scope: "staff", models: expect.arrayContaining([
      { model_id: "EVA-6", count: 2, last_run: "2026-11-15T08:00:00.000Z" },
      { model_id: "EVA-13", count: 1, last_run: "2026-11-15T01:00:00.000Z" },
    ]),
  } });
});

describe("AI companion routes", () => {
  async function staffSession() {
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    await env.SESSIONS.put("sess:" + await sha256("companion-staff"), JSON.stringify({
      user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access_staff", audience: "staff",
    }));
    return "companion-staff";
  }

  it("uses the configured Grok model, persists only the user's private turns and handles retries and deletion", async () => {
    const requests = stubGrok(() => '{"crisis":false,"tone":1,"next":0}');
    Object.assign(env, { XAI_API_KEY: XAI_KEY, XAI_TEXT_MODEL: "grok-test-model" });
    const body = { id: crypto.randomUUID(), message: "It was a long day." };
    const created = await call("POST", "/journal/chat", { body });
    expect(created.status).toBe(201);
    expect(created.data.reply.content).toContain("How much did you sleep");
    const decisions = requests.filter((r) => r.body.response_format?.json_schema?.name === "companion_decision");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].auth).toBe("Bearer " + XAI_KEY);
    expect(decisions[0].body).toMatchObject({ model: "grok-test-model", max_completion_tokens: 64, temperature: 0.1 });
    expect(decisions[0].body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "companion_decision", strict: true } });
    expect(decisions[0].body).not.toHaveProperty("reasoning_effort");
    expect((await call("POST", "/journal/chat", { body })).data.reply).toEqual(created.data.reply);
    const path = "/users/" + ASTRONAUT + "/journal/messages";
    expect((await call("GET", path)).data).toHaveLength(2);
    expect((await call("GET", path, { token: "other" })).status).toBe(403);
    const staff = await staffSession();
    expect((await call("GET", path, { token: staff })).status).toBe(403);
    const staffJournal = await call("GET", "/admin/astronauts/" + ASTRONAUT + "/journal", { token: staff });
    expect(staffJournal.status).toBe(200);
    expect(JSON.stringify(staffJournal.data)).not.toContain(body.message);
    env.EVADE_API_KEY = crypto.randomUUID();
    const maintenance = await worker.fetch(new Request(API + path, { headers: { "X-EVAde-Key": env.EVADE_API_KEY } }), env, ctx);
    expect(maintenance.status).toBe(200);
    expect(await maintenance.json()).toEqual([]);
    expect((await call("DELETE", "/me", { body: { confirm: "DELETE" } })).status).toBe(200);
    expect(env.DB.raw.prepare("SELECT 1 FROM journal_messages WHERE user_id=?").get(ASTRONAUT)).toBeUndefined();
  });

  it("sends crisis guidance, skips the model, and records one staff emergency without copying the text", async () => {
    const requests = stubGrok(() => '{"crisis":false,"tone":0,"next":0}');
    env.XAI_API_KEY = XAI_KEY;
    const marker = "private-companion-test-marker";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await call("POST", "/journal/chat", { body: { message: "I want to die and I can't stay safe. " + marker } });
      expect(result.status).toBe(201);
      expect(result.data.reply.content).toContain("call or text 988");
    }
    expect(requests).toEqual([]);
    const alerts = env.DB.raw.prepare("SELECT level,message FROM alerts WHERE user_id=? AND metric='emergency'").all(ASTRONAUT);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: "red" });
    expect(alerts[0].message).not.toContain("want to die");
    expect(env.DB.raw.prepare("SELECT COUNT(*) n FROM emergencies WHERE user_id=?").get(ASTRONAUT).n).toBe(1);
    const staff = await staffSession();
    const visible = await call("GET", "/admin/astronauts/" + ASTRONAUT + "/alerts", { token: staff });
    expect(visible.status).toBe(200);
    expect(visible.data).toEqual(expect.arrayContaining([expect.objectContaining({ level: "red", metric: "emergency" })]));
    expect(JSON.stringify(visible.data)).not.toContain("want to die");
    const astro = "/admin/astronauts/" + ASTRONAUT;
    const emergencies = await call("GET", "/admin/emergencies", { token: staff });
    expect(emergencies.status).toBe(200);
    expect(emergencies.data).toEqual([expect.objectContaining({ message: "The journal companion flagged a safety concern." })]);
    for (const path of [astro + "/journal", astro + "/mood", astro + "/alerts", "/admin/therapist-feed", "/admin/alerts", "/admin/notifications"]) {
      const result = await call("GET", path, { token: staff });
      expect(result.status, path).toBe(200);
      expect(JSON.stringify(result.data), path).not.toContain(marker);
    }
  });

  it("uses the per-user limiter and falls back after 15 seconds", async () => {
    vi.useFakeTimers();
    try {
      const limit = vi.fn(async () => ({ success: true }));
      env.AUTH_RATE_LIMITER = { limit };
      let modelStarted!: () => void;
      const started = new Promise<void>(resolve => { modelStarted = resolve; });
      env.XAI_API_KEY = XAI_KEY;
      stubGrok(() => { modelStarted(); return new Promise<string>(() => {}); });
      const request = call("POST", "/journal/chat", { body: { message: "Good morning" } });
      await started;
      await vi.advanceTimersByTimeAsync(15_000);
      expect((await request).data.reply.content).toContain("contact your flight surgeon or therapist");
      expect(limit).toHaveBeenCalledWith({ key: "journal-chat:" + ASTRONAUT });
      limit.mockResolvedValue({ success: false });
      expect((await call("POST", "/journal/chat", { body: { message: "Another update" } })).status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restricts summaries to staff and sends only scoped, structured data to Grok", async () => {
    const raw: DatabaseSync = env.DB.raw;
    const ts = new Date().toISOString();
    const insert = raw.prepare("INSERT INTO observations (user_id,metric,value,unit,ts) VALUES (?,'heart_rate',?,?,?)");
    insert.run(ASTRONAUT, 70, "private@example.test", ts);
    insert.run(OTHER, 9876, "other@example.test", ts);
    raw.prepare("INSERT INTO journal_entries (user_id,ts,content,sentiment) VALUES (?,?,?,?)")
      .run(ASTRONAUT, ts, "private journal content", 0.25);
    expect((await call("POST", "/journal/chat", { body: { message: "private companion content" } })).status).toBe(201);
    env.XAI_API_KEY = XAI_KEY;
    const requests = stubGrok(() => '{"bullets":["Vitals recorded.","No alerts.","Mood score recorded."]}');
    const path = "/admin/astronauts/" + ASTRONAUT + "/summary";
    expect((await call("GET", path)).status).toBe(403);
    const result = await call("GET", path, { token: await staffSession() });
    expect(result.status).toBe(200);
    expect(result.data.label).toBe("AI summary, verify against the data, not a diagnosis");
    expect(result.data.bullets).toEqual(["Vitals recorded.", "No alerts.", "Mood score recorded."]);
    expect(requests).toHaveLength(1);
    expect(requests[0].body.model).toBe("grok-4.20-0309-non-reasoning");
    expect(requests[0].body.response_format.json_schema).toMatchObject({ name: "staff_summary", strict: true });
    const modelInput = JSON.stringify(requests.map((r) => r.body.messages));
    expect(modelInput).toContain("journal_samples");
    for (const excluded of ["example.test", "9876", "private journal content", "private companion content", ASTRONAUT, OTHER]) {
      expect(modelInput).not.toContain(excluded);
    }
  });
});

describe("notifications (from main's API)", () => {
  it("lists the user's own notifications and marks them read", async () => {
    expect((await call("GET", "/me/notifications?unread=1")).data).toEqual({ notifications: [], unread: 0 });
    const raw: DatabaseSync = env.DB.raw;
    const add = raw.prepare("INSERT INTO user_notifications (user_id, kind, title, body, actor_id) VALUES (?,?,?,?,?)");
    add.run(ASTRONAUT, "goal_updated", "Goal changed", "Water 3000 mL", SURGEON);
    add.run(OTHER, "message", "Other", "Not yours", null);
    const list = await call("GET", "/me/notifications?unread=1");
    expect(list.data).toMatchObject({ unread: 1, notifications: [{ kind: "goal_updated", title: "Goal changed", actor_name: "Dr. Surgeon" }] });
    expect((await call("POST", "/me/notifications/read", { body: { ids: [list.data.notifications[0].id] } })).status).toBe(204);
    expect((await call("GET", "/me/notifications?unread=1")).data).toEqual({ notifications: [], unread: 0 });
    expect((await call("GET", "/me/notifications", { token: "other" })).data.unread).toBe(1);
    expect((await call("GET", "/me/notifications", { token: null })).status).toBe(401);
  });
});

describe("health-data parser behind POST /journal/chat", () => {
  const isParser = (b: any) => String(b.messages?.[0]?.content).includes("You extract health data");
  it("stores stated values with idempotent client_ids and keeps the message text private", async () => {
    env.XAI_API_KEY = XAI_KEY;
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    const requests = stubGrok((b) => isParser(b)
      ? JSON.stringify({ sleep_duration: { value: 7, unit: "hours", quote: "about 7 hours" }, heart_rate: { value: 64, quote: "heart rate was 64" } })
      : '{"crisis":false,"tone":0,"next":1}');
    const id = crypto.randomUUID();
    const body = { id, message: "Slept about 7 hours, heart rate was 64 this morning. private-chat-marker" };
    expect((await call("POST", "/journal/chat", { body })).status).toBe(201);
    await settle();
    const raw: DatabaseSync = env.DB.raw;
    expect(raw.prepare("SELECT client_id, metric, value, source, device FROM observations WHERE user_id=? ORDER BY metric").all(ASTRONAUT)).toEqual([
      { client_id: `chat:${id}:heart_rate`, metric: "heart_rate", value: 64, source: "model", device: "journal_parser" },
      { client_id: `chat:${id}:sleep_hours`, metric: "sleep_hours", value: 7, source: "model", device: "journal_parser" },
    ]);
    expect(raw.prepare("SELECT client_id, sleep_hours, note, source FROM self_reports WHERE user_id=?").all(ASTRONAUT))
      .toEqual([{ client_id: `chat:${id}:sr`, sleep_hours: 7, note: null, source: "app" }]);
    expect((raw.prepare("SELECT COUNT(*) n FROM journal_entries WHERE user_id=?").get(ASTRONAUT) as any).n).toBe(0); // no analysis, no entry
    // A second message: the parser reads the companion's previous question with it.
    expect((await call("POST", "/journal/chat", { body: { message: "About a 4." } })).status).toBe(201);
    await settle();
    const parserInputs = requests.filter((r) => isParser(r.body)).map((r) => r.body.messages[1].content);
    expect(parserInputs[1]).toBe("EVAde: Thanks for checking in. How are your mood and stress today?\nMe: About a 4.");
    // A retry of the first message writes nothing new; staff never see the text.
    expect((await call("POST", "/journal/chat", { body })).data.duplicate).toBe(true);
    await settle();
    expect((raw.prepare("SELECT COUNT(*) n FROM observations WHERE client_id LIKE ?").get(`chat:${id}:%`) as any).n).toBe(2);
    await env.SESSIONS.put("sess:" + await sha256("parser-staff"), JSON.stringify({ user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access_staff", audience: "staff" }));
    const staffJournal = await call("GET", "/admin/astronauts/" + ASTRONAUT + "/journal", { token: "parser-staff" });
    expect(staffJournal.status).toBe(200);
    expect(JSON.stringify(staffJournal.data)).not.toContain("private-chat-marker");
  });

  it("never sends a crisis message to the parser", async () => {
    env.XAI_API_KEY = XAI_KEY;
    const requests = stubGrok(() => "{}");
    expect((await call("POST", "/journal/chat", { body: { message: "I want to die. I slept 3 hours." } })).status).toBe(201);
    await settle();
    expect(requests).toEqual([]);
    expect((env.DB.raw.prepare("SELECT COUNT(*) n FROM observations WHERE user_id=?").get(ASTRONAUT) as any).n).toBe(0);
  });
});

describe("xAI Grok", () => {
  it("falls back to the second Grok model and only ever calls Grok models", async () => {
    env.XAI_API_KEY = XAI_KEY;
    const requests = stubGrok((b) => {
      if (b.model === "grok-4.20-0309-non-reasoning") throw new Error("model down");
      return '{"crisis":false,"tone":2,"next":1}';
    });
    const res = await call("POST", "/journal/chat", { body: { message: "Feeling good today." } });
    expect(res.status).toBe(201);
    expect(res.data.reply.content).toBe("I'm glad you took a moment to check in. How are your mood and stress today?");
    const decisions = requests.filter((r) => r.body.response_format?.json_schema?.name === "companion_decision");
    expect(decisions.map((r) => r.body.model)).toEqual(["grok-4.20-0309-non-reasoning", "grok-4.3"]);
    expect(requests.every((r) => r.body.model.startsWith("grok-"))).toBe(true);
    const { textModels } = await import("../src/ai");
    expect(textModels({})).toEqual(["grok-4.20-0309-non-reasoning", "grok-4.3"]);
    expect(textModels({ XAI_TEXT_MODEL: "grok-4.7", XAI_FALLBACK_TEXT_MODEL: "" })).toEqual(["grok-4.7"]);
  });

  it("makes no model call without XAI_API_KEY and keeps the rule-based replies and the safety net", async () => {
    const requests = stubGrok(() => "{}");
    const chat = await call("POST", "/journal/chat", { body: { message: "Long day." } });
    expect(chat.status).toBe(201);
    expect(chat.data.reply.content).toContain("contact your flight surgeon or therapist");
    await env.SESSIONS.put("sess:" + await sha256("nokey-staff"), JSON.stringify({ user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access_staff", audience: "staff" }));
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    const summary = await call("GET", "/admin/astronauts/" + ASTRONAUT + "/summary", { token: "nokey-staff" });
    expect(summary.status).toBe(200);
    expect(summary.data.bullets).toEqual(["No vitals recorded.", "No alerts recorded.", "No journal mood score recorded."]);
    const { analyzeJournal, dailyBriefing } = await import("../src/ai");
    expect(await analyzeJournal({}, "I don't want to wake up anymore.")).toMatchObject({ model: null, concern_level: "high", needs_human_review: true });
    expect(await dailyBriefing({}, { overall: "green" })).toBeNull();
    const voice = await worker.fetch(new Request(API + "/journal/voice", {
      method: "POST", body: new Uint8Array([1, 2, 3]),
      headers: { Origin: FRONTEND, Cookie: "__Host-evade_session=astro", "Content-Type": "audio/webm" },
    }), env, ctx);
    expect(voice.status).toBe(503);
    expect(requests).toEqual([]);
  });

  it("analyzes a journal entry with a strict schema", async () => {
    env.XAI_API_KEY = XAI_KEY;
    const requests = stubGrok(() => JSON.stringify({
      summary: "A calm day.", sentiment: 0.4, mood_label: "Calm", concern_level: "none", needs_human_review: false, themes: ["sleep"],
    }));
    const res = await call("POST", "/journal?analyze=sync", { body: { user_id: ASTRONAUT, content: "Slept well, calm day." } });
    expect(res.status).toBe(201);
    expect(res.data.analysis).toMatchObject({ summary: "A calm day.", mood_label: "calm", model: "grok-4.20-0309-non-reasoning" });
    expect(requests.map((r) => r.body.response_format?.json_schema?.name).sort()).toEqual(["health_extraction", "journal_analysis"]);
    expect(env.DB.raw.prepare("SELECT analysis_model FROM journal_entries WHERE user_id=?").get(ASTRONAUT)).toEqual({ analysis_model: "grok-4.20-0309-non-reasoning" });
  });

  it("transcribes voice journals with xAI speech-to-text", async () => {
    env.XAI_API_KEY = XAI_KEY;
    const transcript = "Slept about six hours. Mood is a three.";
    const requests = stubGrok(() => "{}", transcript);
    const res = await worker.fetch(new Request(API + "/journal/voice", {
      method: "POST", body: new Uint8Array([26, 69, 223, 163, 1, 2, 3]),
      headers: { Origin: FRONTEND, Cookie: "__Host-evade_session=astro", "Content-Type": "audio/webm" },
    }), env, ctx);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ transcript });
    const stt = requests.find((r) => r.url.endsWith("/v1/stt"))!;
    expect(stt).toMatchObject({ auth: "Bearer " + XAI_KEY, body: ["model=grok-voice-transcribe-2.0", "file"] }); // file last
    expect(env.DB.raw.prepare("SELECT source, content FROM journal_entries WHERE user_id=?").all(ASTRONAUT)).toEqual([{ source: "voice", content: transcript }]);
  });
});

// ---------- helpers ----------
describe("pure helpers", () => {
  it("counts a streak that ends today or yesterday", () => {
    expect(streakFrom(["2026-11-14", "2026-11-13", "2026-11-11"], "2026-11-14")).toBe(2);
    expect(streakFrom(["2026-11-13", "2026-11-12"], "2026-11-14")).toBe(2);
    expect(streakFrom(["2026-11-10"], "2026-11-14")).toBe(0);
  });
  it("finds the ISO week start", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });
  it("rejects tracking days that would backfill", () => {
    expect(() => trackingDay("2020-01-01")).toThrow();
    expect(() => trackingDay("2026-02-30")).toThrow();
    expect(trackingDay(today())).toBe(today());
  });
  it("validates settings patches", () => {
    expect(() => settingsPatch({ kcal_goal: 1 })).toThrow();
    expect(() => settingsPatch({ timezone: "Mars/Olympus" })).toThrow();
    expect(() => settingsPatch({ is_admin: true })).toThrow();
    expect(settingsPatch({ water_goal_ml: 3000.4, reduced_motion: true })).toEqual([["water_goal_ml", 3000], ["reduced_motion", 1]]);
  });
  it("never shows a summary or concern scores after a voice check-in", () => {
    const reply = voiceSavedReply(true);
    expect(reply).toContain("crew support team");
    expect(reply).not.toMatch(/concern|high|score|mood/i);
    expect(voiceSavedReply(false)).toBe("Your voice check-in is saved to your journal.");
  });
});

// ---------- access ----------
describe("access control", () => {
  it("requires a session", async () => {
    expect((await call("GET", `/users/${ASTRONAUT}/today`, { token: null })).status).toBe(401);
    expect((await call("GET", "/tutorials", { token: null })).status).toBe(401);
  });
  it("keeps astronauts out of each other's records", async () => {
    expect((await call("GET", `/users/${OTHER}/today`)).status).toBe(403);
    expect((await call("GET", `/users/${OTHER}/settings`)).status).toBe(403);
    expect((await call("POST", "/journal/messages", { body: { user_id: OTHER, id: crypto.randomUUID(), content: "hi" } })).status).toBe(403);
  });
  it("blocks cookie writes from other origins", async () => {
    expect((await call("PATCH", `/users/${ASTRONAUT}/settings`, { body: { kcal_goal: 2000 }, origin: "https://evil.example" })).status).toBe(403);
  });
});

// ---------- missions ----------
describe("today's missions", () => {
  it("materializes templates once with server-side points and tracks the streak", async () => {
    const first = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(first.status).toBe(200);
    expect(first.data.tasks).toHaveLength(14);
    const bp = first.data.tasks.find((t: any) => t.task_key === "p-bp");
    expect(bp).toMatchObject({ points: 30, kind: "protocol", tutorial_id: "bp-cuff", icon: "HeartIcon" });
    const again = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(again.data.tasks.map((t: any) => t.id)).toEqual(first.data.tasks.map((t: any) => t.id));

    const done = await call("POST", `/tasks/${bp.id}/complete`, { body: {} });
    expect(done.data.points_awarded).toBe(30);
    const after = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(after.data).toMatchObject({ streak_days: 1, points: 30 });
    expect((await call("POST", `/tasks/${bp.id}/complete`, { token: "other", body: {} })).status).toBe(403);
  });
  it("rejects far-off days", async () => {
    expect((await call("GET", `/users/${ASTRONAUT}/today?day=2020-01-01`)).status).toBe(422);
  });
  it("does not let astronauts choose task rewards", async () => {
    const created = await call("POST", "/tasks", { body: { title: "Free XP", points: 9999 } });
    expect(created.data.points).toBe(10);
  });
});

// ---------- tutorials ----------
describe("tutorials", () => {
  it("lists tutorials from D1 and awards completion once", async () => {
    const list = await call("GET", "/tutorials");
    expect(list.data).toHaveLength(10);
    expect(list.data[0]).toMatchObject({ id: "bp-cuff", points: 30, video_url: null });
    expect(Array.isArray(list.data[0].steps)).toBe(true);
    expect((await call("POST", "/tutorials/bp-cuff/complete", { body: {} })).data.points_awarded).toBe(30);
    expect((await call("POST", "/tutorials/bp-cuff/complete", { body: {} })).data).toMatchObject({ already: true, points_awarded: 0 });
    expect((await call("GET", `/users/${ASTRONAUT}/tutorials`)).data).toHaveLength(1);
    expect((await call("POST", "/tutorials/nope/complete", { body: {} })).status).toBe(404);
  });
});

// ---------- settings ----------
describe("settings", () => {
  it("returns defaults, then saves validated changes", async () => {
    expect((await call("GET", `/users/${ASTRONAUT}/settings`)).data).toMatchObject({ water_goal_ml: 2500, reduced_motion: false });
    expect((await call("PATCH", `/users/${ASTRONAUT}/settings`, { body: { water_goal_ml: 99999 } })).status).toBe(422);
    expect((await call("PATCH", `/users/${ASTRONAUT}/settings`, { body: { water_goal_ml: 3000, color_mode: "dark" } })).status).toBe(200);
    expect((await call("GET", `/users/${ASTRONAUT}/settings`)).data).toMatchObject({ water_goal_ml: 3000, color_mode: "dark" });
  });
});

// ---------- alerts ----------
describe("alerts", () => {
  it("leaves escalated alerts for the flight surgeon", async () => {
    const raw: DatabaseSync = env.DB.raw;
    const add = raw.prepare("INSERT INTO alerts (user_id, ts, level, message, escalate) VALUES (?,?,?,?,?) RETURNING id");
    const red = (add.get(ASTRONAUT, new Date().toISOString(), "red", "Body temperature is 38.4", 1) as any).id;
    const yellow = (add.get(ASTRONAUT, new Date().toISOString(), "yellow", "SpO2 is 94", 0) as any).id;
    expect((await call("POST", `/alerts/${red}/ack`, { body: {} })).status).toBe(403);
    expect((await call("POST", `/alerts/${yellow}/ack`, { body: {} })).status).toBe(200);
  });
});

// ---------- journal ----------
describe("journal chat", () => {
  it("stores both sides, escalates urgent language and is idempotent", async () => {
    const id = crypto.randomUUID();
    const sent = await call("POST", "/journal/messages", { body: { id, content: "I want to end it all" } });
    expect(sent.status).toBe(201);
    expect(sent.data.reply.content).toContain("crew support team");
    await settle(); // the analysis (and its staff alert) runs after the response
    const raw: DatabaseSync = env.DB.raw;
    expect((raw.prepare("SELECT COUNT(*) n FROM alerts WHERE user_id=? AND metric='journal' AND level='red'").get(ASTRONAUT) as any).n).toBe(1);
    const history = await call("GET", `/users/${ASTRONAUT}/journal/messages`);
    expect(history.data.map((m: any) => m.sender)).toEqual(["user", "assistant"]);
    expect((await call("POST", "/journal/messages", { body: { id, content: "again" } })).data.duplicate).toBe(true);
    expect((await call("POST", "/journal/messages", { token: "other", body: { id, content: "steal" } })).status).toBe(409);
  });
  it("leaves the mood check-in task for the mood rating", async () => {
    await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Quiet day on station." } });
    const after = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(after.data.tasks.find((t: any) => t.task_key === "p-mood").completed_at).toBeNull();
    expect(after.data.points).toBe(0);
  });
});

// ---------- account deletion ----------
describe("delete my account", () => {
  it("removes the web-app tables too", async () => {
    await call("PATCH", `/users/${ASTRONAUT}/settings`, { body: { water_goal_ml: 2500 } });
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Last entry." } });
    const raw: DatabaseSync = env.DB.raw;
    raw.prepare("INSERT INTO tutorial_progress (user_id, tutorial_id) SELECT ?, id FROM tutorials LIMIT 1").run(ASTRONAUT);
    raw.exec("PRAGMA foreign_keys = OFF"); // the delete list must not rely on cascades
    expect((await call("DELETE", "/me", { body: { confirm: "DELETE" } })).status).toBe(200);
    for (const table of ["journal_messages", "user_settings", "tutorial_progress", "tasks", "users"]) {
      expect((raw.prepare(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`).get(ASTRONAUT) as any).n, table).toBe(0);
    }
    expect((raw.prepare("SELECT COUNT(*) n FROM users WHERE user_id=?").get(OTHER) as any).n).toBe(1);
  });
});

// ---------- nutrition XP ----------
describe("nutrition rewards", () => {
  it("caps meal XP per day and never awards for removing water", async () => {
    const meal = () => call("POST", "/meals", { body: { name: "Tortilla", grams: 50, macros: { kcal: 150, protein: 4, carbs: 26, fat: 4 } } });
    const awarded = [];
    for (let i = 0; i < 8; i++) awarded.push((await meal()).data.points_awarded);
    expect(awarded).toEqual([10, 10, 10, 10, 10, 10, 0, 0]);
    expect((await call("POST", "/hydration", { body: { amount_ml: 250 } })).data.points_awarded).toBe(5);
    expect((await call("POST", "/hydration", { body: { amount_ml: -250 } })).data.points_awarded).toBe(0);
  });
  it("pays a measurement task once and caps the per-reading bonus", async () => {
    await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    for (let i = 0; i < 15; i++) expect((await call("POST", "/self-reports", { body: { mood: 4 } })).status).toBe(201);
    const after = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(after.data.tasks.find((t: any) => t.task_key === "p-mood").completed_at).toBeTruthy();
    expect(after.data.points).toBe(25 + 12 * 5);
  });
});

// ---------- food search ----------
describe("food search", () => {
  it("searches the pantry and Open Food Facts without exposing keys", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo) => {
      requested.push(String(input));
      return Response.json({ products: [{ code: "123", product_name: "Tortilla wrap", brands: "Acme", nutriments: { "energy-kcal_100g": 300, proteins_100g: 8, carbohydrates_100g: 50, fat_100g: 7 } }] });
    });
    const res = await call("GET", "/foods/search?q=tortilla");
    expect(res.data.map((f: any) => f.id)).toEqual(expect.arrayContaining(["off-123"]));
    expect(res.data[0].source).toBe("space_pantry");
    expect(requested.every((u) => !u.includes("api_key"))).toBe(true);
    expect((await call("GET", "/foods/search?q=a")).status).toBe(422);
  });
});

describe("synthetic simulation", () => {
  it("checks the admin role and simulates only seeded or explicitly synthetic astronauts", async () => {
    const raw: DatabaseSync = env.DB.raw;
    const demo = "00000000-0000-4000-8000-00000000d001";
    const demoStaff = "00000000-0000-4000-8000-00000000d002";
    raw.exec("ALTER TABLE users ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0");
    raw.prepare("UPDATE users SET synthetic=1 WHERE user_id=?").run(OTHER);
    raw.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(SURGEON);
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    await env.SESSIONS.put("sess:" + await sha256("sim-admin"), JSON.stringify({
      user_id: SURGEON, role: "admin", provider: "cloudflare_access_staff", audience: "staff",
    }));
    const old = "2000-01-01T00:00:00.000Z";
    const insert = raw.prepare("INSERT INTO observations (user_id,metric,value,unit,ts,source,simulation_source) VALUES (?,'heart_rate',70,'bpm',?,'synthetic','simulated')");
    insert.run(demo, old);
    insert.run(ASTRONAUT, old);
    const readReal = () => raw.prepare("SELECT * FROM observations WHERE user_id=?").all(ASTRONAUT);
    const before = readReal();
    expect((await call("POST", "/admin/simulate")).status).toBe(403);
    const refreshed = await call("POST", "/admin/simulate", { token: "sim-admin" });
    expect(refreshed.status).toBe(200);
    expect(refreshed.data).toMatchObject({ astronauts: 2, model_failures: 0 });
    expect(readReal()).toEqual(before);
    expect(raw.prepare("SELECT 1 FROM observations WHERE user_id=? AND ts=?").get(demo, old)).toBeUndefined();
    expect(raw.prepare("SELECT 1 FROM observations WHERE user_id=?").get(demoStaff)).toBeUndefined();
    const count = () => raw.prepare("SELECT count(*) AS n FROM observations WHERE simulation_source='simulated'").get();
    const firstCount = count();
    await call("POST", "/admin/simulate", { token: "sim-admin" });
    expect(count()).toEqual(firstCount);
    const observations = await call("GET", "/users/" + OTHER + "/observations", { token: "other" });
    expect(observations.data.some((row: { source: string }) => row.source === "simulated")).toBe(true);
    for (const table of ["meals", "hydration", "radiation_doses", "risk_scores"]) {
      expect(raw.prepare("SELECT 1 FROM " + table + " WHERE user_id=? AND source='simulated'").get(demo), table).toBeDefined();
    }
  });

  it("runs on the quarter-hour schedule and stores model results with synthetic provenance", async () => {
    const id = "00000000-0000-4000-8000-00000000d001";
    const scheduledTime = Date.parse("2026-11-15T15:00:00Z");
    const pending: Promise<unknown>[] = [];
    const requested: [string, Record<string, unknown>][] = [];
    vi.stubGlobal("fetch", async () => Response.json([]));
    env.MODEL_GATEWAY_KEY = crypto.randomUUID();
    env.MODELS = {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        const input = await request.json() as Record<string, unknown>;
        requested.push([path, input]);
        if (path === "/v1/users") return Response.json({ data: { user_id: "model-simulation-fixture" } });
        if (path === "/v1/predict/risk") return Response.json({ data: { risk: { r: 0.4, band: "elevated" }, mdtr: { display: "60" } } });
        return Response.json({ data: { radiation: { level: "yellow" } } });
      },
    };
    const run = (scheduled = scheduledTime) => worker.scheduled(
      { scheduledTime: scheduled, cron: "*/15 * * * *", noRetry: () => {} },
      env,
      { ...ctx, waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    );
    await run();
    await Promise.all(pending.splice(0));
    await run();
    await Promise.all(pending.splice(0));
    await run(scheduledTime + 15 * 60_000);
    await Promise.all(pending.splice(0));
    expect(requested.map(([path]) => path).sort()).toEqual([
      "/v1/predict/ecg-deep", "/v1/predict/radiation-risk", "/v1/predict/risk", "/v1/predict/sleep-deep", "/v1/users",
    ]);
      expect(requested.find(([path]) => path === "/v1/users")?.[1]).toEqual({ consent: true, cohort: "demo" });
    expect(requested.slice(1).every(([, input]) => input.user_id === "model-simulation-fixture")).toBe(true);
    expect(requested.find(([path]) => path.endsWith("/ecg-deep"))?.[1]).toMatchObject({ fs_hz: 100, source: "simulated" });
    expect(requested.find(([path]) => path.endsWith("/sleep-deep"))?.[1]).toMatchObject({ fs_hz: 100, source: "simulated" });
    const raw: DatabaseSync = env.DB.raw;
    expect(raw.prepare("SELECT endpoint FROM model_results WHERE user_id=? AND source='simulated'").all(id)).toHaveLength(4);
    expect(raw.prepare("SELECT r,mdtr FROM risk_scores WHERE user_id=? AND source='simulated'").get(id))
      .toMatchObject({ r: 0.4, mdtr: "60" });
    const doses = raw.prepare("SELECT cumulative_msv FROM radiation_doses WHERE user_id=? AND source='simulated' ORDER BY ts").all(id);
    expect(doses.length).toBeGreaterThan(1);
    expect(doses.every((row, i) => i === 0 || Number(row.cumulative_msv) >= Number(doses[i - 1].cumulative_msv))).toBe(true);
    expect(raw.prepare("SELECT 1 FROM alerts WHERE user_id=? AND level='red' AND simulation_source='simulated'").get(id)).toBeDefined();
  });

  it("generates both deep predictions on manual refresh and omits upstream placeholders", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-15T15:15:00Z"));
    try {
      const raw: DatabaseSync = env.DB.raw;
      raw.prepare("UPDATE users SET role='admin' WHERE user_id=?").run(SURGEON);
      Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff", MODEL_GATEWAY_KEY: crypto.randomUUID() });
      await env.SESSIONS.put("sess:" + await sha256("deep-admin"), JSON.stringify({
        user_id: SURGEON, role: "admin", provider: "cloudflare_access_staff", audience: "staff",
      }));
      const requested: string[] = [];
      env.MODELS = { fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        requested.push(path);
        if (path === "/v1/users") return Response.json({ data: { user_id: "manual-fixture" } });
        if (path.endsWith("/sleep-deep")) return Response.json({ data: { source: "mock" } });
        return Response.json({ data: { source: "model", model_id: "EVA-13" } });
      } };
      const res = await call("POST", "/admin/simulate", { token: "deep-admin" });
      expect(res.status).toBe(200);
      expect(requested).toEqual(expect.arrayContaining(["/v1/predict/ecg-deep", "/v1/predict/sleep-deep"]));
      expect(raw.prepare("SELECT source FROM model_results WHERE endpoint='/v1/predict/ecg-deep'").get()).toEqual({ source: "simulated" });
      expect(raw.prepare("SELECT source FROM model_results WHERE endpoint='/v1/predict/sleep-deep'").get()).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("staff deep model results", () => {
  it("returns the latest row per model with a sanitized sleep breakdown and preserves the staff gate", async () => {
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    await env.SESSIONS.put("sess:" + await sha256("deep-staff"), JSON.stringify({
      user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access_staff", audience: "staff",
    }));
    const raw: DatabaseSync = env.DB.raw;
    const insert = raw.prepare("INSERT INTO model_results (user_id,endpoint,model_id,ts,output,source) VALUES (?,?,?,?,?,?)");
    const ecg = "/v1/predict/ecg-deep";
    const sleep = "/v1/predict/sleep-deep";
    const older = "2026-11-15T13:00:00Z";
    const recent = "2026-11-15T14:00:00Z";
    insert.run(ASTRONAUT, ecg, "old ECG", older, "{}", "model");
    insert.run(OTHER, ecg, "other user's ECG", "2026-11-15T15:00:00Z", "{}", "model");
    insert.run(ASTRONAUT, ecg, "EVA-13", recent, JSON.stringify({ data: {
      source: "model", threshold_source: "default", top_classes: [{ class: "MI", probability: 0.91 }], probabilities: { MI: 0.91 },
    } }), "simulated");
    const stages = { W: 0, N1: 0.5, N2: 2, N3: 1.5, REM: 1 };
    insert.run(ASTRONAUT, sleep, "EVA-14", older, JSON.stringify({ user_id: "internal-id", data: {
      source: "model", summary: { minutes_per_stage: stages },
      epochs: [{ stage: "N2", probabilities: { N2: 0.8 } }, { stage: "REM", probabilities: { REM: 0.6 } }],
    } }), "simulated");
    const path = "/admin/astronauts/" + ASTRONAUT + "/deep-model-results";
    expect((await call("GET", path)).status).toBe(403);
    const res = await call("GET", path, { token: "deep-staff" });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({
      "ecg-deep": { status: "result", model_id: "EVA-13", ts: recent, flag: "No calibrated flag", confidence: "0.910" },
      "sleep-deep": { status: "result", model_id: "EVA-14", ts: older, source: "simulated", confidence: "0.700", minutes_per_stage: stages },
    });
    expect(JSON.stringify(res.data)).not.toContain("internal-id");
    insert.run(ASTRONAUT, sleep, null, recent, '{"data":{"source":"mock"}}', "model");
    expect((await call("GET", path, { token: "deep-staff" })).data["sleep-deep"]).toEqual({ status: "placeholder" });
  });
});

// ---------- surgeon contact, manual logging, AI summary ----------
describe("surgeon requests, manual readings and the 24-hour summary", () => {
  const surgeonSession = async () =>
    env.SESSIONS.put(`sess:${await sha256("surgeon")}`, JSON.stringify({ user_id: SURGEON, role: "flight_surgeon", email: null, provider: "cloudflare_access" }));
  const surgeonInbox = () => env.DB.raw.prepare(
    "SELECT m.body FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.astronaut_id=? AND c.surgeon_id=?",
  ).all(ASTRONAUT, SURGEON) as { body: string }[];

  it("delivers a voice request to every flight surgeon once, and opens an emergency when urgent", async () => {
    const routine = await call("POST", "/surgeon-requests", { body: { client_id: "voice:1", message: "Please ask the surgeon about my sleep meds." } });
    expect(routine.status).toBe(201);
    expect(routine.data.delivered_to).toBeGreaterThanOrEqual(1);
    expect(routine.data.urgent).toBe(false);
    const again = await call("POST", "/surgeon-requests", { body: { client_id: "voice:1", message: "Please ask the surgeon about my sleep meds." } });
    expect(again.data.duplicate).toBe(true);
    expect(surgeonInbox()).toHaveLength(1);

    const urgent = await call("POST", "/surgeon-requests", { body: { client_id: "voice:2", message: "I have chest pain, call the flight surgeon." } });
    expect(urgent.data.urgent).toBe(true);
    expect(urgent.data.emergency_id).toBeTruthy();
    expect(env.DB.raw.prepare("SELECT status FROM emergencies WHERE user_id=?").get(ASTRONAUT)).toMatchObject({ status: "open" });
    expect(surgeonInbox()).toHaveLength(2);
  });

  it("only lets an astronaut contact the surgeon for themselves", async () => {
    await surgeonSession();
    expect((await call("POST", "/surgeon-requests", { token: "surgeon", body: { client_id: "x" } })).status).toBe(403);
  });

  it("forwards a typed journal message that asks for the surgeon, and confirms it in the reply", async () => {
    const res = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Can you tell the flight surgeon my headache is back?" } });
    expect(res.status).toBe(201);
    expect(res.data.reply.content).toContain("flight surgeon");
    expect(surgeonInbox()[0].body).toContain("headache is back");
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Quiet day, watched Earth." } });
    expect(surgeonInbox()).toHaveLength(1);
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Please let the flight surgeon know my back aches." } });
    expect(surgeonInbox()).toHaveLength(2);
  });

  it("continues the radiation running total for a typed daily dose", async () => {
    env.DB.raw.prepare("INSERT INTO radiation_doses (user_id, ts, daily_dose_msv, cumulative_msv, source) VALUES (?,?,?,?,?)")
      .run(ASTRONAUT, new Date(Date.now() - 864e5).toISOString(), 0.5, 40, "dosimeter");
    const res = await call("POST", "/radiation", { body: { daily_dose_msv: 0.6, source: "manual", client_id: "manual-1" } });
    expect(res.status).toBe(201);
    expect(res.data.cumulative_msv).toBe(40.6);
    expect(res.data.stored[0].metric).toBe("daily_radiation_msv");
    expect(env.DB.raw.prepare("SELECT source FROM observations WHERE user_id=? AND metric='daily_radiation_msv'").get(ASTRONAUT)).toMatchObject({ source: "manual" });
  });

  it("returns stored manual readings with the XP awarded", async () => {
    const res = await call("POST", "/observations", { body: { observations: [{ metric: "heart_rate", value: 64, ts: new Date().toISOString(), source: "manual", client_id: "hr-1" }] } });
    expect(res.status).toBe(201);
    expect(res.data.stored[0]).toMatchObject({ metric: "heart_rate", level: expect.any(String) });
    expect(typeof res.data.points_awarded).toBe("number");
  });

  it("summarizes the last 24 hours for the flight surgeon only (rules when AI is unavailable)", async () => {
    await surgeonSession();
    await call("POST", "/observations", { body: { observations: [{ metric: "heart_rate", value: 140, ts: new Date().toISOString(), source: "manual", client_id: "hr-2" }] } });
    const summary = await call("GET", `/admin/astronauts/${ASTRONAUT}/summary`, { token: "surgeon" });
    expect(summary.status).toBe(200);
    expect(summary.data.bullets.length).toBeGreaterThan(0);
    expect(summary.data.bullets[0]).toContain("heart rate");
    expect((await call("GET", `/admin/astronauts/${ASTRONAUT}/summary`)).status).toBe(403);
  });
});

describe("emergency requests reach the crew overview as critical", () => {
  const surgeonSession = async () =>
    env.SESSIONS.put(`sess:${await sha256("surgeon")}`, JSON.stringify({ user_id: SURGEON, role: "flight_surgeon", email: null, provider: "cloudflare_access" }));
  const crewRow = async () => (await call("GET", "/admin/crew", { token: "surgeon" })).data.find((r: any) => r.user_id === ASTRONAUT);

  it("treats a spoken 'they thought I was dying, call 911' as an emergency and shows it on the crew card", async () => {
    await surgeonSession();
    const said = 'Astronaut said: "My crewmates thought I was in a coma and dying. Call 911."';
    const res = await call("POST", "/surgeon-requests", { body: { client_id: "voice:911", message: said } });
    expect(res.data.urgent).toBe(true);
    expect(res.data.emergency_id).toBeTruthy();
    const row = await crewRow();
    expect(row.status).toBe("critical");
    expect(row.critical_issue).toMatchObject({ kind: "emergency" });
    expect(row.critical_issue.message).toContain("Call 911");
  });

  it("keeps the open emergency but shows the newest urgent issue", async () => {
    await surgeonSession();
    await call("POST", "/surgeon-requests", { body: { client_id: "v:a", message: "I have chest pain." } });
    await call("POST", "/surgeon-requests", { body: { client_id: "v:b", message: "Now I can't feel my left arm." } });
    expect(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM emergencies WHERE user_id=?").get(ASTRONAUT)).toMatchObject({ n: 1 });
    expect((await crewRow()).critical_issue.message).toContain("left arm");
  });

  it("asks the AI to triage speech the word rules miss, and escalates when it says urgent", async () => {
    await surgeonSession();
    env.XAI_API_KEY = XAI_KEY;
    const requests = stubGrok(() => '{"urgent":true}');
    const res = await call("POST", "/surgeon-requests", { body: { client_id: "v:ai", message: "Everything went grey and I woke up on the floor of the node." } });
    expect(requests.filter((r) => r.body.response_format?.json_schema?.name === "urgency_triage")).toHaveLength(1);
    expect(res.data.urgent).toBe(true);
    expect((await crewRow()).status).toBe("critical");
  });

  it("opens an emergency from a typed journal message that describes one", async () => {
    await surgeonSession();
    const res = await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "I hit my head on the hatch and I'm bleeding badly." } });
    expect(res.data.reply.content).toContain("urgent");
    expect((await crewRow()).critical_issue.message).toContain("hit my head");
  });

  it("does not treat everyday phrases as emergencies", async () => {
    const res = await call("POST", "/surgeon-requests", { body: { client_id: "v:calm", message: "Tell the surgeon I'm dying to see Earth again and my back is a bit sore." } });
    expect(res.data.urgent).toBe(false);
  });
});
