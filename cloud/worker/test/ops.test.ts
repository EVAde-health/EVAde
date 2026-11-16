// Admin, emergency, and chat routes. One Cloudflare Access sign-in for everyone: the current D1 role decides
// whether a session is staff.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
// 0008 and 0011_seed_surgeon_demo are data-only (demo rows, applied on live); the tests seed their own data.
const DATA_ONLY = new Set(["0008_remove_demo_data.sql", "0011_seed_surgeon_demo.sql"]);

vi.mock("../src/live", () => ({ CrewFeed: class {} }));

const API = "https://api.evade.health";
const SURGEON = "11111111-1111-4111-8111-111111111111";
const THERAPIST = "22222222-2222-4222-8222-222222222222";
const NOVA = "33333333-3333-4333-8333-333333333333";
const KEPLER = "44444444-4444-4444-8444-444444444444";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql") && !DATA_ONLY.has(name)).sort()) {
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
  insertUser.run(THERAPIST, "Moss", "therapist", "Expedition 74");
  insertUser.run(NOVA, "Nova", "astronaut", "Expedition 74");
  insertUser.run(KEPLER, "Kepler", "astronaut", "Expedition 74");
  const identity = db.prepare("INSERT INTO auth_identities (provider, subject, user_id) VALUES (?,?,?)");
  for (const [subject, userId] of [["surgeon-fixture", SURGEON], ["therapist-fixture", THERAPIST]]) {
    identity.run("cloudflare_access", subject, userId);
    identity.run("cloudflare_access_staff", subject, userId);
  }
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

describe("one sign-in, D1 role decides", () => {
  it("makes an Access session staff as soon as D1 says staff", async () => {
    const token = await session(NOVA, "astronaut", "cloudflare_access");
    expect((await call("GET", "/admin/crew", token)).status).toBe(403);
    db.prepare("UPDATE users SET role='flight_surgeon' WHERE user_id=?").run(NOVA);
    expect((await call("GET", "/admin/crew", token)).status).toBe(200);
  });

  it("gives a session no staff rights when D1 says astronaut, whatever the session claims", async () => {
    const token = await session(NOVA, "flight_surgeon", "cloudflare_access");
    expect((await call("GET", "/admin/crew", token)).status).toBe(403);
  });

  it("lets a matching staff session read the crew", async () => {
    const token = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const response = await call("GET", "/admin/crew", token);
    expect(response.status).toBe(200);
    const names = (response.payload as { display_name: string }[]).map((row) => row.display_name);
    expect(names).toContain("Nova");
    expect(names).not.toContain("Hale");
  });
});

