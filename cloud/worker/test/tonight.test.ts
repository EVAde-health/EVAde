// Demo login, "Delete my account", and the model API wiring, through the real Worker (src/index.ts)
// against a database built from every migration (node:sqlite), with an in-memory KV and a fake model gateway.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { DELETE_USER_SQL } from "../src/deleteUser";

vi.mock("../src/live", () => ({ CrewFeed: class {} }));

// ---------- fakes ----------
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  const dir = join(__dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(join(dir, f), "utf8"));
  const stmt = (sql: string, args: unknown[] = []) => ({
    execute: () => {
      if (/\bRETURNING\b/i.test(sql)) return { success: true, results: db.prepare(sql).all(...(args as any[])), meta: {} };
      return { success: true, results: [], meta: db.prepare(sql).run(...(args as any[])) };
    },
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async (col?: string) => {
      const row = db.prepare(sql).get(...(args as any[])) as any;
      return row === undefined ? null : col ? row[col] : row;
    },
    all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
    run: async () => ({ success: true, meta: db.prepare(sql).run(...(args as any[])) }),
  });
  return {
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: ReturnType<typeof stmt>[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => s.execute());
        db.exec("COMMIT");
        return results;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
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

// Fake evade-gateway (service binding). Records calls; answers like Michael's API envelope.
type Call = { method: string; path: string; key: string | null; body: any };
let calls: Call[];
let nextMock = false;
let deleteStatus = 200;
const MODEL_UID = "11111111-2222-4333-8444-555555555555";
const gateway = {
  fetch: async (req: Request) => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.json() : null;
    calls.push({ method: req.method, path: u.pathname, key: req.headers.get("X-Gateway-Key"), body });
    const env = (data: unknown) => Response.json({
      request_id: "r1", user_id: body?.user_id ?? null, server_time: "2026-11-15T05:00:00Z", api_version: "1",
      pipeline_version: "p1", model_ids: nextMock ? [] : ["EVA-3"], data, warnings: nextMock ? ["placeholder"] : [],
    });
    if (u.pathname === "/v1/users" && req.method === "POST") return env({ user_id: MODEL_UID });
    if (u.pathname.startsWith("/v1/users/") && req.method === "DELETE") return new Response(null, { status: deleteStatus });
    if (u.pathname === "/v1/models") return Response.json({ models: [{ model_id: "EVA-3" }], deep_models: { "sleep-deep": "mock" } });
    if (u.pathname === "/v1/predict/ecg-deep") return env({ source: nextMock ? "mock" : "model", rhythm: { flag: "MI" }, comparison: { confidence: "provisional" } });
    if (u.pathname === "/v1/predict/risk") return env({
      risk: { r_disp: 0.62, r_agg: 0.5, band: "high", flag_domains: ["cardiac"], override_ids: ["O1"] },
      mdtr: { display: "12 days" }, domains: { cardiac: { s: 0.7 }, behavioral: { s: 0.2 }, neuro: { s: 0.1 }, radiation: { s: 0.3 }, bone: { s: 0.0 } },
    });
    if (u.pathname === "/v1/predict/space-weather") return env({ nowcast: { level: "S1" } });
    return Response.json({ error: { code: "not_found" } }, { status: 404 });
  },
};

// ---------- setup ----------
const API = "https://api.evade.health";
const GATEWAY_KEY = "test-gateway-key-0123456789abcdef0123";
const ORIGIN = { Origin: "https://evade.health" };
let db: ReturnType<typeof fakeD1>;
let kv: ReturnType<typeof fakeKV>;
let env: Env;
let deletedMedia: string[];

const b64url = (b: ArrayBuffer) => Buffer.from(new Uint8Array(b)).toString("base64url");
const hash = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
const row = (sql: string, ...a: unknown[]) => db.raw.prepare(sql).get(...(a as any[])) as any;
const count = (table: string, uid: string) => row(`SELECT COUNT(*) n FROM ${table} WHERE user_id=?`, uid).n as number;

beforeEach(() => {
  db = fakeD1();
  kv = fakeKV();
  calls = [];
  nextMock = false;
  deleteStatus = 200;
  deletedMedia = [];
  env = {
    DB: db, SESSIONS: kv, AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ALLOWED_ORIGINS: "https://evade.health", FRONTEND_URL: "https://evade.health",
    MODELS: gateway, MODEL_GATEWAY_KEY: GATEWAY_KEY,
    MEDIA: { delete: async (keys: string[]) => void deletedMedia.push(...keys) },
  } as unknown as Env;
});

