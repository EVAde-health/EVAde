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

describe("localhost dev sign-in", () => {
  const LOCAL = "http://localhost:8787";
  const localEnv = () => ({ ...env, DEV_LOGIN: "true", ALLOWED_ORIGINS: "http://localhost:5180", FRONTEND_URL: "http://localhost:5180" });
  async function local(method: string, path: string, opts: { cookie?: string; body?: unknown; origin?: string | null; host?: string } = {}) {
    const url = new URL((opts.host ?? LOCAL) + path);
    const headers: Record<string, string> = {};
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.origin !== null && method === "POST") headers.Origin = opts.origin ?? LOCAL;
    const res = await handleAuth(new Request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }), env, url, seedTasks);
    return res!;
  }
  const cookieOf = (res: Response, name: string) => new RegExp(`evade_${name}=([^;]*)`).exec(res.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
  async function me(res: Response) {
    const session = cookieOf(res, "session");
    expect(session).not.toBe("");
    return (await local("GET", "/auth/me", { cookie: `evade_session=${session}` })).json<any>();
  }
  async function openPage() {
    const page = await local("GET", "/auth/local-access?redirect=http://localhost:5180/dashboard");
    expect(page.status).toBe(200);
    return { html: await page.text(), cookie: `evade_lac=${cookieOf(page, "lac")}` };
  }
  async function emailSignIn(email: string) {
    const { cookie } = await openPage();
    const sent = await local("POST", "/auth/local-access/code", { cookie, body: { email } });
    expect(sent.status).toBe(200);
    const { dev_code } = await sent.json<any>();
    const res = await local("POST", "/auth/local-access/verify", { cookie, body: { code: dev_code } });
    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ redirect: "http://localhost:5180/dashboard" });
    return me(res);
  }
  async function devStart(email: string, role?: string) {
    const form = new URLSearchParams({ provider: "dev", dev_email: email, redirect: "http://localhost:5180/" });
    if (role) form.set("dev_role", role);
    const startUrl = new URL(`${LOCAL}/auth/start`);
    const start = await handleAuth(new Request(startUrl, {
      method: "POST", body: form, headers: { Origin: "http://localhost:5180", "Content-Type": "application/x-www-form-urlencoded" },
    }), env, startUrl, seedTasks);
    const cbUrl = new URL(start!.headers.get("Location")!);
    const cb = await handleAuth(new Request(cbUrl, { headers: { Cookie: `evade_oauth=${cookieOf(start!, "oauth")}` } }), env, cbUrl, seedTasks);
    return me(cb!);
  }

  // A software authenticator: ES256 key, WebAuthn-shaped clientDataJSON/authenticatorData, DER signatures.
  const enc = new TextEncoder();
  const sha = async (s: string | Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));
  async function authData(counter: number) {
    const out = new Uint8Array(37);
    out.set(await sha("localhost"));
    out[32] = 0x05; // user present + verified
    new DataView(out.buffer).setUint32(33, counter);
    return out;
  }
  function rawToDer(raw: Uint8Array) {
    const int = (v: Uint8Array) => {
      let i = 0;
      while (i < v.length - 1 && v[i] === 0) i++;
      v = v.slice(i);
      return v[0] & 0x80 ? Uint8Array.from([0, ...v]) : v;
    };
    const r = int(raw.slice(0, 32)), s = int(raw.slice(32));
    return Uint8Array.from([0x30, r.length + s.length + 4, 0x02, r.length, ...r, 0x02, s.length, ...s]);
  }
  const clientData = (type: string, challenge: string, origin = LOCAL) => enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  beforeEach(() => { env = localEnv(); });

  it("also runs on a private LAN address (phone testing) but never on a public host", async () => {
    const LAN = "http://192.168.1.20:8787";
    env = { ...env, ALLOWED_ORIGINS: "http://localhost:5180,http://192.168.1.20:5180" };
    expect(enabledProviders(env, new URL(LAN))).toContain("dev");
    for (const host of ["http://8.8.8.8:8787", "http://172.32.0.1:8787", "http://192.169.1.1:8787"]) {
      expect(enabledProviders(env, new URL(host))).not.toContain("dev");
    }
    const access = await local("GET", "/auth/access?redirect=http://192.168.1.20:5180/dashboard", { host: LAN });
    expect(access.headers.get("Location")).toBe(`${LAN}/auth/local-access?redirect=${encodeURIComponent("http://192.168.1.20:5180/dashboard")}`);
    // A LAN origin that is not in ALLOWED_ORIGINS is still refused as a redirect target.
    const other = await local("GET", "/auth/access?redirect=http://192.168.1.99:5180/dashboard", { host: LAN });
    expect(other.headers.get("Location")).toBe(`${LAN}/auth/local-access?redirect=${encodeURIComponent("http://localhost:5180")}`);
    env = { ...env, DEV_LOGIN: "false" };
    expect((await local("GET", "/auth/local-access", { host: LAN })).status).toBe(404);
  });

  it("is only offered on localhost with DEV_LOGIN, and sends /auth/access there instead of failing", async () => {
    expect(enabledProviders(env, new URL("https://api.evade.health"))).not.toContain("dev");
    expect(enabledProviders(env, new URL(LOCAL))).toContain("dev");
    const access = await local("GET", "/auth/access?redirect=http://localhost:5180/dashboard");
    expect(access.status).toBe(302);
    expect(access.headers.get("Location")).toBe(`${LOCAL}/auth/local-access?redirect=${encodeURIComponent("http://localhost:5180/dashboard")}`);
    expect((await local("GET", "/auth/local-access", { host: "https://api.evade.health" })).status).toBe(404);
    expect((await local("GET", "/auth/access", { host: "https://api.evade.health" })).status).toBe(401);
    env = { ...env, DEV_LOGIN: "false" };
    expect((await local("GET", "/auth/local-access")).status).toBe(404);
    expect((await local("GET", "/auth/access")).status).toBe(401);
  });

  it("offers the passkey or emailed-code choice, and the worker login page has no role picker", async () => {
    const { html } = await openPage();
    expect(html).toContain("Sign in with a passkey");
    expect(html).toContain("Send login code");
    expect(html).toContain("Don&#39;t have a passkey? Set one up".replace("&#39;", "'"));
    const login = await (await local("GET", "/login")).text();
    expect(login).not.toContain("dev_role");
    expect(login).not.toContain("Flight surgeon");
    expect(login).toContain("/auth/access?redirect=");
  });

  it("signs the seeded test accounts in with their D1 roles through the emailed code", async () => {
    expect((await emailSignIn("vega@demo.evade.local")).user.user_id).toBe("00000000-0000-4000-8000-00000000d001");
    expect((await emailSignIn("VEGA@demo.evade.local ")).role).toBe("astronaut");
    const ortiz = await emailSignIn("ortiz@demo.evade.local");
    expect(ortiz.role).toBe("flight_surgeon");
    expect(ortiz.user.user_id).toBe("00000000-0000-4000-8000-00000000d002");
    const fresh = await emailSignIn("new.astro@test.local");
    expect(fresh.role).toBe("astronaut");
    expect(seeded).toContain(fresh.user.user_id);
  });

  it("rejects wrong codes, too many attempts, cross-origin posts and missing page state", async () => {
    const { cookie } = await openPage();
    expect((await local("POST", "/auth/local-access/verify", { cookie, body: { code: "123456" } })).status).toBe(400);
    expect((await local("POST", "/auth/local-access/code", { cookie, body: { email: "not-an-email" } })).status).toBe(422);
    const { dev_code } = await (await local("POST", "/auth/local-access/code", { cookie, body: { email: "a@test.local" } })).json<any>();
    const wrong = dev_code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await local("POST", "/auth/local-access/verify", { cookie, body: { code: wrong } })).status).toBe(401);
    expect((await local("POST", "/auth/local-access/verify", { cookie, body: { code: dev_code } })).status).toBe(429);
    expect((await local("POST", "/auth/local-access/code", { cookie, body: { email: "a@test.local" }, origin: "http://localhost:5180" })).status).toBe(403);
    expect((await local("POST", "/auth/local-access/code", { body: { email: "a@test.local" } })).status).toBe(401);
  });

  it("creates an account with a new passkey, then signs in with it (and rejects forged or replayed assertions)", async () => {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey));
    const credId = b64url(crypto.getRandomValues(new Uint8Array(32)));

    let { cookie } = await openPage();
    const opts = await (await local("POST", "/auth/local-access/passkey/options", { cookie, body: { mode: "register", email: "pk.astro@test.local" } })).json<any>();
    expect(opts.rp.id).toBe("localhost");
    const registered = await local("POST", "/auth/local-access/passkey/register", { cookie, body: {
      id: credId, clientDataJSON: b64url(clientData("webauthn.create", opts.challenge)), authenticatorData: b64url(await authData(0)),
      publicKey: b64url(spki), publicKeyAlgorithm: -7,
    } });
    expect(registered.status).toBe(200);
    const created = await me(registered);
    expect(created.role).toBe("astronaut");

    async function assertion(counter: number, tamper = false, origin = LOCAL) {
      ({ cookie } = await openPage());
      const o = await (await local("POST", "/auth/local-access/passkey/options", { cookie, body: { mode: "login" } })).json<any>();
      const cd = clientData("webauthn.get", o.challenge, origin);
      const ad = await authData(counter);
      const signed = new Uint8Array([...ad, ...await sha(cd)]);
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      if (tamper) raw[5] ^= 0xff;
      const body = { id: credId, clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(rawToDer(raw)) };
      return { res: await local("POST", "/auth/local-access/passkey/login", { cookie, body }), body };
    }
    const ok = await assertion(1);
    expect(ok.res.status).toBe(200);
    expect((await me(ok.res)).user.user_id).toBe(created.user.user_id);
    expect((await assertion(2, true)).res.status).toBe(401);
    expect((await assertion(1)).res.status).toBe(401); // counter must increase
    expect((await assertion(5, false, "http://evil.test")).res.status).toBe(401);
    // A captured assertion can't be replayed: the challenge is single-use.
    const good = await assertion(6);
    expect(good.res.status).toBe(200);
    expect((await local("POST", "/auth/local-access/passkey/login", { cookie, body: good.body })).status).toBe(401);
  });

  it("the dev form login ignores any role request; the D1 role decides", async () => {
    expect((await devStart("astro@test.local")).role).toBe("astronaut");
    expect((await devStart("doc@test.local", "flight_surgeon")).role).toBe("astronaut");
    expect((await devStart("ortiz@demo.evade.local")).role).toBe("flight_surgeon");
    env = { ...env, FLIGHT_SURGEON_EMAILS: "surgeon@test.local" };
    expect((await devStart("surgeon@test.local")).role).toBe("flight_surgeon");
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

describe("mobile app sign-in handoff", () => {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challengeFor = async (v: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
  async function redeem(body: Record<string, string>, contentType = "application/x-www-form-urlencoded") {
    const url = new URL(API + "/auth/app-redeem");
    const res = await handleAuth(new Request(url, { method: "POST", body: new URLSearchParams(body), headers: { "Content-Type": contentType } }), env, url, seedTasks);
    return res!;
  }
  async function appLogin() {
    const res = await login(await sign({}), `/auth/access?redirect=https://evade.health/dashboard&app_challenge=${await challengeFor(verifier)}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const location = new URL(res.headers.get("Location")!);
    expect(`${location.protocol}//${location.host}`).toBe("evade://auth");
    return location.searchParams.get("code")!;
  }

  it("advertises the handoff when Access is configured", async () => {
    expect((await (await call("GET", "/auth/providers")).json() as { app_handoff: boolean }).app_handoff).toBe(true);
  });

  it("sends a one-time code to the app scheme and redeems it once for a session cookie", async () => {
    const code = await appLogin();
    const res = await redeem({ code, verifier });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("https://evade.health/dashboard");
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie.startsWith("__Host-evade_session=")).toBe(true);
    expect(cookie).toMatch(/HttpOnly/);
    const me = await call("GET", "/auth/me", { Cookie: `__Host-evade_session=${tokenFrom(res)}` });
    expect(me.status).toBe(200);
    expect((await me.json() as { email: string }).email).toBe("vega@evade.health");
    const again = await redeem({ code, verifier });
    expect(again.headers.get("Location")).toContain("/login?error=");
    expect(again.headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects a wrong verifier and burns the code", async () => {
    const code = await appLogin();
    const wrong = await redeem({ code, verifier: b64url(crypto.getRandomValues(new Uint8Array(32))) });
    expect(wrong.headers.get("Set-Cookie")).toBeNull();
    expect((await redeem({ code, verifier })).headers.get("Set-Cookie")).toBeNull();
  });

  it("rejects malformed challenges, the staff path and non-form bodies", async () => {
    expect((await login(await sign({}), "/auth/access?app_challenge=short")).status).toBe(400);
    expect((await login(await sign({}), `/auth/access/staff?app_challenge=${await challengeFor(verifier)}`)).status).toBe(400);
    expect((await redeem({ code: "x", verifier }, "application/json")).status).toBe(415);
  });

  it("leaves the normal web sign-in unchanged", async () => {
    const res = await login(await sign({}));
    expect(res.headers.get("Location")).toBe("https://evade.health/dashboard");
    expect(res.headers.get("Set-Cookie")).toMatch(/^__Host-evade_session=/);
  });
});
