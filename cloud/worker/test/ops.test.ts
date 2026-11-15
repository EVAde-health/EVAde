// Admin, emergency, and chat routes. Sessions follow the Cloudflare Access rules:
// only provider cloudflare_access_staff with a matching ACCESS_STAFF_AUD and D1 role is staff.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";

vi.mock("../src/live", () => ({ CrewFeed: class {} }));

const STAFF_AUD = "aud-staff-456";
const API = "https://api.evade.health";
const SURGEON = "11111111-1111-4111-8111-111111111111";
const THERAPIST = "22222222-2222-4222-8222-222222222222";
const NOVA = "33333333-3333-4333-8333-333333333333";
const KEPLER = "44444444-4444-4444-8444-444444444444";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
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
    ACCESS_STAFF_AUD: STAFF_AUD,
    ALLOWED_ORIGINS: "https://evade.health",
    FRONTEND_URL: "https://evade.health",
  };
  const insertUser = db.prepare("INSERT INTO users (user_id, display_name, role, mission_name) VALUES (?,?,?,?)");
  insertUser.run(SURGEON, "Hale", "flight_surgeon", "Expedition 74");
  insertUser.run(THERAPIST, "Moss", "therapist", "Expedition 74");
  insertUser.run(NOVA, "Nova", "astronaut", "Expedition 74");
  insertUser.run(KEPLER, "Kepler", "astronaut", "Expedition 74");
  const identity = db.prepare("INSERT INTO auth_identities (provider, subject, user_id) VALUES ('cloudflare_access',?,?)");
  identity.run("surgeon-fixture", SURGEON);
  identity.run("therapist-fixture", THERAPIST);
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

describe("Cloudflare Access staff gate", () => {
  it("keeps a crew Access session as an astronaut even when D1 says staff", async () => {
    db.prepare("UPDATE users SET role='flight_surgeon' WHERE user_id=?").run(NOVA);
    const token = await session(NOVA, "astronaut", "cloudflare_access");
    const response = await call("GET", "/admin/crew", token);
    expect(response.status).toBe(403);
  });

  it("rejects a staff session whose audience is not ACCESS_STAFF_AUD", async () => {
    const token = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", "other-aud");
    expect((await call("GET", "/admin/crew", token)).status).toBe(401);
  });

  it("rejects staff sessions when ACCESS_STAFF_AUD is not configured", async () => {
    env.ACCESS_STAFF_AUD = "";
    const token = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    expect((await call("GET", "/admin/crew", token)).status).toBe(401);
  });

  it("lets a matching staff session read the crew", async () => {
    const token = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    const response = await call("GET", "/admin/crew", token);
    expect(response.status).toBe(200);
    const names = (response.payload as { display_name: string }[]).map((row) => row.display_name);
    expect(names).toContain("Nova");
    expect(names).not.toContain("Hale");
  });
});

describe("daily goals", () => {
  it("lets staff set a goal, keeps history, and shows it to that astronaut", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    expect((await call("POST", `/admin/astronauts/${NOVA}/goals`, nova, { metric: "kcal_intake", target: 2600 })).status).toBe(403);
    expect((await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { metric: "kcal_intake", target: 50 })).status).toBe(422);
    const created = await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { metric: "kcal_intake", target: 2600, note: "Lower while appetite is down" });
    expect(created.status).toBe(201);
    const again = await call("POST", `/admin/astronauts/${NOVA}/goals`, surgeon, { metric: "kcal_intake", target: 2700 });
    expect(again.status).toBe(201);
    const history = await call("GET", `/admin/astronauts/${NOVA}/goals`, surgeon);
    expect(history.status).toBe(200);
    const body = history.payload as { goals: { metric: string; target: number; source: string }[]; history: unknown[] };
    expect(body.goals.find((goal) => goal.metric === "kcal_intake")).toMatchObject({ target: 2700, source: "set" });
    expect(body.history).toHaveLength(2);
    const own = await call("GET", `/users/${NOVA}/goals`, nova);
    expect((own.payload as { goals: { metric: string; target: number }[] }).goals.find((goal) => goal.metric === "kcal_intake")?.target).toBe(2700);
    expect((await call("GET", `/users/${KEPLER}/goals`, nova)).status).toBe(403);
  });
});

