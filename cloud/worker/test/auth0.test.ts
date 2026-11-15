// Auth0 login tests: real auth.ts, real D1 schema (migrations run in node:sqlite), in-memory KV, mocked Auth0 HTTP.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enabledProviders, handleAuth, linkIdentity, roleFromClaim, ROLES_CLAIM, type AuthEnv } from "../src/auth";

// ---------- fakes ----------
function fakeD1(): D1Database {
  const db = new DatabaseSync(":memory:");
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

function fakeKV(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string, type?: string) => {
      const v = store.get(k);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    put: async (k: string, v: string) => void store.set(k, v),
    delete: async (k: string) => void store.delete(k),
  } as any;
}

const DOMAIN = "evade-test.us.auth0.com";
const CLIENT_ID = "test-client-id";
const API = "https://api.evade.health";
const FRONTEND = "https://evade.health";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  jwk = { ...await exportJWK(keys.publicKey), kid: "fixture-key", alg: "RS256" };
});
let env: AuthEnv & { SESSIONS: ReturnType<typeof fakeKV> };
let seeded: string[];
const seedTasks = async (id: string) => void seeded.push(id);

/** What the mocked Auth0 returns for the next login. */
let auth0User: { claims: Record<string, unknown>; userinfo?: Record<string, unknown>; tampered?: boolean };
let tokenRequests: URLSearchParams[];
let nonce: string;

beforeEach(() => {
  env = {
    DB: fakeD1(),
    SESSIONS: fakeKV(),
    AUTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
    AUTH0_DOMAIN: DOMAIN,
    AUTH0_CLIENT_ID: CLIENT_ID,
    AUTH0_CLIENT_SECRET: "test-secret",
    GOOGLE_CLIENT_ID: "g-id",
    GOOGLE_CLIENT_SECRET: "g-secret",
    TURNSTILE_SITE_KEY: "test-site-key",
    TURNSTILE_SECRET: "test-turnstile-secret",
    ALLOWED_ORIGINS: FRONTEND,
    FRONTEND_URL: FRONTEND,
  };
  seeded = [];
  tokenRequests = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url === `https://${DOMAIN}/oauth/token`) {
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: `https://${DOMAIN}/`, aud: CLIENT_ID, exp: now + 3600, iat: now, nonce, ...auth0User.claims };
      const signed = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "fixture-key" }).sign(keys.privateKey);
      const [header, payload, signature] = signed.split(".");
      const badSignature = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
      const token = auth0User.tampered ? `${header}.${payload}.${badSignature}` : signed;
      return Response.json({ access_token: "fixture-access-token", id_token: token, token_type: "Bearer" });
    }
    if (url === `https://${DOMAIN}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url === `https://${DOMAIN}/userinfo`) return Response.json(auth0User.userinfo ?? auth0User.claims);
    if (url === "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
      const valid = new URLSearchParams(String(init?.body)).get("response") === "valid";
      return Response.json({ success: valid, hostname: "evade.health", action: "login" });
    }
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access-token" });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") return Response.json({ sub: "direct-fixture" });
    throw new Error("unexpected fetch");
  });
});
afterEach(() => {
  (env.DB as D1Database & { raw: DatabaseSync }).raw.close();
  vi.unstubAllGlobals();
});

// ---------- helpers ----------
const call = async (method: string, path: string, init: RequestInit = {}) => {
  const url = new URL(API + path);
  const headers = new Headers(init.headers);
  if (!headers.has("Origin")) headers.set("Origin", FRONTEND);
  const res = await handleAuth(new Request(url, { method, redirect: "manual", ...init, headers }), env, url, seedTasks);
  if (!res) throw new Error(`not an auth route: ${path}`);
  return res;
};
const form = (fields: Record<string, string>) => new URLSearchParams({ "cf-turnstile-response": "valid", ...fields });
const cookies = (response: Response, name: string) => response.headers.getSetCookie()
  .find(value => value.startsWith(`__Host-evade_${name}=`))?.split(";")[0] ?? "";

async function callback(start: Response, provider = "auth0", browserCookie = cookies(start, "oauth")) {
  const authorize = new URL(start.headers.get("Location")!);
  nonce = authorize.searchParams.get("nonce")!;
  return call("GET", `/auth/callback/${provider}?code=abc&state=${authorize.searchParams.get("state")}`, {
    headers: { Cookie: browserCookie },
  });
}