async function call(method: string, path: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...ORIGIN, ...(opts.headers ?? {}) };
  if (opts.cookie) headers.Cookie = `__Host-evade_session=${opts.cookie}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const req = new Request(API + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: "manual" });
  return worker.fetch(req, env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
}

/** A signed-in astronaut (as if they came through Cloudflare Access). */
async function astronaut(name = "Lee") {
  const uid = crypto.randomUUID();
  db.raw.prepare("INSERT INTO users (user_id, display_name, role) VALUES (?,?, 'astronaut')").run(uid, name);
  db.raw.prepare("INSERT INTO auth_identities (provider, subject, user_id, email) VALUES ('cloudflare_access', ?, ?, ?)").run(`sub-${uid}`, uid, `${name}@e.com`);
  db.raw.prepare("INSERT INTO meals (id,user_id,ts,name,grams,kcal,protein,carbs,fat) VALUES (?,?,?,?,?,?,?,?,?)").run(`m-${uid}`, uid, "2026-11-15T01:00:00Z", "Rice", 100, 130, 3, 28, 0);
  db.raw.prepare("INSERT INTO media (id, user_id, kind, r2_key, content_type, bytes, ts) VALUES (?, ?, 'photo', ?, 'image/jpeg', 10, ?)").run(crypto.randomUUID(), uid, `photos/${uid}/1.jpg`, "2026-11-15T01:00:00Z");
  const token = `tok-${uid}`;
  await kv.put(`sess:${await hash(token)}`, JSON.stringify({ user_id: uid, role: "astronaut", email: null, provider: "cloudflare_access", expires: Date.now() + 3600_000 }));
  return { uid, token };
}

// ---------- demo login ----------
describe("GET /auth/demo", () => {
  it("is off unless DEMO_LOGIN=true", async () => {
    expect((await call("GET", "/auth/demo")).status).toBe(404);
  });

  it("signs into the seeded demo astronaut only, as an astronaut, for 2 hours", async () => {
    env = { ...env, DEMO_LOGIN: "true" } as Env;
    const res = await call("GET", "/auth/demo?redirect=https://evade.health/dashboard&user_id=00000000-0000-4000-8000-00000000d002");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://evade.health/dashboard");
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/__Host-evade_session=/);
    expect(cookie).toMatch(/Max-Age=7200/);
    expect(cookie).toMatch(/HttpOnly/);
    const token = /__Host-evade_session=([^;]+)/.exec(cookie)![1];
    const me = await (await call("GET", "/auth/me", { cookie: token })).json<any>();
    expect(me.user.user_id).toBe("00000000-0000-4000-8000-00000000d001"); // the ?user_id= was ignored
    expect(me.role).toBe("astronaut");
  });

  it("demo user cannot read staff data or another astronaut", async () => {
    env = { ...env, DEMO_LOGIN: "true" } as Env;
    const token = /__Host-evade_session=([^;]+)/.exec((await call("GET", "/auth/demo")).headers.get("Set-Cookie")!)![1];
    expect((await call("GET", "/users", { cookie: token })).status).toBe(403);
    expect((await call("GET", "/users/00000000-0000-4000-8000-00000000d002/tasks", { cookie: token })).status).toBe(403);
  });
});

// ---------- delete my account ----------
describe("DELETE /me", () => {
  it("needs a signed-in user and an explicit confirm", async () => {
    expect((await call("DELETE", "/me", { body: { confirm: "DELETE" } })).status).toBe(401);
    const { token } = await astronaut();
    expect((await call("DELETE", "/me", { cookie: token, body: {} })).status).toBe(400);
  });

  it("refuses the demo account", async () => {
    env = { ...env, DEMO_LOGIN: "true" } as Env;
    const token = /__Host-evade_session=([^;]+)/.exec((await call("GET", "/auth/demo")).headers.get("Set-Cookie")!)![1];
    expect((await call("DELETE", "/me", { cookie: token, body: { confirm: "DELETE" } })).status).toBe(403);
    expect(count("users", "00000000-0000-4000-8000-00000000d001")).toBe(1);
  });

  it("deletes R2 media, the model-service copy, every D1 row and the session", async () => {
    const { uid, token } = await astronaut();
    await kv.put(`mu:${uid}`, MODEL_UID);
    const other = await astronaut("Other");
    const res = await call("DELETE", "/me", { cookie: token, body: { confirm: "DELETE" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, model_service: "deleted" });
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    expect(deletedMedia).toEqual([`photos/${uid}/1.jpg`]);
    expect(calls.find((c) => c.method === "DELETE")?.path).toBe(`/v1/users/${MODEL_UID}`);
    for (const t of ["users", "auth_identities", "meals", "media"]) expect(count(t, uid)).toBe(0);
    expect(await kv.get(`mu:${uid}`)).toBeNull();
    expect((await call("GET", "/auth/me", { cookie: token })).status).toBe(401);
    expect(count("users", other.uid)).toBe(1); // nobody else touched
  });

  it("keeps all D1 data when the model service deletion fails, so the user can retry", async () => {
    const { uid, token } = await astronaut();
    await kv.put(`mu:${uid}`, MODEL_UID);
    deleteStatus = 503;
    expect((await call("DELETE", "/me", { cookie: token, body: { confirm: "DELETE" } })).status).toBe(503);
    expect(count("users", uid)).toBe(1);
  });

  it("the generated SQL matches every table that has a user_id column", () => {
    const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map((r) => r.name);
    const withUid = tables.filter((t) => (db.raw.prepare(`PRAGMA table_info(${t})`).all() as any[]).some((c) => c.name === "user_id"));
    const sql = DELETE_USER_SQL.join("\n");
    for (const t of withUid) expect(sql, `delete query misses ${t}`).toMatch(new RegExp(`(FROM|UPDATE) ${t}\\b`));
  });
});

// ---------- model API ----------
describe("model predictions", () => {
  it("503 when the model service isn't connected", async () => {
    const { token } = await astronaut();
    env = { ...env, MODELS: undefined, MODEL_API_URL: undefined } as Env;
    expect((await call("POST", "/predict/ecg-deep", { cookie: token, body: { signal: [1, 2, 3] } })).status).toBe(503);
  });

  it("registers the user once, forwards under the model id, stores a real result, never echoes the model id", async () => {
    const { uid, token } = await astronaut();
    const res = await call("POST", "/predict/ecg-deep", { cookie: token, body: { signal: [1, 2, 3] } });
    expect(res.status).toBe(200);
    const out = await res.json<any>();
    expect(out.user_id).toBeUndefined();
    expect(out.placeholder).toBe(false);
    expect(out.stored).toBe(true);
    expect(out.review_note).toMatch(/not a diagnosis/);
    const predict = calls.find((c) => c.path === "/v1/predict/ecg-deep")!;
    expect(predict.key).toBe(GATEWAY_KEY);
    expect(predict.body.user_id).toBe(MODEL_UID);
    const r = row("SELECT * FROM model_results WHERE user_id=?", uid);
    expect(r).toMatchObject({ endpoint: "/v1/predict/ecg-deep", model_id: "EVA-3", flag: "MI", confidence: "provisional", ts: "2026-11-15T05:00:00Z" });
    await call("POST", "/predict/ecg-deep", { cookie: token, body: { signal: [1] } });
    expect(calls.filter((c) => c.path === "/v1/users").length).toBe(1);
  });

  it("never stores placeholder (mock) results", async () => {
    const { uid, token } = await astronaut();
    nextMock = true;
    const out = await (await call("POST", "/predict/ecg-deep", { cookie: token, body: { signal: [1] } })).json<any>();
    expect(out.placeholder).toBe(true);
    expect(out.stored).toBe(false);
    expect(count("model_results", uid)).toBe(0);
    expect(count("alerts", uid)).toBe(0);
  });

  it("stores /risk in risk_scores with the 5-band value as-is", async () => {
    const { uid, token } = await astronaut();
    await call("POST", "/predict/risk", { cookie: token, body: {} });
    expect(row("SELECT * FROM risk_scores WHERE user_id=?", uid)).toMatchObject({
      r: 0.62, band: "high", mdtr: "12 days", override: "O1", source: "fastapi",
      domains: JSON.stringify({ cardiac: 0.7, behavioral: 0.2, neuro: 0.1, radiation: 0.3, bone: 0 }),
      top_domains: JSON.stringify(["cardiac"]),
    });
    expect(count("alerts", uid)).toBe(0);
  });

  it("space-weather is sent without a user id", async () => {
    const { token } = await astronaut();
    await call("POST", "/predict/space-weather", { cookie: token, body: {} });
    expect(calls.find((c) => c.path === "/v1/predict/space-weather")!.body.user_id).toBeUndefined();
    expect(calls.some((c) => c.path === "/v1/users")).toBe(false);
  });

  it("astronauts can't run predictions as someone else; unknown kinds are 404", async () => {
    const a = await astronaut();
    const b = await astronaut("B");
    expect((await call("POST", "/predict/ecg-deep", { cookie: a.token, body: { user_id: b.uid } })).status).toBe(403);
    expect((await call("POST", "/predict/../admin", { cookie: a.token, body: {} })).status).toBe(404);
  });

  it("GET /models proxies the model list with the review note", async () => {
    const { token } = await astronaut();
    const out = await (await call("GET", "/models", { cookie: token })).json<any>();
    expect(out.models[0].model_id).toBe("EVA-3");
    expect(out.review_note).toMatch(/not a diagnosis/);
  });
});
