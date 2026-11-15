// Flight-surgeon console through the real Worker (src/index.ts) on a node:sqlite D1 built from every migration:
// role enforcement, 1:1 messages, emergencies seen by two surgeons, goals with astronaut notes, vital corrections.
// The D1 role decides access on every request (one sign-in for everyone; FLIGHT_SURGEON_EMAILS can promote).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

vi.mock("../src/live", () => ({ CrewFeed: class {} }));

const API = "https://api.evade.health";
const SURGEON = "11111111-1111-4111-8111-111111111111";
const SURGEON2 = "22222222-2222-4222-8222-222222222222";
const NOVA = "33333333-3333-4333-8333-333333333333";
const KEPLER = "44444444-4444-4444-8444-444444444444";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  // 0008 deletes the seeded demo astronaut. Keep the file, but do not apply it.
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql") && name !== "0008_remove_demo_data.sql").sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  const stmt = (sql: string, args: unknown[] = []) => ({
    execute: () => {
      if (/\bRETURNING\b/i.test(sql)) return { success: true, results: db.prepare(sql).all(...(args as any[])), meta: {} };
      return { success: true, results: [], meta: db.prepare(sql).run(...(args as any[])) };
    },
    bind: (...bound: unknown[]) => stmt(sql, bound),
    first: async (col?: string) => {
      const row = db.prepare(sql).get(...(args as any[])) as any;
      return row === undefined ? null : col ? row[col] : row;
    },
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    run: async () => ({ success: true, meta: db.prepare(sql).run(...(args as any[])) }),
  });
  return {
    db,
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: ReturnType<typeof stmt>[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function fakeKV() {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      return value === undefined ? null : type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
  };
}

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let env: Env;
let db: DatabaseSync;

beforeEach(() => {
  const database = fakeD1();
  db = database.db;
  env = {
    DB: database as unknown as D1Database,
    SESSIONS: fakeKV() as unknown as KVNamespace,
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ACCESS_TEAM_DOMAIN: "evade-health.cloudflareaccess.com",
    ACCESS_AUD: "aud-login-123",
    ALLOWED_ORIGINS: "https://evade.health",
    FRONTEND_URL: "https://evade.health",
    DEMO_LOGIN: "true",
  };
  const insertUser = db.prepare("INSERT INTO users (user_id, display_name, role, mission_name) VALUES (?,?,?,?)");
  insertUser.run(SURGEON, "Hale", "flight_surgeon", "Expedition 74");
  insertUser.run(SURGEON2, "Dr. Moss", "flight_surgeon", "Expedition 74");
  insertUser.run(NOVA, "Nova", "astronaut", "Expedition 74");
  insertUser.run(KEPLER, "Kepler", "astronaut", "Expedition 74");
  const identity = db.prepare("INSERT INTO auth_identities (provider, subject, user_id) VALUES (?,?,?)");
  for (const [subject, userId] of [["surgeon-fixture", SURGEON], ["surgeon2-fixture", SURGEON2]]) identity.run("cloudflare_access", subject, userId);
  db.prepare("UPDATE users SET full_name='Grace Hale' WHERE user_id=?").run(SURGEON);
  const insertObservation = db.prepare("INSERT INTO observations (user_id, metric, value, unit, ts, source, level) VALUES (?,?,?,?,?,?,?)");
  const ts = new Date().toISOString();
  insertObservation.run(NOVA, "heart_rate", 72, "bpm", ts, "manual", "green");
  insertObservation.run(NOVA, "sleep_hours", 7.5, "hours", ts, "manual", "green");
});

async function session(userId: string, role: string, provider: string, audience?: string) {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`sess:${await sha256(token)}`, JSON.stringify({
    user_id: userId, role, email: null, provider, audience, expires: Date.now() + 3600_000,
  }));
  return token;
}