/** Full Auth0 round trip; returns the session cookie value and callback response. */
async function login(claims: Record<string, unknown>, opts: Omit<typeof auth0User, "claims"> = {}) {
  auth0User = { claims, ...opts };
  const start = await call("POST", "/auth/start", { body: form({ provider: "auth0", redirect: FRONTEND + "/dashboard" }) });
  expect(start.status).toBe(303);
  const authorize = new URL(start.headers.get("Location")!);
  const cb = await callback(start);
  return { authorize, cb, cookie: cb.headers.getSetCookie().find(value => value.startsWith("__Host-evade_session=")) ?? "", token: cookies(cb, "session"), start };
}
const row = (sql: string, ...args: unknown[]) => (env.DB as any).raw.prepare(sql).get(...args);

// ---------- tests ----------
describe("providers", () => {
  it("lists auth0 first when configured, with direct providers as fallback", async () => {
    expect(enabledProviders(env, new URL(API))).toEqual(["auth0", "google"]);
    const res = await call("GET", "/auth/providers");
    expect(await res.json()).toMatchObject({ providers: ["auth0", "google"], default_provider: "auth0" });
  });

  it("omits auth0 when any of its secrets is missing", () => {
    const url = new URL(API);
    expect(enabledProviders({ ...env, AUTH0_CLIENT_SECRET: undefined }, url)).toEqual(["google"]);
    expect(enabledProviders({ ...env, AUTH0_DOMAIN: DOMAIN + "@other.example" }, url)).toEqual(["google"]);
    expect(enabledProviders({ ...env, TURNSTILE_SECRET: undefined }, url)).toEqual([]);
  });

  it("defaults to auth0 when the form names no provider", async () => {
    const res = await call("POST", "/auth/start", { body: form({ redirect: "https://evade.health/" }) });
    expect(new URL(res.headers.get("Location")!).host).toBe(DOMAIN);
  });
});

describe("/auth/start → Auth0 authorize", () => {
  it("sends PKCE (S256), state, scope and the callback URL", async () => {
    const res = await call("POST", "/auth/start", { body: form({ provider: "auth0" }) });
    const u = new URL(res.headers.get("Location")!);
    expect(u.origin + u.pathname).toBe(`https://${DOMAIN}/authorize`);
    expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(u.searchParams.get("scope")).toBe("openid profile email");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("redirect_uri")).toBe(`${API}/auth/callback/auth0`);
    expect(u.searchParams.get("screen_hint")).toBeNull();
    const saved = JSON.parse(env.SESSIONS.store.get(`oauth:${u.searchParams.get("state")}`)!);
    expect(saved.provider).toBe("auth0");
    expect(saved.verifier).toBeTruthy();
    expect(u.searchParams.get("nonce")).toBe(saved.nonce);
    expect(cookies(res, "oauth")).toMatch(/^__Host-evade_oauth=/);
  });

  it("blocks a foreign origin and a failed Turnstile challenge", async () => {
    const badOrigin = await call("POST", "/auth/start", { body: form({}), headers: { Origin: "https://other.example" } });
    expect(badOrigin.status).toBe(403);
    const badChallenge = await call("POST", "/auth/start", { body: form({ "cf-turnstile-response": "invalid" }) });
    expect(new URL(badChallenge.headers.get("Location")!).pathname).toBe("/login");
    expect(cookies(badChallenge, "oauth")).toBe("");
  });

  it("passes screen_hint=signup (form or query), and ignores other values", async () => {
    const viaForm = await call("POST", "/auth/start", { body: form({ provider: "auth0", screen_hint: "signup" }) });
    expect(new URL(viaForm.headers.get("Location")!).searchParams.get("screen_hint")).toBe("signup");
    const viaQuery = await call("POST", "/auth/start?screen_hint=signup", { body: form({ provider: "auth0" }) });
    expect(new URL(viaQuery.headers.get("Location")!).searchParams.get("screen_hint")).toBe("signup");
    const bogus = await call("POST", "/auth/start", { body: form({ provider: "auth0", screen_hint: "evil" }) });
    expect(new URL(bogus.headers.get("Location")!).searchParams.get("screen_hint")).toBeNull();
  });

  it("does not open-redirect to foreign sites after login", async () => {
    auth0User = { claims: { sub: "auth0|x", email: "x@e.com", email_verified: true } };
    const start = await call("POST", "/auth/start", { body: form({ provider: "auth0", redirect: "https://evil.example/steal" }) });
    const cb = await callback(start);
    expect(cb.headers.get("Location")).toBe("https://evade.health/");
  });
});

