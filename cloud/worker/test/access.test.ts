// Cloudflare Access login tests: real auth.ts + access.ts, real D1 schema (node:sqlite), in-memory KV,
// Access JWTs signed with a locally generated RSA key served from a mocked /cdn-cgi/access/certs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { _resetAccessKeyCache, verifyAccessJwt } from "../src/access";
import { enabledProviders, handleAuth, type AuthEnv } from "../src/auth";

vi.mock("../src/live", () => ({ CrewFeed: class {} }));

// ---------- fakes ----------
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = join(__dirname, "..", "migrations");
  // 0008 deletes the seeded demo astronaut. Keep the file, but do not apply it.
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f !== "0008_remove_demo_data.sql").sort()) db.exec(readFileSync(join(dir, f), "utf8"));
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
        const results = statements.map(statement => statement.execute());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    raw: db,
  } as unknown as D1Database;
}

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (k: string, type?: string) => {
      const v = store.get(k);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as any;
}

// ---------- signing ----------
const TEAM = "evade.cloudflareaccess.com";
const AUD = "aud-login-123";
const STAFF_AUD = "aud-staff-456";
let signer: CryptoKeyPair;
let otherSigner: CryptoKeyPair;
let publicJwk: JsonWebKey;
let certsFetches = 0;

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  Buffer.from(typeof b === "string" ? b : new Uint8Array(b as ArrayBuffer)).toString("base64url");

async function sign(claims: Record<string, unknown>, opts: { key?: CryptoKey; kid?: string; alg?: string } = {}) {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: `https://${TEAM}`, aud: [AUD], sub: "user-1", email: "Vega@Evade.Health", type: "app", iat: now, nbf: now, exp: now + 3600, ...claims };
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", opts.key ?? signer.privateKey, new TextEncoder().encode(data));
  return `${data}.${b64url(sig)}`;
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as const;
  signer = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherSigner = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey("jwk", signer.publicKey);
});

let env: AuthEnv;
let seeded: string[];
const seedTasks = async (id: string) => void seeded.push(id);

