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
  it("lists cloudflare_access first when configured (one sign-in for astronauts and surgeons)", () => {
    expect(enabledProviders(env, API_URL)).toEqual(["cloudflare_access"]);
    expect(enabledProviders({ ...env, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s", TURNSTILE_SITE_KEY: "test-site", TURNSTILE_SECRET: "test-secret" }, API_URL)).toEqual(["cloudflare_access", "google"]);
    expect(enabledProviders({ ...env, ACCESS_AUD: "" }, API_URL)).toEqual([]);
  });

  it("login page has no staff link, no 'different email' or sign-up prompt", async () => {
    const page = await (await call("GET", "/login")).text();
    expect(page).not.toContain("/auth/access/staff");
    expect(page).not.toContain("Use a different email");
    expect(page).not.toContain("New to EVAde");
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

describe("flight surgeon role", () => {
  const me = async (res: Response) => (await call("GET", "/auth/me", { Cookie: `__Host-evade_session=${tokenFrom(res)}` })).json<any>();

  it("promotes a verified Access email listed in FLIGHT_SURGEON_EMAILS at login, and only that email", async () => {
    env.FLIGHT_SURGEON_EMAILS = " Doc@Evade.Health , other@evade.health";
    const doc = await login(await sign({ sub: "doc", email: "doc@evade.health" }));
    expect((await me(doc)).role).toBe("flight_surgeon");
    const crew = await login(await sign({ sub: "crew", email: "crew@evade.health" }));
    expect((await me(crew)).role).toBe("astronaut");
  });

  it("keeps the D1 role authoritative: never demotes at login, and revocation applies to the next request", async () => {
    const first = await login(await sign({ sub: "doc", email: "doc@evade.health" }));
    const userId = row("SELECT user_id FROM auth_identities WHERE subject='doc'").user_id;
    expect((await me(first)).role).toBe("astronaut");
    (env.DB as any).raw.prepare("UPDATE users SET role='flight_surgeon' WHERE user_id=?").run(userId);
    expect((await me(first)).role).toBe("flight_surgeon"); // existing session picks up the grant
    const again = await login(await sign({ sub: "doc", email: "doc@evade.health" }));
    expect((await me(again)).role).toBe("flight_surgeon"); // not listed in FLIGHT_SURGEON_EMAILS, still not demoted
    (env.DB as any).raw.prepare("UPDATE users SET role='astronaut' WHERE user_id=?").run(userId);
    expect((await me(again)).role).toBe("astronaut");
  });

  it("keeps /auth/access/staff working for old links (staff-app audience, short session)", async () => {
    const wrongAud = await login(await sign({ sub: "doc" }), "/auth/access/staff");
    expect(wrongAud.status).toBe(401);
    const ok = await login(await sign({ sub: "doc", aud: [STAFF_AUD] }), "/auth/access/staff");
    expect(ok.status).toBe(302);
    expect(ok.headers.get("Set-Cookie")).toMatch(/Max-Age=(1[0-7]\d\d|1800|\d{1,3});/);
    expect((await me(ok)).role).toBe("astronaut"); // the path no longer grants anything by itself
  });
});

describe("account linking by verified email", () => {
  it("links a first Access login to the existing account with the same verified email", async () => {
    const raw = (env.DB as any).raw;
    raw.prepare("INSERT INTO users (user_id, display_name, role) VALUES ('existing-user', 'Vega', 'astronaut')").run();
    raw.prepare("INSERT INTO auth_identities (provider, subject, user_id, email) VALUES ('google', 'g-1', 'existing-user', 'vega@evade.health')").run();
    const res = await login(await sign({ sub: "access-vega", email: "Vega@Evade.Health" }));
    expect(res.status).toBe(302);
    expect(row("SELECT user_id FROM auth_identities WHERE provider='cloudflare_access' AND subject='access-vega'").user_id).toBe("existing-user");
    expect(seeded).toEqual([]);
  });

  it("does not link to an account whose only matching email is unverified (dev login)", async () => {
    const raw = (env.DB as any).raw;
    raw.prepare("INSERT INTO users (user_id, display_name, role) VALUES ('dev-user', 'Dev', 'astronaut')").run();
    raw.prepare("INSERT INTO auth_identities (provider, subject, user_id, email) VALUES ('dev', 'dev:vega@evade.health', 'dev-user', 'vega@evade.health')").run();
    await login(await sign({ sub: "access-vega" }));
    expect(row("SELECT user_id FROM auth_identities WHERE provider='cloudflare_access' AND subject='access-vega'").user_id).not.toBe("dev-user");
  });
});

describe("localhost dev login", () => {
  const LOCAL = "http://localhost:8787";
  async function devLogin(email: string, role?: string) {
    const form = new URLSearchParams({ provider: "dev", dev_email: email, redirect: "http://localhost:5180/" });
    if (role) form.set("dev_role", role);
    const startUrl = new URL(`${LOCAL}/auth/start`);
    const start = await handleAuth(new Request(startUrl, {
      method: "POST", body: form, headers: { Origin: "http://localhost:5180", "Content-Type": "application/x-www-form-urlencoded" },
    }), env, startUrl, seedTasks);
    expect(start!.status).toBe(303);
    const oauth = /evade_oauth=([^;]*)/.exec(start!.headers.get("Set-Cookie") ?? "")![1];
    const cbUrl = new URL(start!.headers.get("Location")!);
    const cb = await handleAuth(new Request(cbUrl, { headers: { Cookie: `evade_oauth=${oauth}` } }), env, cbUrl, seedTasks);
    expect(cb!.status).toBe(302);
    const session = /evade_session=([^;]*)/.exec(cb!.headers.get("Set-Cookie") ?? "")![1];
    const meUrl = new URL(`${LOCAL}/auth/me`);
    return (await handleAuth(new Request(meUrl, { headers: { Cookie: `evade_session=${session}` } }), env, meUrl, seedTasks))!.json<any>();
  }

  it("can sign in as an astronaut or a flight surgeon on localhost only", async () => {
    env = { ...env, DEV_LOGIN: "true", ALLOWED_ORIGINS: "http://localhost:5180", FRONTEND_URL: "http://localhost:5180" };
    expect((await devLogin("astro@test.local")).role).toBe("astronaut");
    expect((await devLogin("doc@test.local", "flight_surgeon")).role).toBe("flight_surgeon");
    expect(enabledProviders(env, new URL("https://api.evade.health"))).not.toContain("dev");
    expect(enabledProviders(env, new URL(LOCAL))).toContain("dev");
    const page = await (await handleAuth(new Request(`${LOCAL}/login`), env, new URL(`${LOCAL}/login`), seedTasks))!.text();
    expect(page).toContain('name="dev_role"');
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