const ctx = { waitUntil() {}, passThroughOnException() {} } as any;
async function call(method: string, path: string, token: string | null, body?: unknown) {
  const headers = new Headers({ Origin: "https://evade.health" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await worker.fetch(new Request(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env, ctx);
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

const asSurgeon = () => session(SURGEON, "flight_surgeon", "cloudflare_access");
const asSurgeon2 = () => session(SURGEON2, "flight_surgeon", "cloudflare_access");
const asNova = () => session(NOVA, "astronaut", "cloudflare_access");
const asKepler = () => session(KEPLER, "astronaut", "cloudflare_access");
const SURGEON_GETS = [
  "/admin/crew", "/admin/astronauts", `/admin/astronauts/${NOVA}`, `/admin/astronauts/${NOVA}/series?group=vitals`,
  `/admin/astronauts/${NOVA}/journal`, `/admin/astronauts/${NOVA}/tasks`, `/admin/astronauts/${NOVA}/goals`,
  `/admin/astronauts/${NOVA}/observations`, `/admin/astronauts/${NOVA}/corrections`, "/admin/emergencies", "/admin/notifications",
];

describe("role enforcement", () => {
  it("returns 403 on every surgeon endpoint for an astronaut and 200 for a flight surgeon", async () => {
    const nova = await asNova();
    const surgeon = await asSurgeon();
    for (const path of SURGEON_GETS) {
      expect([path, (await call("GET", path, nova)).status]).toEqual([path, 403]);
      expect([path, (await call("GET", path, surgeon)).status]).toEqual([path, 200]);
    }
    expect((await call("POST", `/admin/astronauts/${NOVA}/goals`, nova, { goal_type: "water_ml", target: 3000 })).status).toBe(403);
    expect((await call("POST", "/admin/observations/1/correct", nova, { value: 70, reason: "nope" })).status).toBe(403);
    expect((await call("GET", "/admin/crew", null)).status).toBe(401);
  });

  it("ignores the role stored in the session and uses D1 (a crew Access session for a promoted user is staff)", async () => {
    const forged = await session(NOVA, "flight_surgeon", "cloudflare_access");
    expect((await call("GET", "/admin/crew", forged)).status).toBe(403);
  });

  it("lists every astronaut (not staff) on the crew overview, scaling past 20 people", async () => {
    const insert = db.prepare("INSERT INTO users (user_id, display_name, role) VALUES (?,?, 'astronaut')");
    for (let i = 0; i < 25; i++) insert.run(`crew-${i}`, `Crew ${String(i).padStart(2, "0")}`);
    const response = await call("GET", "/admin/crew", await asSurgeon());
    const rows = response.payload as { user_id: string; display_name: string; status: string; progress: unknown; vitals: Record<string, { value: number }> }[];
    const names = rows.map((row) => row.display_name);
    expect(names).toContain("Nova");
    expect(names).not.toContain("Hale");
    expect(rows.filter((row) => row.user_id.startsWith("crew-"))).toHaveLength(25);
    expect(rows.find((row) => row.user_id === NOVA)?.vitals.heart_rate.value).toBe(72);
    const picker = await call("GET", "/admin/astronauts", await asSurgeon());
    expect((picker.payload as unknown[]).length).toBe(rows.length);
  });
});

describe("goals", () => {
  it("records each change as a new row, the latest wins, and the astronaut gets a note", async () => {
    const surgeon = await asSurgeon();
    const nova = await asNova();
    const before = await call("GET", `/users/${NOVA}/goals`, nova);
    expect((before.payload as any).goals.find((g: any) => g.goal_type === "water_ml")).toMatchObject({ target: 2500, source: "default" });
    expect((await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { goal_type: "water_ml", target: 100 })).status).toBe(422);
    expect((await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { goal_type: "nope", target: 100 })).status).toBe(422);
    expect((await call("POST", `/admin/astronauts/${SURGEON2}/goals`, surgeon, { goal_type: "water_ml", target: 3000 })).status).toBe(422);
    const first = await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { goal_type: "water_ml", target: 3000 });
    expect(first.status).toBe(201);
    const second = await call("POST", `/admin/astronauts/${NOVA}/goals`, await asSurgeon2(), {
      changes: [{ goal_type: "water_ml", target: 3200 }, { goal_type: "calories", target: 3000 }], note: "EVA week",
    });
    expect((second.payload as any).changed).toEqual(["water_ml", "calories"]);
    const unchanged = await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { goal_type: "calories", target: 3000 });
    expect((unchanged.payload as any).changed).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM user_goals WHERE user_id=?").get(NOVA)).toEqual({ n: 3 });

    const own = await call("GET", `/users/${NOVA}/goals`, nova);
    expect((own.payload as any).goals.find((g: any) => g.goal_type === "water_ml")).toMatchObject({ target: 3200, source: "surgeon", set_by_name: "Dr. Moss" });
    const history = await call("GET", `/admin/astronauts/${NOVA}/goals`, surgeon);
    expect((history.payload as any).history.map((h: any) => h.target)).toEqual(expect.arrayContaining([3000, 3200]));
    // Astronaut-side logic reads the goals: settings and the dashboard/nutrition targets.
    const settings = await call("GET", `/users/${NOVA}/settings`, nova);
    expect(settings.payload).toMatchObject({ water_goal_ml: 3200, kcal_goal: 3000 });

    const notes = await call("GET", "/me/notifications", nova);
    const bodies = (notes.payload as any).notifications.map((n: any) => n.body);
    expect(bodies).toContain("Dr. Hale updated your water goal to 3,000 ml.");
    expect(bodies).toContain("Dr. Moss updated your water goal to 3,200 ml. Note: EVA week");
    expect((notes.payload as any).unread).toBe(3);
    expect((await call("POST", "/me/notifications/read", nova, {})).status).toBe(204);
    expect(((await call("GET", "/me/notifications", nova)).payload as any).unread).toBe(0);
    expect((await call("GET", `/users/${KEPLER}/goals`, nova)).status).toBe(403);
  });

  it("an astronaut's own settings change is also a goal row and wins until a surgeon changes it", async () => {
    const nova = await asNova();
    expect((await call("PATCH", `/users/${NOVA}/settings`, nova, { water_goal_ml: 2800 })).status).toBe(200);
    const own = await call("GET", `/users/${NOVA}/goals`, nova);
    expect((own.payload as any).goals.find((g: any) => g.goal_type === "water_ml")).toMatchObject({ target: 2800, source: "self" });
    await call("POST", `/admin/astronauts/${NOVA}/goals`, await asSurgeon(), { goal_type: "water_ml", target: 3000 });
    expect(((await call("GET", `/users/${NOVA}/settings`, nova)).payload as any).water_goal_ml).toBe(3000);
  });
});

