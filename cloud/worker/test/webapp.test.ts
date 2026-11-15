// Web app route tests: the real Worker fetch handler, real D1 schema (migrations in node:sqlite), in-memory KV.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
const { default: worker } = await import("../src/index");
const { streakFrom, trackingDay, weekStart, settingsPatch, voiceSavedReply } = await import("../src/webapp");

const API = "https://api.evade.health";
const FRONTEND = "https://evade.health";
const ASTRONAUT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SURGEON = "33333333-3333-4333-8333-333333333333";

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
  it("keeps tasks that have no template (LEFT JOIN) instead of dropping them", async () => {
    const raw: DatabaseSync = env.DB.raw;
    const now = new Date().toISOString();
    raw.prepare("INSERT INTO tasks (user_id, title, category, metric, recurrence, points, due_at) VALUES (?,?,?,?,?,?,?)")
      .run(ASTRONAUT, "Legacy: log sleep", "basic", "sleep_hours", "daily", 10, now);
    raw.prepare("INSERT INTO tasks (user_id, title, category, metric, recurrence, points, due_at) VALUES (?,?,?,?,?,?,?)")
      .run(ASTRONAUT, "Old and overdue", "basic", null, "daily", 10, "2020-01-01T00:00:00.000Z");
    const res = await call("GET", `/users/${ASTRONAUT}/today?day=${today()}`);
    expect(res.data.tasks).toHaveLength(15);
    expect(res.data.tasks.at(-1)).toMatchObject({ title: "Legacy: log sleep", kind: "basic", task_key: expect.stringMatching(/^task-\d+$/) });
    expect(res.data.tasks.map((t: any) => t.title)).not.toContain("Old and overdue");
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
  it("shows journal entries saved outside the chat (POST /journal, voice, sync) in the chat history", async () => {
    const raw: DatabaseSync = env.DB.raw;
    raw.prepare("INSERT INTO journal_entries (user_id, ts, source, content, ai_summary, mood_label) VALUES (?,?,?,?,?,?)")
      .run(ASTRONAUT, "2026-11-10T08:00:00.000Z", "voice", "Voice note from the cupola.", "Calm, reflective entry.", "calm");
    raw.prepare("INSERT INTO journal_entries (user_id, ts, source, content) VALUES (?,?,?,?)")
      .run(ASTRONAUT, "2026-11-11T08:00:00.000Z", "text", "Synced from the tablet.");
    await call("POST", "/journal/messages", { body: { id: crypto.randomUUID(), content: "Typed in the chat." } });
    const history = await call("GET", `/users/${ASTRONAUT}/journal/messages`);
    const contents = history.data.map((m: any) => m.content);
    expect(contents.slice(0, 2)).toEqual(["Voice note from the cupola.", "Synced from the tablet."]);
    // The analysis (summary, mood label) is for the flight surgeon only and never shown back in the astronaut's chat.
    expect(contents.join("\n")).not.toContain("Calm, reflective entry.");
    expect(contents.join("\n")).not.toContain("Mood: calm");
    expect(contents).toContain("Typed in the chat.");
    expect(contents.filter((c: string) => c === "Typed in the chat.")).toHaveLength(1); // chat entries are not duplicated
    expect((await call("GET", `/users/${ASTRONAUT}/journal/messages`, { token: "other" })).status).toBe(403);
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

// ---------- both route sets ----------
describe("web app routes and staff/demo routes", () => {
  it("registers the website routes and the staff console and demo sign-in", async () => {
    const web: [string, string, unknown?][] = [
      ["GET", "/tutorials"],
      ["GET", `/users/${ASTRONAUT}/today`],
      ["GET", `/users/${ASTRONAUT}/settings`],
      ["PATCH", `/users/${ASTRONAUT}/settings`, {}],
      ["GET", `/users/${ASTRONAUT}/radiation`],
      ["GET", `/users/${ASTRONAUT}/tutorials`],
      ["GET", `/users/${ASTRONAUT}/journal/messages`],
      ["POST", "/journal/messages", {}],
      ["POST", "/tutorials/bp-cuff/complete", {}],
      ["GET", `/users/${ASTRONAUT}/goals`],
    ];
    for (const [method, path, body] of web) {
      const res = await call(method, path, body === undefined ? {} : { body });
      expect(res.data?.error ?? "", `${method} ${path}`).not.toMatch(/^No route /);
    }
    const radiation = await call("GET", `/users/${ASTRONAUT}/radiation`);
    expect(radiation.status).toBe(200);
    expect(radiation.data.doses).toEqual([]);
    expect(radiation.data.limit_msv).toBeGreaterThan(0);

    const demoOff = await call("GET", "/auth/demo", { token: null });
    expect(demoOff.status).toBe(404);
    expect(demoOff.data.error).toBe("Demo sign-in is off");
    env.DEMO_LOGIN = "true";
    expect((await call("GET", "/auth/demo", { token: null })).status).toBe(302);

    const staffLogin = await worker.fetch(new Request(`${API}/auth/access/staff`), env, ctx);
    expect(staffLogin.status).toBe(503);
    expect(await staffLogin.text()).toContain("Cloudflare Access sign-in is unavailable");
    const admin = await call("GET", `/admin/astronauts/${ASTRONAUT}`);
    expect(admin.status).toBe(403);
    expect(admin.data.error).toBe("Flight surgeon / admin access only");
  });
});