beforeEach(() => {
  _resetAccessKeyCache();
  certsFetches = 0;
  env = {
    DB: fakeD1(),
    SESSIONS: fakeKV(),
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ACCESS_STAFF_AUD: STAFF_AUD,
    ALLOWED_ORIGINS: "https://evade.health",
    FRONTEND_URL: "https://evade.health",
  };
  seeded = [];
  vi.stubGlobal("fetch", async (input: RequestInfo) => {
    const url = String(input);
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      certsFetches++;
      return Response.json({ keys: [{ ...publicJwk, kid: "k1", alg: "RS256", use: "sig" }] });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

// ---------- helpers ----------
const API = "https://api.evade.health";
const API_URL = new URL(API);
async function call(method: string, path: string, headers: Record<string, string> = {}) {
  const url = new URL(API + path);
  const res = await handleAuth(new Request(url, { method, headers, redirect: "manual" }), env, url, seedTasks);
  if (!res) throw new Error(`not an auth route: ${path}`);
  return res;
}
const login = async (token: string | null, path = "/auth/access?redirect=https://evade.health/dashboard") =>
  call("GET", path, token ? { "Cf-Access-Jwt-Assertion": token } : {});
const row = (sql: string, ...args: unknown[]) => (env.DB as any).raw.prepare(sql).get(...args);
const tokenFrom = (res: Response) => /evade_session=([^;]*)/.exec(res.headers.get("Set-Cookie") ?? "")?.[1] ?? "";

// ---------- tests ----------
describe("providers", () => {
  it("lists cloudflare_access first when configured", () => {
    expect(enabledProviders(env, API_URL)).toEqual(["cloudflare_access", "cloudflare_access_staff"]);
    expect(enabledProviders({ ...env, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", TURNSTILE_SITE_KEY: "test-site", TURNSTILE_SECRET: "test-secret" }, API_URL)).toEqual(["cloudflare_access", "cloudflare_access_staff", "google"]);
    expect(enabledProviders({ ...env, ACCESS_AUD: "" }, API_URL)).toEqual([]);
    expect(enabledProviders({ ...env, ACCESS_STAFF_AUD: "" }, API_URL)).toEqual(["cloudflare_access"]);
    expect(enabledProviders({ ...env, ACCESS_STAFF_AUD: env.ACCESS_AUD }, API_URL)).toEqual(["cloudflare_access"]);
  });

  it("login page links to /auth/access and keeps the redirect", async () => {
    const res = await call("GET", "/login?redirect=https://evade.health/journal");
    const page = await res.text();
    expect(page).toContain(`href="/auth/access?redirect=${encodeURIComponent("https://evade.health/journal")}"`);
  });
});

describe("verifyAccessJwt", () => {
  it("accepts a valid token and lowercases the email", async () => {
    const id = await verifyAccessJwt(await sign({}), env);
    expect(id).toEqual({ subject: "user-1", email: "vega@evade.health", name: "vega", expiresAt: expect.any(Number) });
  });

  it("rejects a token signed by another key", async () => {
    await expect(verifyAccessJwt(await sign({}, { key: otherSigner.privateKey }), env)).rejects.toThrow(/signature/);
  });

  it("rejects wrong audience, issuer, expired, not-yet-valid and service tokens", async () => {
    await expect(verifyAccessJwt(await sign({ aud: ["someone-else"] }), env)).rejects.toThrow(/aud/);
    await expect(verifyAccessJwt(await sign({ iss: "https://evil.cloudflareaccess.com" }), env)).rejects.toThrow(/iss/);
    await expect(verifyAccessJwt(await sign({ exp: Math.floor(Date.now() / 1000) - 3600 }), env)).rejects.toThrow(/exp/);
    await expect(verifyAccessJwt(await sign({ nbf: Math.floor(Date.now() / 1000) + 3600 }), env)).rejects.toThrow(/nbf/);
    await expect(verifyAccessJwt(await sign({ sub: "" }), env)).rejects.toThrow(/subject/);
    await expect(verifyAccessJwt(await sign({ type: "org" }), env)).rejects.toThrow(/application token/);
  });

  it("rejects a non-RS256 token and an unknown key id without a second immediate keys request", async () => {
    await expect(verifyAccessJwt(await sign({}, { alg: "none" }), env)).rejects.toThrow(/alg/);
    await expect(verifyAccessJwt(await sign({}, { kid: "nope" }), env)).rejects.toThrow(/applicable key/);
    expect(certsFetches).toBe(1);
  });

  it("caches the signing keys", async () => {
    await verifyAccessJwt(await sign({}), env);
    await verifyAccessJwt(await sign({ sub: "user-2" }), env);
    expect(certsFetches).toBe(1);
  });
});

describe("GET /auth/access", () => {
  it("creates an astronaut, seeds tasks, sets a secure session cookie and redirects", async () => {
    const res = await login(await sign({}));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://evade.health/dashboard");
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie.startsWith("__Host-evade_session=")).toBe(true);
    expect(cookie).not.toContain("Domain=");
    const ident = row("SELECT * FROM auth_identities WHERE provider='cloudflare_access' AND subject='user-1'");
    expect(ident.email).toBe("vega@evade.health");
    expect(row("SELECT role FROM users WHERE user_id=?", ident.user_id).role).toBe("astronaut");
    expect(seeded).toEqual([ident.user_id]);
    const me = await call("GET", "/auth/me", { Cookie: `__Host-evade_session=${tokenFrom(res)}` });
    expect(me.status).toBe(200);
    expect((await me.json<any>()).role).toBe("astronaut");
  });

  it("reuses the same astronaut on later logins", async () => {
    await login(await sign({}));
    await login(await sign({}));
    expect(row("SELECT COUNT(*) AS n FROM users WHERE user_id NOT LIKE '00000000-0000-4000-8000-%'").n).toBe(1);
    expect(seeded).toHaveLength(1);
  });

  it("refuses requests without, or with a forged, Access assertion", async () => {
    const none = await login(null);
    expect(none.status).toBe(401);
    expect(none.headers.get("Set-Cookie")).toBeNull();
    const forged = await login(await sign({}, { key: otherSigner.privateKey }));
    expect(forged.status).toBe(401);
    expect(row("SELECT COUNT(*) AS n FROM users WHERE user_id NOT LIKE '00000000-0000-4000-8000-%'").n).toBe(0);
  });

  it("does not open-redirect", async () => {
    const res = await login(await sign({}), "/auth/access?redirect=https://evil.example/x");
    expect(res.headers.get("Location")).toBe("https://evade.health");
  });

  it("returns 503 when Access isn't configured", async () => {
    env = { ...env, ACCESS_AUD: "" };
    expect((await login(await sign({}))).status).toBe(503);
  });
});

describe("staff login (/auth/access/staff)", () => {
  it("records staff enrollment only through the staff application", async () => {
    await login(await sign({ sub: "crew-only" }));
    expect(row("SELECT * FROM auth_identities WHERE provider='cloudflare_access_staff' AND subject=?", "crew-only")).toBeUndefined();
  });

  async function makeStaff(sub: string, role = "flight_surgeon") {
    await login(await sign({ sub, email: `${sub}@evade.health` }));
    const id = row("SELECT user_id FROM auth_identities WHERE subject=?", sub).user_id;
    (env.DB as any).raw.prepare("UPDATE users SET role=? WHERE user_id=?").run(role, id);
    return id;
  }

  it("staff must use the staff path", async () => {
    await makeStaff("doc");
    const res = await login(await sign({ sub: "doc", email: "doc@evade.health" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("staff path needs a token for the staff app (its audience)", async () => {
    await makeStaff("doc");
    const wrongAud = await login(await sign({ sub: "doc" }), "/auth/access/staff");
    expect(wrongAud.status).toBe(401);
    const ok = await login(await sign({ sub: "doc", aud: [STAFF_AUD] }), "/auth/access/staff");
    expect(ok.status).toBe(302);
    const me = await call("GET", "/auth/me", { Cookie: `__Host-evade_session=${tokenFrom(ok)}` });
    expect((await me.json<any>()).role).toBe("flight_surgeon");
  });

  it("disables staff sign-in when its audience is empty or matches the crew audience", async () => {
    await makeStaff("doc");
    for (const audience of ["", AUD]) {
      env.ACCESS_STAFF_AUD = audience;
      const token = await sign({ sub: "doc" });
      expect((await login(token, "/auth/access/staff")).status).toBe(503);
      expect((await login(token)).status).toBe(403);
    }
  });

  it("enrolls a verified staff-app identity without granting a session until D1 promotion", async () => {
    const token = await sign({ aud: [STAFF_AUD], sub: "pending-staff", email: "New.Staff@example.com" });
    const staffPath = `/auth/access/staff?redirect=${encodeURIComponent("https://evade.health/admin")}`;
    const response = await login(token, staffPath);
    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const identity = row("SELECT user_id FROM auth_identities WHERE provider='cloudflare_access' AND subject=?", "pending-staff");
    const page = await response.text();
    expect(page).toContain("Staff access is pending for new.staff@example.com.");
    expect(page).toContain(identity.user_id);
    expect(page).toContain('href="https://evade.health/login"');
    expect(page).toContain("Use a different email");
    expect(row("SELECT role FROM users WHERE user_id=?", identity.user_id).role).toBe("astronaut");
    expect(row("SELECT user_id FROM auth_identities WHERE provider='cloudflare_access_staff' AND subject=?", "pending-staff"))
      .toMatchObject({ user_id: identity.user_id });

    (env.DB as any).raw.prepare("UPDATE users SET role='flight_surgeon' WHERE user_id=?").run(identity.user_id);
    const approved = await login(token, staffPath);
    expect(approved.status).toBe(302);
    expect(approved.headers.get("Location")).toBe("https://evade.health/admin");
    const session = await call("GET", "/auth/me", { Cookie: `__Host-evade_session=${tokenFrom(approved)}` });
    expect((await session.json<any>())).toMatchObject({ user: { user_id: identity.user_id }, role: "flight_surgeon", demo: false });
  });
  it("invalidates a staff API session when the D1 role is revoked", async () => {
    const userId = await makeStaff("doc");
    const session = await login(await sign({ sub: "doc", aud: [STAFF_AUD] }), "/auth/access/staff");
    const headers = { Cookie: `__Host-evade_session=${tokenFrom(session)}` };
    expect((await call("GET", "/auth/me", headers)).status).toBe(200);
    (env.DB as any).raw.prepare("UPDATE users SET role='astronaut' WHERE user_id=?").run(userId);
    expect((await call("GET", "/auth/me", headers)).status).toBe(401);
  });
});

describe("logout", () => {
  it("rejects GET and untrusted POST and revokes the session on a trusted POST", async () => {
    const session = await login(await sign({}));
    const headers = { Cookie: `__Host-evade_session=${tokenFrom(session)}` };
    expect((await call("GET", "/auth/logout", headers)).status).toBe(405);
    expect((await call("POST", "/auth/logout", { ...headers, Origin: "https://untrusted.example" })).status).toBe(403);
    const logout = await call("POST", "/auth/logout", { ...headers, Origin: "https://evade.health" });
    expect(logout.status).toBe(200);
    expect(await logout.json()).toEqual({ logout_url: `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/logout` });
    expect((await call("GET", "/auth/me", headers)).status).toBe(401);
  });
});

it("denies cross-user, staff-only and unauthenticated requests at the Worker entry point", async () => {
  const session = await login(await sign({}));
  expect(session.status).toBe(302);
  const cookie = `__Host-evade_session=${tokenFrom(session)}`;
  const request = (path: string, headers?: Record<string, string>) =>
    worker.fetch(new Request(API + path, { headers }), env as Env, {} as ExecutionContext);

  const crossUser = await request("/users/someone-else/dashboard", { Cookie: cookie });
  expect(crossUser.status).toBe(403);
  expect(crossUser.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect((await request("/live/stats", { Cookie: cookie })).status).toBe(403);
  expect((await request("/live/stats")).status).toBe(401);
});