describe("vital corrections", () => {
  it("corrects a vital with an audit row (original, corrected, who, when, reason) and tells the astronaut", async () => {
    const surgeon = await asSurgeon();
    const nova = await asNova();
    const obs = db.prepare("SELECT id FROM observations WHERE user_id=? AND metric='heart_rate'").get(NOVA) as { id: number };
    expect((await call("POST", `/admin/observations/${obs.id}/correct`, nova, { value: 70, reason: "Motion artifact" })).status).toBe(403);
    expect((await call("POST", `/admin/observations/${obs.id}/correct`, surgeon, { value: 70 })).status).toBe(422);
    expect((await call("POST", `/admin/observations/${obs.id}/correct`, surgeon, { value: 72, reason: "Same value" })).status).toBe(422);
    expect((await call("POST", "/admin/observations/999999/correct", surgeon, { value: 70, reason: "Missing" })).status).toBe(404);
    const fixed = await call("POST", `/admin/observations/${obs.id}/correct`, surgeon, { value: 140, reason: "Typo, value was 140" });
    expect(fixed.status).toBe(201);
    expect((fixed.payload as any).observation).toMatchObject({ value: 140, level: "red" });
    const audit = db.prepare("SELECT * FROM vital_corrections WHERE observation_id=?").all(obs.id) as any[];
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: NOVA, metric: "heart_rate", original_value: 72, corrected_value: 140, original_level: "green",
      corrected_level: "red", reason: "Typo, value was 140", corrected_by: SURGEON });
    expect(audit[0].created_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(db.prepare("SELECT value, level FROM observations WHERE id=?").get(obs.id)).toEqual({ value: 140, level: "red" });
    const list = await call("GET", `/admin/astronauts/${NOVA}/corrections`, surgeon);
    expect((list.payload as any[])[0]).toMatchObject({ corrected_by_name: "Hale", original_value: 72 });
    const readings = await call("GET", `/admin/astronauts/${NOVA}/observations?metric=heart_rate`, surgeon);
    expect((readings.payload as any[])[0]).toMatchObject({ corrections: 1, original_value: 72, value: 140 });
    expect(((await call("GET", "/me/notifications", nova)).payload as any).notifications[0].kind).toBe("vital_corrected");
  });
});