describe("emergencies", () => {
  it("records an astronaut emergency and lets staff acknowledge and resolve it", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    expect((await call("POST", "/emergencies", surgeon, { message: "no" })).status).toBe(403);
    const raised = await call("POST", "/emergencies", nova, { message: "Chest tightness during exercise" });
    expect(raised.status).toBe(201);
    const id = (raised.payload as { emergency: { id: number } }).emergency.id;
    const again = await call("POST", "/emergencies", nova, { message: "Still there" });
    expect(again.payload).toMatchObject({ already: true });
    const notes = await call("GET", "/admin/notifications", surgeon);
    expect((notes.payload as { open_count: number; emergencies: { display_name: string }[] }).open_count).toBe(1);
    expect((notes.payload as { emergencies: { display_name: string }[] }).emergencies[0].display_name).toBe("Nova");
    expect((await call("POST", `/admin/emergencies/${id}/acknowledge`, nova, {})).status).toBe(403);
    expect((await call("POST", `/admin/emergencies/${id}/acknowledge`, surgeon, {})).status).toBe(200);
    const resolved = await call("POST", `/admin/emergencies/${id}/resolve`, surgeon, { note: "Spoke with Nova. Symptoms settled." });
    expect((resolved.payload as { emergency: { status: string } }).emergency.status).toBe("resolved");
    expect((await call("GET", "/admin/notifications", surgeon)).payload).toMatchObject({ open_count: 0 });
  });
});

describe("staff chat", () => {
  it("keeps each conversation between one astronaut and one staff member", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const kepler = await session(KEPLER, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    const therapist = await session(THERAPIST, "therapist", "cloudflare_access_staff", STAFF_AUD);
    const directory = await call("GET", "/staff", nova);
    expect((directory.payload as { display_name: string }[]).map((row) => row.display_name).sort()).toEqual(["Hale", "Moss"]);
    expect((await call("POST", "/chat/threads", nova, { staff_id: KEPLER, body: "hi" })).status).toBe(422);
    expect((await call("POST", "/chat/threads", nova, { staff_id: SURGEON, body: " " })).status).toBe(422);
    const opened = await call("POST", "/chat/threads", nova, { staff_id: SURGEON, body: "Can we review yesterday's heart rate?" });
    expect(opened.status).toBe(201);
    const threadId = (opened.payload as { thread: { id: number } }).thread.id;
    expect((await call("GET", `/chat/threads/${threadId}/messages`, kepler)).status).toBe(403);
    expect((await call("GET", `/chat/threads/${threadId}/messages`, therapist)).status).toBe(403);
    const reply = await call("POST", `/chat/threads/${threadId}/messages`, surgeon, { body: "Yes. It stayed in the green band." });
    expect(reply.status).toBe(201);
    const messages = await call("GET", `/chat/threads/${threadId}/messages`, nova);
    expect((messages.payload as { messages: unknown[] }).messages).toHaveLength(2);
    const inbox = await call("GET", "/chat/threads", surgeon);
    expect((inbox.payload as { astronaut_name: string }[])[0].astronaut_name).toBe("Nova");
    expect((await call("GET", "/chat/threads", therapist)).payload).toEqual([]);
    expect(inbox.payload).toMatchObject([{ unread: 1 }]);
    const last = (messages.payload as { messages: { id: number }[] }).messages.at(-1)!;
    expect((await call("POST", `/chat/threads/${threadId}/read`, therapist, { through_id: last.id })).status).toBe(403);
    expect((await call("POST", `/chat/threads/${threadId}/read`, surgeon, { through_id: last.id })).status).toBe(204);
    expect((await call("GET", "/chat/threads", surgeon)).payload).toMatchObject([{ unread: 0 }]);
  });
});

describe("astronaut health reads", () => {
  it("returns vitals from observations for staff only", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    expect((await call("GET", `/admin/astronauts/${NOVA}/series?group=vitals&days=30`, nova)).status).toBe(403);
    const series = await call("GET", `/admin/astronauts/${NOVA}/series?group=vitals&days=30`, surgeon);
    const heart = (series.payload as { metrics: { metric: string; points: { source: string; value: number }[] }[] }).metrics
      .find((metric) => metric.metric === "heart_rate");
    expect(heart?.points[0]).toMatchObject({ source: "observation", value: 72 });
    const sleep = await call("GET", `/admin/astronauts/${NOVA}/sleep?days=14`, surgeon);
    expect((sleep.payload as { nights: { hours: number }[] }).nights.some((night) => night.hours === 7.5)).toBe(true);
  });
});

describe("staff session enforcement", () => {
  it("denies demo and service credentials on staff routes", async () => {
    const demo = await session(NOVA, "admin", "demo");
    expect((await call("GET", "/admin/crew", demo)).status).toBe(403);
    expect((await call("GET", "/chat/threads", demo)).status).toBe(403);
    expect((await call("POST", "/emergencies", demo, {})).status).toBe(403);
    const fixtureKey = crypto.randomUUID();
    env.EVADE_API_KEY = fixtureKey;
    const response = await worker.fetch(new Request(API + "/admin/crew", { headers: { "X-EVAde-Key": fixtureKey } }), env, ctx);
    expect(response.status).toBe(403);
  });

  it("checks the current D1 role on subsequent staff requests", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access_staff", STAFF_AUD);
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(200);
    db.prepare("UPDATE users SET role='astronaut' WHERE user_id=?").run(SURGEON);
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(401);
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