describe("daily goals", () => {
  it("lets staff set a goal, keeps history, and shows it to that astronaut", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
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

describe("surgeon console response contract", () => {
  it("keeps legacy crew fields and adds latest vitals, daily progress, emergencies and private unread counts", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const therapist = await session(THERAPIST, "therapist", "cloudflare_access");
    const day = new Date().toISOString().slice(0, 10);
    const ts = `${day}T15:00:00.000Z`;
    const yesterday = new Date(Date.parse(`${day}T00:00:00.000Z`) - 1000).toISOString();
    const reading = db.prepare("INSERT INTO observations (user_id,metric,value,unit,ts,source,level) VALUES (?,?,?,'mmHg',?,'manual',?)");
    reading.run(NOVA, "diastolic_bp", 60, yesterday, "green");
    reading.run(NOVA, "diastolic_bp", 100, ts, "yellow");
    reading.run(NOVA, "diastolic_bp", 104, ts, "red");
    reading.run(NOVA, "systolic_bp", 130, ts, "green");
    const meal = db.prepare("INSERT INTO meals (id,user_id,ts,name,grams,kcal,protein,carbs,fat) VALUES (?,?,?,'Fixture meal',100,1000,55,0,0)");
    meal.run("fixture-meal-today", NOVA, ts);
    meal.run("fixture-meal-yesterday", NOVA, yesterday);
    const water = db.prepare("INSERT INTO hydration (id,user_id,ts,amount_ml) VALUES (?,?,?,?)");
    water.run("fixture-water-today", NOVA, ts, 1100);
    water.run("fixture-water-adjustment", NOVA, ts, -100);
    water.run("fixture-water-yesterday", NOVA, yesterday, 300);
    db.prepare("INSERT INTO daily_goals (user_id,metric,target,set_by) VALUES (?,'kcal_intake',2000,?)").run(NOVA, SURGEON);
    db.prepare("INSERT INTO daily_goals (user_id,metric,target,set_by) VALUES (?,'water_intake_ml',2000,?)").run(NOVA, SURGEON);
    db.prepare("INSERT INTO user_goals (user_id,goal_type,target,unit) VALUES (?,'water_ml',3000,'ml')").run(NOVA);
    const task = db.prepare("INSERT INTO tasks (user_id,title,category,recurrence,day,points,completed_at) VALUES (?,'Fixture task','basic','daily',?,10,?)");
    task.run(NOVA, day, ts);
    task.run(NOVA, day, null);
    db.prepare("INSERT INTO self_reports (user_id,ts,mood,source,checkin_level) VALUES (?,?,4,'voice_web','green')").run(NOVA, ts);
    db.prepare("INSERT INTO emergencies (user_id,status,message) VALUES (?,'open','Synthetic emergency')").run(NOVA);
    db.prepare("INSERT INTO alerts (user_id,ts,level,metric,message,acknowledged) VALUES (?,?,'red','diastolic_bp','Fixture alert',0)").run(NOVA, ts);
    const thread = db.prepare("INSERT INTO conversations (astronaut_id,surgeon_id) VALUES (?,?)").run(NOVA, SURGEON).lastInsertRowid;
    const message = db.prepare("INSERT INTO conversation_messages (conversation_id,sender_id,body,read_at) VALUES (?,?,'Fixture message',?)");
    message.run(thread, NOVA, null);
    message.run(thread, NOVA, ts);
    message.run(thread, SURGEON, null);

    const response = await call("GET", "/admin/crew", surgeon);
    expect(response.status).toBe(200);
    expect(response.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({
        user_id: NOVA, display_name: "Nova", environment: expect.any(String), last_mdtr: null, open_emergencies: 1,
        heart_rate: 72, heart_rate_level: "green", sleep_hours: 7.5, status: "critical",
        red_alerts: 1, unread_messages: 1, emergency: expect.objectContaining({ status: "open" }),
        vitals: expect.objectContaining({
          diastolic_bp: expect.objectContaining({ value: 104, level: "red", ts, unit: "mmHg" }),
          systolic_bp: expect.objectContaining({ value: 130, level: "green" }),
          spo2: null,
        }),
        progress: {
          calories: { value: 1000, target: 2000, unit: "kcal" },
          protein: { value: 55, target: 110, unit: "g" },
          water_ml: { value: 1000, target: 2000, unit: "ml" },
          tasks: { value: 1, target: 2, unit: "tasks" },
          goal_progress: 0.5,
        },
        goal_progress: 50,
        last_checkin: { ts, mood: 4, stress: null, source: "voice_web", level: "green" },
      }),
      expect.objectContaining({ user_id: KEPLER, last_checkin: null, emergency: null, vitals: expect.objectContaining({ diastolic_bp: null }) }),
    ]));
    expect((await call("GET", "/admin/crew", therapist)).payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: NOVA, unread_messages: 0 }),
    ]));
  });

  it("serves the vitals chart shape and enforces the existing staff-only gate", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const astronautToken = await session(NOVA, "astronaut", "cloudflare_access");
    const path = `/admin/astronauts/${NOVA}/vitals?days=7`;
    expect((await call("GET", path, null)).status).toBe(401);
    expect((await call("GET", path, astronautToken)).status).toBe(403);
    const vitals = await call("GET", path, surgeon);
    expect(vitals.status).toBe(200);
    expect(vitals.payload).toMatchObject({ group: "vitals", days: 7,
      vitals: { heart_rate: { value: 72, level: "green" }, diastolic_bp: null },
      metrics: expect.arrayContaining([expect.objectContaining({ metric: "heart_rate", decimals: 0,
        green_min: expect.any(Number), green_max: expect.any(Number), latest: expect.objectContaining({ value: 72, level: "green" }),
        points: expect.arrayContaining([expect.objectContaining({ value: 72 })]),
      })]),
    });
    expect((await call("GET", `/admin/astronauts/${SURGEON}/vitals`, surgeon)).status).toBe(422);
    expect((await call("GET", "/admin/astronauts/missing/vitals", surgeon)).status).toBe(404);
  });

  it("serves the astronaut picker, journal, task board and typed goals for the same account", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const day = new Date().toISOString().slice(0, 10);
    const ts = `${day}T12:00:00.000Z`;
    db.prepare("INSERT INTO self_reports (user_id,ts,mood,source,symptoms,note) VALUES (?,?,3,'voice_web',?,'Private check-in fixture')")
      .run(NOVA, ts, '["headache", 9]');
    db.prepare("INSERT INTO journal_entries (user_id,ts,content,ai_summary) VALUES (?,?,'Private entry fixture','Summary fixture')").run(NOVA, ts);
    db.prepare("INSERT INTO journal_messages (id,user_id,sender,content,ts) VALUES (?,?,'user','Private companion fixture',?)")
      .run(crypto.randomUUID(), NOVA, ts);
    db.prepare("INSERT INTO tasks (user_id,title,category,recurrence,day,points) VALUES (?,'Synthetic task','basic','daily',?,10)").run(NOVA, day);
    const detail = `/admin/astronauts/${NOVA}`;
    expect((await call("GET", "/admin/astronauts", surgeon)).payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: NOVA, display_name: "Nova", emergency_status: null }),
    ]));
    expect((await call("GET", detail, surgeon)).payload).toMatchObject({ last_checkin: { ts, mood: 3, source: "voice_web" } });
    const journal = await call("GET", `${detail}/journal`, surgeon);
    expect(journal.status).toBe(200);
    expect(journal.payload.checkins).toMatchObject([{ ts, mood: 3, symptoms: ["headache"] }]);
    expect(journal.payload.checkins[0]).not.toHaveProperty("note");
    expect(journal.payload.journal).toEqual([{ ts, source: "text", mood_label: null, concern_level: null, ai_summary: "Summary fixture" }]);
    const mood = await call("GET", `${detail}/mood`, surgeon);
    expect(mood.status).toBe(200);
    expect(mood.payload.reports[0]).not.toHaveProperty("note");
    expect(mood.payload.journal[0]).not.toHaveProperty("excerpt");
    expect(JSON.stringify([journal.payload, mood.payload])).not.toContain("Private");
    const owner = await session(NOVA, "astronaut", "cloudflare_access");
    for (const [path, content] of [[`/users/${NOVA}/journal`, "Private entry fixture"], [`/users/${NOVA}/journal/messages`, "Private companion fixture"]]) {
      expect((await call("GET", path, surgeon)).status).toBe(403);
      expect((await call("GET", path, owner)).payload).toMatchObject([{ content }]);
    }
    expect((await call("GET", `${detail}/tasks`, surgeon)).payload).toMatchObject({
      day, today: [{ title: "Synthetic task" }], history: [{ day, total: 1, done: 0 }], tutorials: [],
    });
    const invalid = await call("POST", `${detail}/goals`, surgeon, { changes: [
      { goal_type: "calories", target: 2400 }, { goal_type: "water_ml", target: -1 },
    ] });
    expect(invalid.status).toBe(422);
    expect(db.prepare("SELECT COUNT(*) AS n FROM daily_goals WHERE user_id=?").get(NOVA)).toMatchObject({ n: 0 });
    const result = await call("POST", `${detail}/goals`, surgeon, { changes: [{ goal_type: "calories", target: 2400 }] });
    expect(result.status).toBe(201);
    expect(result.payload).toMatchObject({ changed: ["calories"], goals: expect.arrayContaining([
      expect.objectContaining({ goal_type: "calories", metric: "kcal_intake", target: 2400, source: "set" }),
    ]) });
    expect((await call("GET", `${detail}/goals`, surgeon)).payload).toMatchObject({
      types: { calories: { min: 800, max: 6000 } },
      history: [{ goal_type: "calories", metric: "kcal_intake", created_at: expect.any(String) }],
    });
  });

  it("audits flight surgeon corrections and rejects therapist, admin and astronaut edits", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const astronautToken = await session(NOVA, "astronaut", "cloudflare_access");
    const therapist = await session(THERAPIST, "therapist", "cloudflare_access");
    const adminId = "55555555-5555-4555-8555-555555555555";
    db.prepare("INSERT INTO users (user_id,display_name,role) VALUES (?,'Fixture admin','admin')").run(adminId);
    const admin = await session(adminId, "admin", "cloudflare_access");
    const base = `/admin/astronauts/${NOVA}`;
    const observations = await call("GET", `${base}/observations?metric=heart_rate`, surgeon);
    expect(observations.status).toBe(200);
    expect(observations.payload).toMatchObject([{ value: 72, corrections: 0, original_value: null }]);
    const route = `/admin/observations/${observations.payload[0].id}/correct`;
    const edit = { value: 76, reason: "Synthetic sensor correction" };
    expect((await call("POST", route, astronautToken, edit)).status).toBe(403);
    expect((await call("POST", route, therapist, edit)).status).toBe(403);
    expect((await call("POST", route, admin, edit)).status).toBe(403);
    expect((await call("GET", `${base}/corrections`, admin)).payload).toEqual([]);
    expect((await call("POST", route, surgeon, { ...edit, reason: "" })).status).toBe(422);
    const corrected = await call("POST", route, surgeon, edit);
    expect(corrected.status).toBe(201);
    expect(corrected.payload).toMatchObject({ correction: { original_value: 72, corrected_value: 76 }, observation: { value: 76 } });
    expect((await call("GET", `${base}/observations?metric=heart_rate`, surgeon)).payload).toMatchObject([
      { value: 76, corrections: 1, original_value: 72 },
    ]);
    expect((await call("GET", `${base}/corrections`, surgeon)).payload).toMatchObject([
      { original_value: 72, corrected_value: 76, corrected_by_name: "Hale", reason: edit.reason },
    ]);
    expect((await call("GET", `/admin/astronauts/${KEPLER}/corrections`, surgeon)).payload).toEqual([]);
  });
});