describe("emergencies", () => {
  it("open -> acknowledged -> resolved, seen by two surgeon sessions, and the astronaut sees who is responding", async () => {
    const nova = await asNova();
    const hale = await asSurgeon();
    const moss = await asSurgeon2();
    expect((await call("POST", "/emergencies", hale, { message: "no" })).status).toBe(403);
    const raised = await call("POST", "/emergencies", nova, { message: "Chest tightness during exercise" });
    expect(raised.status).toBe(201);
    const id = (raised.payload as any).emergency.id;
    expect(((await call("POST", "/emergencies", nova, { message: "Still there" })).payload as any).already).toBe(true);

    for (const surgeon of [hale, moss]) {
      const feed = (await call("GET", "/admin/notifications", surgeon)).payload as any;
      expect(feed).toMatchObject({ open_count: 1, acknowledged_count: 0 });
      expect(feed.emergencies[0]).toMatchObject({ id, status: "open", display_name: "Nova", message: "Chest tightness during exercise" });
    }
    expect((await call("POST", `/admin/emergencies/${id}/acknowledge`, nova, {})).status).toBe(403);
    const [a, b] = await Promise.all([
      call("POST", `/admin/emergencies/${id}/acknowledge`, hale, {}),
      call("POST", `/admin/emergencies/${id}/acknowledge`, moss, {}),
    ]);
    expect([(a.payload as any).claimed, (b.payload as any).claimed].sort()).toEqual([false, true]);
    const owner = (a.payload as any).claimed ? "Hale" : "Dr. Moss";
    for (const surgeon of [hale, moss]) {
      const feed = (await call("GET", "/admin/notifications", surgeon)).payload as any;
      expect(feed).toMatchObject({ open_count: 0, acknowledged_count: 1 });
      expect(feed.emergencies[0]).toMatchObject({ status: "acknowledged", acknowledged_by_name: owner });
    }
    const mine = (await call("GET", "/emergencies/mine", nova)).payload as any;
    expect(mine.emergencies[0]).toMatchObject({ status: "acknowledged", acknowledged_by_name: owner });
    const notes = ((await call("GET", "/me/notifications", nova)).payload as any).notifications;
    expect(notes.filter((n: any) => n.title === "A flight surgeon is responding")).toHaveLength(1);

    const resolved = await call("POST", `/admin/emergencies/${id}/resolve`, moss, { note: "Spoke with Nova. Symptoms settled." });
    expect((resolved.payload as any).emergency).toMatchObject({ status: "resolved", resolved_by_name: "Dr. Moss", resolution_note: "Spoke with Nova. Symptoms settled." });
    for (const surgeon of [hale, moss]) {
      expect((await call("GET", "/admin/notifications", surgeon)).payload).toMatchObject({ open_count: 0, acknowledged_count: 0, emergencies: [] });
    }
    const history = (await call("GET", "/admin/emergencies?status=resolved", hale)).payload as any[];
    expect(history.map((row) => row.id)).toContain(id);
    expect(((await call("POST", "/emergencies", nova, { message: "New problem" })).payload as any).already).toBe(false);
    expect((await call("POST", `/admin/emergencies/${id}/acknowledge`, hale, {})).status).toBe(409);
  });
});