describe("callback → D1 astronaut", () => {
  it("creates a new astronaut keyed by Auth0 sub, seeds tasks, and sets a secure session cookie", async () => {
    const { cb, cookie } = await login({ sub: "google-oauth2|111", email: "vega@evade.health", email_verified: true, name: "Cmdr. Vega" });
    expect(cb.status).toBe(302);
    expect(cb.headers.get("Location")).toBe("https://evade.health/dashboard");
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/^__Host-evade_session=/);
    expect(cookie).not.toMatch(/Domain=/);
    const ident = row("SELECT * FROM auth_identities WHERE provider='auth0' AND subject='google-oauth2|111'");
    expect(ident.email).toBe("vega@evade.health");
    const user = row("SELECT * FROM users WHERE user_id=?", ident.user_id);
    expect(user.role).toBe("astronaut");
    expect(user.display_name).toBe("Cmdr. Vega");
    expect(seeded).toEqual([ident.user_id]);
    expect(tokenRequests[0].get("code_verifier")).toBeTruthy();
    expect(tokenRequests[0].get("grant_type")).toBe("authorization_code");
  });

  it("does not store an unverified email", async () => {
    await login({ sub: "auth0|unverified", email: "who@knows.com", email_verified: false, nickname: "who" });
    const ident = row("SELECT * FROM auth_identities WHERE subject='auth0|unverified'");
    expect(ident.email).toBeNull();
    expect(row("SELECT display_name FROM users WHERE user_id=?", ident.user_id).display_name).toBe("who");
  });

  it("clears an address when a returning user's email loses verification", async () => {
    const sub = "auth0|changed-email";
    await login({ sub, email: "test@example.invalid", email_verified: true, name: "Crew" });
    await login({ sub, email: "test@example.invalid", email_verified: false, name: "test@example.invalid" });
    expect(row("SELECT email FROM auth_identities WHERE subject=?", sub).email).toBeNull();
  });

  it("creates passwordless-email users exactly like social users", async () => {
    await login({ sub: "email|abc123", email: "astro@evade.health", email_verified: true });
    const ident = row("SELECT * FROM auth_identities WHERE provider='auth0' AND subject='email|abc123'");
    expect(ident.email).toBe("astro@evade.health");
    expect(row("SELECT role FROM users WHERE user_id=?", ident.user_id).role).toBe("astronaut");
    expect(seeded).toHaveLength(1);
  });

  it("reuses the same astronaut on later logins (no duplicate users)", async () => {
    await login({ sub: "auth0|same", email: "s@e.com", email_verified: true });
    await login({ sub: "auth0|same", email: "s@e.com", email_verified: true });
    expect(row("SELECT COUNT(*) AS n FROM auth_identities WHERE subject='auth0|same'").n).toBe(1);
    expect(row("SELECT COUNT(*) AS n FROM users").n).toBe(1);
    expect(seeded).toHaveLength(1);
  });

  it("links simultaneous first logins to the same D1 user", async () => {
    const identity = { provider: "auth0", subject: "email|race" };
    const [first, second] = await Promise.all([
      linkIdentity(env, identity, seedTasks, "astronaut"),
      linkIdentity(env, identity, seedTasks, "astronaut"),
    ]);
    expect(first.user_id).toBe(second.user_id);
    expect(row("SELECT COUNT(*) AS n FROM users").n).toBe(1);
    expect(seeded).toEqual([first.user_id]);
  });

  it("rejects a replayed or unknown state", async () => {
    const { start } = await login({ sub: "auth0|r", email: "r@e.com", email_verified: true });
    const replay = await callback(start);
    expect(new URL(replay.headers.get("Location")!).pathname).toBe("/login");
    expect(cookies(replay, "session")).toBe("");
  });

  it("requires the browser that started the authorization", async () => {
    const start = await call("POST", "/auth/start", { body: form({ provider: "auth0" }) });
    const wrongBrowser = await callback(start, "auth0", "__Host-evade_oauth=wrong");
    expect(new URL(wrongBrowser.headers.get("Location")!).pathname).toBe("/login");
    expect(tokenRequests).toHaveLength(0);
  });

  it("rejects an ID token for another app (audience) or issuer", async () => {
    const bad1 = await login({ sub: "auth0|a", aud: "someone-else" });
    expect(cookies(bad1.cb, "session")).toBe("");
    const bad2 = await login({ sub: "auth0|b", iss: "https://evil.auth0.com/" });
    expect(cookies(bad2.cb, "session")).toBe("");
    const bad3 = await login({ sub: "auth0|c", exp: Math.floor(Date.now() / 1000) - 3600 });
    expect(cookies(bad3.cb, "session")).toBe("");
    expect(row("SELECT COUNT(*) AS n FROM users").n).toBe(0);
  });

  it("rejects a forged staff token or a nonce from a different login", async () => {
    const forged = await login({ sub: "auth0|forged", [ROLES_CLAIM]: ["admin"] }, { tampered: true });
    const late = await login({ sub: "auth0|wrong-nonce", nonce: "different-login", [ROLES_CLAIM]: ["admin"] });
    expect(cookies(forged.cb, "session")).toBe("");
    expect(cookies(late.cb, "session")).toBe("");
    expect(row("SELECT COUNT(*) AS n FROM users").n).toBe(0);
  });

  it("rejects a userinfo sub that doesn't match the ID token", async () => {
    const { cb } = await login({ sub: "auth0|real" }, { userinfo: { sub: "auth0|other" } });
    expect(cookies(cb, "session")).toBe("");
  });
});