describe("emergencies", () => {
  it("records an astronaut emergency and lets staff acknowledge and resolve it", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
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
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const therapist = await session(THERAPIST, "therapist", "cloudflare_access");
    // Staff who have never signed in are not offered as contacts.
    db.prepare("INSERT INTO users (user_id, display_name, role) VALUES (?, ?, 'admin')").run("unenrolled-staff", "Unenrolled staff");
    const directory = await call("GET", "/staff", nova);
    expect((directory.payload as { display_name: string }[]).map((row) => row.display_name).sort()).toEqual(["Hale", "Moss"]);
    expect((await call("POST", "/chat/threads", nova, { staff_id: "unenrolled-staff", body: "hi" })).status).toBe(422);
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

describe("shared crew and staff messages", () => {
  it("exchanges messages and receipts on one conversation and isolates both participants", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const kepler = await session(KEPLER, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const therapist = await session(THERAPIST, "therapist", "cloudflare_access");
    const crewPath = `/messages/with/${SURGEON}`;
    const staffPath = `/messages/with/${NOVA}`;
    expect((await call("GET", "/messages/contacts", null)).status).toBe(401);
    expect((await call("GET", crewPath, nova)).payload).toMatchObject({ contact: { user_id: SURGEON }, conversation: null, messages: [] });
    expect((await call("GET", `/messages/with/${KEPLER}`, nova)).status).toBe(422);
    expect((await call("GET", `/messages/with/${THERAPIST}`, surgeon)).status).toBe(422);
    const request = await call("POST", crewPath, nova, { body: "  Request from the astronaut  " });
    expect(request.status).toBe(201);
    expect(request.payload.message).toMatchObject({ sender_id: NOVA, body: "Request from the astronaut", read_at: null });
    const conversationId = request.payload.conversation_id;
    expect((await call("GET", staffPath, surgeon)).payload).toMatchObject({
      conversation: { id: conversationId, astronaut_id: NOVA, surgeon_id: SURGEON },
      messages: [{ body: "Request from the astronaut" }],
    });
    const response = await call("POST", staffPath, surgeon, { body: "Reply from the surgeon" });
    expect(response.status).toBe(201);
    expect(response.payload).toMatchObject({ conversation_id: conversationId, message: { sender_id: SURGEON } });
    expect((await call("GET", crewPath, nova)).payload.messages.map((row: { body: string }) => row.body))
      .toEqual(["Request from the astronaut", "Reply from the surgeon"]);
    expect((await call("GET", crewPath, kepler)).payload).toMatchObject({ conversation: null, messages: [] });
    expect((await call("GET", staffPath, therapist)).payload).toMatchObject({ conversation: null, messages: [] });
    expect((await call("POST", `${crewPath}/read`, kepler, {})).payload).toEqual({ marked: 0 });
    expect((await call("POST", `${staffPath}/read`, therapist, {})).payload).toEqual({ marked: 0 });
    expect((await call("GET", "/messages/unread", nova)).payload).toEqual({ unread: 1 });
    expect((await call("GET", "/messages/unread", surgeon)).payload).toEqual({ unread: 1 });
    expect((await call("GET", "/messages/unread", kepler)).payload).toEqual({ unread: 0 });
    expect((await call("GET", "/messages/unread", therapist)).payload).toEqual({ unread: 0 });
    expect((await call("GET", "/messages/contacts", surgeon)).payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: NOVA, conversation_id: conversationId, unread: 1, last_from_me: true }),
    ]));
    expect((await call("GET", "/messages/contacts", nova)).payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: SURGEON, conversation_id: conversationId, unread: 1, last_from_me: false }),
    ]));
    expect((await call("GET", "/admin/notifications", surgeon)).payload.unread_messages).toBe(1);
    expect((await call("GET", "/admin/notifications", therapist)).payload.unread_messages).toBe(0);
    expect((await call("POST", `${staffPath}/read`, surgeon, {})).payload).toEqual({ marked: 1 });
    expect((await call("GET", "/messages/unread", nova)).payload).toEqual({ unread: 1 });
    expect((await call("POST", `${crewPath}/read`, nova, {})).payload).toEqual({ marked: 1 });
    expect((await call("GET", "/messages/unread", nova)).payload).toEqual({ unread: 0 });
    expect((await call("GET", "/admin/notifications", surgeon)).payload.unread_messages).toBe(0);
    expect((await call("GET", `/chat/threads/${conversationId}/messages`, kepler)).status).toBe(403);
    expect((await call("GET", `/chat/threads/${conversationId}/messages`, nova)).payload).toMatchObject({
      thread: { id: conversationId, staff_id: SURGEON }, messages: [{ body: "Request from the astronaut" }, { body: "Reply from the surgeon" }],
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversations").get()).toMatchObject({ n: 1 });
  });

  it("enforces message length and a shared per-sender rate limit for both roles", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const keys = new Set<string>();
    env.AUTH_RATE_LIMITER = { limit: async ({ key }) => {
      const success = !keys.has(key);
      keys.add(key);
      return { success };
    } };
    const crewPath = `/messages/with/${SURGEON}`;
    const staffPath = `/messages/with/${NOVA}`;
    expect((await call("POST", crewPath, nova, { body: " " })).status).toBe(422);
    expect((await call("POST", staffPath, surgeon, { body: "a".repeat(2001) })).status).toBe(422);
    const first = await call("POST", crewPath, nova, { body: "a" });
    expect(first.status).toBe(201);
    expect((await call("POST", crewPath, nova, { body: "Rate-limited crew message" })).status).toBe(429);
    expect((await call("POST", staffPath, surgeon, { body: "b".repeat(2000) })).status).toBe(201);
    expect((await call("POST", `/chat/threads/${first.payload.conversation_id}/messages`, surgeon, { body: "Rate-limited legacy send" })).status).toBe(429);
    expect(keys).toEqual(new Set([`message-send:${NOVA}`, `message-send:${SURGEON}`]));
    expect(db.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()).toMatchObject({ n: 2 });
  });

  it("reads a 0009 conversation copied by 0010 through both URL formats", async () => {
    const nova = await session(NOVA, "astronaut", "cloudflare_access");
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const threadId = db.prepare("INSERT INTO staff_threads (astronaut_id,staff_id) VALUES (?,?)").run(NOVA, SURGEON).lastInsertRowid;
    db.prepare("INSERT INTO staff_messages (thread_id,sender_id,body) VALUES (?,?,'Migrated fixture')").run(threadId, SURGEON);
    db.exec(readFileSync(join(__dirname, "..", "migrations", "0010_surgeon_console.sql"), "utf8"));
    expect((await call("GET", `/messages/with/${SURGEON}`, nova)).payload).toMatchObject({
      conversation: { id: Number(threadId) }, messages: [{ body: "Migrated fixture" }],
    });
    expect((await call("GET", `/chat/threads/${threadId}/messages`, surgeon)).payload).toMatchObject({
      thread: { id: Number(threadId), staff_id: SURGEON }, messages: [{ body: "Migrated fixture" }],
    });
  });
});