describe("1:1 messages", () => {
  it("delivers in both directions, persists, counts unread, and marks read on open", async () => {
    const nova = await asNova();
    const kepler = await asKepler();
    const hale = await asSurgeon();
    const moss = await asSurgeon2();
    const real = (rows: any[]) => rows.map((c) => c.user_id).filter((id: string) => !id.startsWith("00000000-0000-4000-8000-00000000d")).sort();
    const contacts = (await call("GET", "/messages/contacts", nova)).payload as any[];
    expect(real(contacts)).toEqual([SURGEON, SURGEON2].sort());
    expect(contacts.every((c) => c.role === "flight_surgeon")).toBe(true);
    const crew = (await call("GET", "/messages/contacts", hale)).payload as any[];
    expect(real(crew)).toEqual([KEPLER, NOVA].sort());
    expect(crew.every((c) => c.role === "astronaut")).toBe(true);

    expect((await call("POST", `/messages/with/${KEPLER}`, nova, { body: "hi" })).status).toBe(422); // astronaut -> astronaut
    expect((await call("POST", `/messages/with/${SURGEON2}`, hale, { body: "hi" })).status).toBe(422); // surgeon -> surgeon
    expect((await call("POST", `/messages/with/${SURGEON}`, nova, { body: "   " })).status).toBe(422);
    expect((await call("POST", `/messages/with/${SURGEON}`, nova, { body: "x".repeat(2001) })).status).toBe(422);

    expect((await call("POST", `/messages/with/${SURGEON}`, nova, { body: "Can we review yesterday's heart rate?" })).status).toBe(201);
    expect((await call("POST", `/messages/with/${SURGEON}`, nova, { body: "It felt fast after ARED." })).status).toBe(201);
    expect((await call("GET", "/messages/unread", hale)).payload).toEqual({ unread: 2 });
    expect((await call("GET", "/messages/unread", moss)).payload).toEqual({ unread: 0 });
    expect(((await call("GET", "/admin/notifications", hale)).payload as any).unread_messages).toBe(2);
    expect(((await call("GET", "/admin/crew", hale)).payload as any[]).find((r) => r.user_id === NOVA).unread_messages).toBe(2);
    expect((await call("GET", `/messages/with/${NOVA}`, kepler)).status).toBe(422);

    const thread = (await call("GET", `/messages/with/${NOVA}`, hale)).payload as any;
    expect(thread.messages.map((m: any) => m.body)).toEqual(["Can we review yesterday's heart rate?", "It felt fast after ARED."]);
    expect(((await call("POST", `/messages/with/${NOVA}/read`, hale, {})).payload as any).marked).toBe(2);
    expect((await call("GET", "/messages/unread", hale)).payload).toEqual({ unread: 0 });

    expect((await call("POST", `/messages/with/${NOVA}`, hale, { body: "Yes. It stayed in the green band." })).status).toBe(201);
    expect((await call("GET", "/messages/unread", nova)).payload).toEqual({ unread: 1 });
    const novaContacts = (await call("GET", "/messages/contacts", nova)).payload as any[];
    expect(novaContacts[0]).toMatchObject({ user_id: SURGEON, unread: 1, last_body: "Yes. It stayed in the green band.", last_from_me: false });
    expect((await call("POST", `/messages/with/${SURGEON}/read`, nova, {})).status).toBe(200);
    expect((await call("GET", "/messages/unread", nova)).payload).toEqual({ unread: 0 });

    // Persisted in D1, one conversation per (astronaut, surgeon) pair.
    const ours = "FROM conversations WHERE astronaut_id IN (?, ?)";
    expect(db.prepare(`SELECT COUNT(*) AS n ${ours}`).get(NOVA, KEPLER)).toEqual({ n: 1 });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM conversation_messages WHERE read_at IS NOT NULL AND conversation_id IN (SELECT id ${ours})`).get(NOVA, KEPLER)).toEqual({ n: 3 });
    const newer = (await call("GET", `/messages/with/${SURGEON}?after=${thread.messages[1].id}`, nova)).payload as any;
    expect(newer.messages.map((m: any) => m.body)).toEqual(["Yes. It stayed in the green band."]);
    // A second surgeon gets a separate thread with the same astronaut.
    await call("POST", `/messages/with/${NOVA}`, moss, { body: "Hi Nova, Dr. Moss here." });
    expect(db.prepare(`SELECT COUNT(*) AS n ${ours}`).get(NOVA, KEPLER)).toEqual({ n: 2 });
    expect(((await call("GET", `/messages/with/${NOVA}`, hale)).payload as any).messages).toHaveLength(3);
  });
});

describe("astronaut health reads", () => {
  it("returns vitals from observations for surgeons only", async () => {
    const surgeon = await asSurgeon();
    const nova = await asNova();
    expect((await call("GET", `/admin/astronauts/${NOVA}/series?group=vitals&days=30`, nova)).status).toBe(403);
    const series = await call("GET", `/admin/astronauts/${NOVA}/series?group=vitals&days=30`, surgeon);
    const heart = (series.payload as { metrics: { metric: string; points: { value: number }[] }[] }).metrics.find((m) => m.metric === "heart_rate");
    expect(heart?.points[0]).toMatchObject({ value: 72 });
    const sleep = await call("GET", `/admin/astronauts/${NOVA}/sleep?days=14`, surgeon);
    expect((sleep.payload as { nights: { hours: number }[] }).nights.some((night) => night.hours === 7.5)).toBe(true);
  });
});

describe("staff session enforcement", () => {
  it("keeps the shared demo nutrition rows read-only", async () => {
    const demo = await session(NOVA, "astronaut", "demo");
    expect((await call("GET", `/users/${NOVA}/meals`, demo)).status).toBe(200);
    expect((await call("POST", "/meals", demo, {})).status).toBe(403);
    expect((await call("DELETE", `/meals/${KEPLER}`, demo)).status).toBe(403);
    expect((await call("POST", "/hydration", demo, {})).status).toBe(403);
  });

  it("keeps the staff enrollment provider reserved for Access login", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const response = await call("POST", "/auth/identities", surgeon, {
      provider: "cloudflare_access_staff", subject: "fixture", user_id: NOVA,
    });
    expect(response.status).toBe(403);
  });

  it("denies demo and service credentials on staff routes", async () => {
    const demo = await session(NOVA, "admin", "demo");
    expect((await call("GET", "/admin/crew", demo)).status).toBe(403);
    expect((await call("POST", `/messages/with/${SURGEON}`, demo, { body: "hi" })).status).toBe(403);
    expect((await call("POST", "/emergencies", demo, {})).status).toBe(403);
    const fixtureKey = crypto.randomUUID();
    env.EVADE_API_KEY = fixtureKey;
    const response = await worker.fetch(new Request(API + "/admin/crew", { headers: { "X-EVAde-Key": fixtureKey } }), env, ctx);
    expect(response.status).toBe(403);
  });

  it("checks the current D1 role on every request (grant and revoke take effect at once)", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(200);
    db.prepare("UPDATE users SET role='astronaut' WHERE user_id=?").run(SURGEON);
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(403);
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    expect((await call("GET", "/admin/crew", nova)).status).toBe(403);
    db.prepare("UPDATE users SET role='flight_surgeon' WHERE user_id=?").run(NOVA);
    expect((await call("GET", "/admin/crew", nova)).status).toBe(200);
  });

  it("only grants credentialed CORS to the exact EVAde origins", async () => {
    env.ALLOWED_ORIGINS = "https://evade.health,https://www.evade.health";
    for (const origin of ["https://evade.health", "https://www.evade.health", "https://preview.evade.health", "https://evade.health.example"]) {
      const response = await worker.fetch(new Request(API + "/auth/me", {
        method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
      }), env, ctx);
      const allowed = ["https://evade.health", "https://www.evade.health"].includes(origin);
      expect(response.status).toBe(204);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowed ? origin : null);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(allowed ? "true" : null);
    }
  });
});