describe("roles from the https://evade.health/roles claim", () => {
  it("maps the highest staff role and stores it in the session", async () => {
    const { token } = await login({ sub: "auth0|doc", email: "doc@e.com", email_verified: true, [ROLES_CLAIM]: ["therapist", "flight_surgeon"] });
    const ident = row("SELECT user_id FROM auth_identities WHERE subject='auth0|doc'");
    expect(row("SELECT role FROM users WHERE user_id=?", ident.user_id).role).toBe("flight_surgeon");
    expect(seeded).toHaveLength(0); // staff don't get astronaut tasks
    const me = await call("GET", "/auth/me", { headers: { Cookie: token } });
    expect((await me.json<any>()).role).toBe("flight_surgeon");
  });

  it("re-syncs the role on every login (promotion and removal)", async () => {
    await login({ sub: "auth0|p", [ROLES_CLAIM]: [] });
    const id = row("SELECT user_id FROM auth_identities WHERE subject='auth0|p'").user_id;
    expect(row("SELECT role FROM users WHERE user_id=?", id).role).toBe("astronaut");
    const staff = await login({ sub: "auth0|p", [ROLES_CLAIM]: ["admin"] });
    expect(row("SELECT role FROM users WHERE user_id=?", id).role).toBe("admin");
    await login({ sub: "auth0|p" }); // role removed in Auth0
    expect(row("SELECT role FROM users WHERE user_id=?", id).role).toBe("astronaut");
    const me = await call("GET", "/auth/me", { headers: { Cookie: staff.token } });
    expect((await me.json<any>()).role).toBe("astronaut");
  });

  it("does not grant staff privileges through a direct fallback linked to a staff account", async () => {
    await login({ sub: "auth0|p", [ROLES_CLAIM]: ["admin"] });
    const id = row("SELECT user_id FROM auth_identities WHERE subject='auth0|p'").user_id;
    await env.DB.prepare("INSERT INTO auth_identities (provider,subject,user_id) VALUES ('google','direct-fixture',?)").bind(id).run();
    const start = await call("POST", "/auth/start", { body: form({ provider: "google" }) });
    const response = await callback(start, "google");
    const me = await call("GET", "/auth/me", { headers: { Cookie: cookies(response, "session") } });
    expect((await me.json<any>()).role).toBe("astronaut");
    expect(row("SELECT role FROM users WHERE user_id=?", id).role).toBe("admin");
  });

  it("roleFromClaim ignores unknown or malformed values", () => {
    expect(roleFromClaim(undefined)).toBe("astronaut");
    expect(roleFromClaim("admin")).toBe("astronaut"); // must be an array
    expect(roleFromClaim(["superuser"])).toBe("astronaut");
    expect(roleFromClaim(["Therapist "])).toBe("astronaut");
  });
});

describe("/auth/logout", () => {
  it("a trusted POST ends the KV session and redirects through Auth0 /v2/logout", async () => {
    const { token } = await login({ sub: "auth0|out", email: "o@e.com", email_verified: true });
    expect((await call("GET", "/auth/logout", { headers: { Cookie: token } })).status).toBe(405);
    expect((await call("POST", "/auth/logout", { headers: { Cookie: token, Origin: "https://other.example" } })).status).toBe(403);
    const res = await call("POST", "/auth/logout?redirect=https://other.example", { headers: { Cookie: token } });
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("Location")!);
    expect(loc.origin + loc.pathname).toBe(`https://${DOMAIN}/v2/logout`);
    expect(loc.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(loc.searchParams.get("returnTo")).toBe("https://evade.health");
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
    const me = await call("GET", "/auth/me", { headers: { Cookie: token } });
    expect(me.status).toBe(401);
  });

  it("POST (fetch from the SPA) returns the Auth0 logout URL to visit", async () => {
    const { token } = await login({ sub: "auth0|out2" });
    const res = await call("POST", "/auth/logout", { headers: { Cookie: token, Accept: "application/json" } });
    expect(res.status).toBe(200);
    expect((await res.json<any>()).logout_url).toContain(`https://${DOMAIN}/v2/logout`);
  });

  it("without a session it just clears the cookie", async () => {
    const res = await call("POST", "/auth/logout");
    expect(res.status).toBe(204);
  });
});