describe("astronaut health reads", () => {
  it("returns vitals from observations for staff only", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
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
  it("rejects a demo session that points at a real account", async () => {
    const demo = await session(NOVA, "astronaut", "demo");
    expect((await call("GET", `/users/${NOVA}/meals`, demo)).status).toBe(401);
    expect((await call("POST", "/meals", demo, {})).status).toBe(401);
  });

  it("keeps the staff enrollment provider reserved for Access login", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    const response = await call("POST", "/auth/identities", surgeon, {
      provider: "cloudflare_access_staff", subject: "fixture", user_id: NOVA,
    });
    expect(response.status).toBe(403);
  });

  it("denies demo sessions on real accounts and service credentials on staff routes", async () => {
    const demo = await session(NOVA, "admin", "demo");
    expect((await call("GET", "/admin/crew", demo)).status).toBe(401);
    expect((await call("GET", "/chat/threads", demo)).status).toBe(401);
    const fixtureKey = crypto.randomUUID();
    env.EVADE_API_KEY = fixtureKey;
    const response = await worker.fetch(new Request(API + "/admin/crew", { headers: { "X-EVAde-Key": fixtureKey } }), env, ctx);
    expect(response.status).toBe(403);
  });

  it("checks the current D1 role on subsequent staff requests", async () => {
    const surgeon = await session(SURGEON, "flight_surgeon", "cloudflare_access");
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(200);
    db.prepare("UPDATE users SET role='astronaut' WHERE user_id=?").run(SURGEON);
    expect((await call("GET", "/admin/crew", surgeon)).status).toBe(403);
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
