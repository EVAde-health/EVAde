// Web app route tests: the real Worker fetch handler, real D1 schema (migrations in node:sqlite), in-memory KV.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../src/index");
const { streakFrom, trackingDay, weekStart, settingsPatch, journalReply } = await import("../src/webapp");

const API = "https://api.evade.health";
const FRONTEND = "https://evade.health";
const ASTRONAUT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SURGEON = "33333333-3333-4333-8333-333333333333";

// ---------- fakes ----------
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
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
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

beforeEach(async () => {
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

describe("AI companion routes", () => {
  async function staffSession() {
    Object.assign(env, { ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com", ACCESS_AUD: "crew", ACCESS_STAFF_AUD: "staff" });
    await env.SESSIONS.put("sess:" + await sha256("companion-staff"), JSON.stringify({
      user_id: SURGEON, role: "flight_surgeon", provider: "cloudflare_access_staff", audience: "staff",
    }));
    return "companion-staff";
  }

  it("uses the configured model, persists only the user's private turns and handles retries and deletion", async () => {
    const run = vi.fn(async () => ({ response: '{"crisis":false,"tone":1,"next":0}' }));
    Object.assign(env, { AI: { run }, COMPANION_MODEL: "test-instruct-model" });
    const body = { id: crypto.randomUUID(), message: "It was a long day." };
    const created = await call("POST", "/journal/chat", { body });
    expect(created.status).toBe(201);
    expect(created.data.reply.content).toContain("How much did you sleep");
    expect(run).toHaveBeenCalledWith("test-instruct-model", expect.objectContaining({ max_tokens: 64 }));
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
    const run = vi.fn();
    env.AI = { run };
    const marker = "private-companion-test-marker";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await call("POST", "/journal/chat", { body: { message: "I want to die and I can't stay safe. " + marker } });
      expect(result.status).toBe(201);
      expect(result.data.reply.content).toContain("call or text 988");
    }
    expect(run).not.toHaveBeenCalled();
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
      env.AI = { run: () => { modelStarted(); return new Promise(() => {}); } };
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

  const summaryPath = "/admin/astronauts/" + ASTRONAUT + "/summary";
  const vitalDisplay = "Blood pressure 110–124/72–80 mmHg, Heart rate 65–76 bpm, SpO₂ 96.1–98.0%, Sleep 6.2–8.0 hours";

  function seedSummaryVitals() {
    const raw: DatabaseSync = env.DB.raw;
    const first = new Date(Date.now() - 16 * 3600_000).toISOString();
    const second = new Date(Date.now() - 1 * 3600_000).toISOString();
    const insert = raw.prepare("INSERT INTO observations (user_id,metric,value,unit,ts) VALUES (?,?,?,?,?)");
    for (const [metric, low, high] of [
      ["systolic_bp", 109.6, 124.4], ["diastolic_bp", 71.5, 79.6], ["heart_rate", 65.4, 75.6],
      ["spo2", 96.14, 97.98], ["sleep_hours", 6.15, 7.98],
    ] as const) {
      insert.run(ASTRONAUT, metric, low, "private@example.test", first);
      insert.run(ASTRONAUT, metric, high, "private@example.test", second);
    }
    insert.run(OTHER, "heart_rate", 9876, "other@example.test", second);
  }

  it("uses Workers AI for staff summaries and passes only scoped, formatted facts", async () => {
    seedSummaryVitals();
    const raw: DatabaseSync = env.DB.raw;
    raw.prepare("INSERT INTO journal_entries (user_id,ts,content,sentiment) VALUES (?,?,?,?)")
      .run(ASTRONAUT, new Date().toISOString(), "private journal content", 0.25);
    expect((await call("POST", "/journal/chat", { body: { message: "private companion content" } })).status).toBe(201);
    const run = vi.fn(async (_model: string, _input: { messages: { role: string; content: string }[] }) => ({
      response: { bullets: ["Heart rate was higher in the second half of the window.", "No alerts.", "A journal mood score was recorded."] },
    }));
    Object.assign(env, { AI: { run }, COMPANION_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });
    expect((await call("GET", summaryPath)).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
    const result = await call("GET", summaryPath, { token: await staffSession() });
    expect(result.status).toBe(200);
    expect(result.data.label).toBe("AI summary, verify against the data, not a diagnosis");
    expect(result.data.bullets).toEqual([
      vitalDisplay + ". Heart rate was higher in the second half of the window.", "No alerts.", "A journal mood score was recorded.",
    ]);
    expect(run).toHaveBeenCalledExactlyOnceWith(env.COMPANION_MODEL, expect.objectContaining({
      max_tokens: 240,
      response_format: expect.objectContaining({ type: "json_schema" }),
    }));
    const modelInput = run.mock.calls[0][1].messages[1].content;
    expect(JSON.parse(modelInput)).toMatchObject({
      vitals: {
        display: vitalDisplay,
        trends: expect.arrayContaining([
          expect.objectContaining({ label: "Heart rate", first_half_average: "65", second_half_average: "76" }),
          expect.objectContaining({ label: "SpO₂", first_half_average: "96.1", second_half_average: "98.0" }),
        ]),
      },
      journalMood: { journal_samples: 1, average_sentiment: 0.25 },
    });
    for (const excluded of ["example.test", "9876", "109.6", "97.98", "private journal content", "private companion content", ASTRONAUT, OTHER]) {
      expect(modelInput).not.toContain(excluded);
    }
  });

  it("uses the same rounded display ranges when Workers AI fails or returns unusable bullets", async () => {
    seedSummaryVitals();
    const token = await staffSession();
    const run = vi.fn()
      .mockRejectedValueOnce(new Error("Model unavailable"))
      .mockResolvedValueOnce({ response: '{"bullets":["Incomplete summary."]}' });
    env.AI = { run };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await call("GET", summaryPath, { token });
      expect(result.status).toBe(200);
      expect(result.data.bullets).toEqual([vitalDisplay + ".", "No alerts recorded.", "No journal mood score recorded."]);
    }
    expect(run).toHaveBeenCalledTimes(2);
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
  it("never shows concern scores in the journal reply", () => {
    const reply = journalReply({ summary: "A hard day.", mood_label: "low", needs_human_review: true });
    expect(reply).toContain("crew support team");
    expect(reply).not.toMatch(/concern|high|score/i);
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
    const run = () => worker.scheduled(
      { scheduledTime, cron: "*/15 * * * *", noRetry: () => {} },
      env,
      { ...ctx, waitUntil: (promise: Promise<unknown>) => pending.push(promise) },
    );
    await run();
    await Promise.all(pending.splice(0));
    await run();
    await Promise.all(pending.splice(0));
    expect(requested.map(([path]) => path).sort()).toEqual(["/v1/predict/radiation-risk", "/v1/predict/risk", "/v1/users"]);
    expect(requested.slice(1).map(([, input]) => input.user_id)).toEqual(["model-simulation-fixture", "model-simulation-fixture"]);
    const raw: DatabaseSync = env.DB.raw;
    expect(raw.prepare("SELECT endpoint FROM model_results WHERE user_id=? AND source='simulated'").all(id)).toHaveLength(2);
    expect(raw.prepare("SELECT r,mdtr FROM risk_scores WHERE user_id=? AND source='simulated'").get(id))
      .toMatchObject({ r: 0.4, mdtr: "60" });
    const doses = raw.prepare("SELECT cumulative_msv FROM radiation_doses WHERE user_id=? AND source='simulated' ORDER BY ts").all(id);
    expect(doses.length).toBeGreaterThan(1);
    expect(doses.every((row, i) => i === 0 || Number(row.cumulative_msv) >= Number(doses[i - 1].cumulative_msv))).toBe(true);
    expect(raw.prepare("SELECT 1 FROM alerts WHERE user_id=? AND level='red' AND simulation_source='simulated'").get(id)).toBeDefined();
  });
});
