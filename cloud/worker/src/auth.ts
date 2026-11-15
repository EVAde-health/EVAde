// EVAde login: OAuth 2.0 / OpenID Connect authorization code + PKCE, run entirely on Cloudflare.
//   Auth0      - default provider (Universal Login: email/password, passwordless email, Google, GitHub, MFA).
//                Roles come from the ID token claim https://evade.health/roles, set by an Auth0 Post-Login Action.
//   Google / GitHub direct - fallback providers if Auth0 isn't configured
//   Turnstile  - bot check on the login page before any OAuth redirect
//   Workers KV - short-lived OAuth state (10 min) and sessions (7 days), read at the edge on every request
//   D1         - auth_identities links each login to an astronaut (users.user_id)
// Session token lives only in an HttpOnly cookie; KV stores its SHA-256 hash, never the token itself.

import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AuthEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  AUTH_RATE_LIMITER: RateLimit;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  AUTH0_DOMAIN?: string; // e.g. evade.us.auth0.com (no scheme)
  AUTH0_CLIENT_ID?: string;
  AUTH0_CLIENT_SECRET?: string;
  DEV_LOGIN?: string; // "true" enables the no-OAuth test provider. Never on in production.
}

export interface Principal {
  kind: "user" | "service";
  user_id?: string;
  role?: string;
  email?: string | null;
}

export const STAFF_ROLES = new Set(["flight_surgeon", "therapist", "admin"]);
export const ROLES_CLAIM = "https://evade.health/roles";
const SESSION_TTL = 7 * 24 * 3600;
const OAUTH_TTL = 600;
const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** Highest-privilege EVAde role in an Auth0 roles claim; anything unknown or missing is an astronaut. */
export function roleFromClaim(claim: unknown): string {
  const roles = Array.isArray(claim) ? claim : [];
  for (const r of ["admin", "flight_surgeon", "therapist"]) if (roles.includes(r)) return r;
  return "astronaut";
}

function auth0Host(env: AuthEnv) {
  const host = env.AUTH0_DOMAIN?.trim().toLowerCase() ?? "";
  return host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host) ? host : null;
}

const PROVIDERS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
  },
  github: {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
  },
} as const;
type Provider = keyof typeof PROVIDERS | "auth0" | "dev";

function endpoints(env: AuthEnv, p: "google" | "github" | "auth0") {
  if (p !== "auth0") return PROVIDERS[p];
  const h = auth0Host(env);
  return {
    authorize: `https://${h}/authorize`,
    token: `https://${h}/oauth/token`,
    scope: "openid profile email",
  };
}

// ---------- small crypto helpers ----------
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

function clientFor(env: AuthEnv, p: Provider) {
  if (p === "google") return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
  if (p === "github") return { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
  if (p === "auth0") return { id: env.AUTH0_CLIENT_ID, secret: env.AUTH0_CLIENT_SECRET };
  return { id: "dev", secret: "dev" };
}
const hasTurnstile = (env: AuthEnv) => Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET);
const isLoopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
/** Enabled login methods, default first: Auth0, then the direct fallbacks. */
export const enabledProviders = (env: AuthEnv, url: URL): Provider[] => {
  const out: Provider[] = [];
  if (hasTurnstile(env) && auth0Host(env) && env.AUTH0_CLIENT_ID && env.AUTH0_CLIENT_SECRET) out.push("auth0");
  if (hasTurnstile(env) && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  if (hasTurnstile(env) && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.DEV_LOGIN === "true" && isLoopback(url)) out.push("dev");
  return out;
};

const allowedOrigins = (env: AuthEnv) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function trustedOrigin(env: AuthEnv, url: URL, origin: string | null): origin is string {
  return !!origin && (origin === url.origin || allowedOrigins(env).includes(origin));
}

/** Only redirect back to our own frontends (stops open-redirect abuse). */
function safeRedirect(env: AuthEnv, target: string | null, reqUrl: URL): string {
  const fallback = env.FRONTEND_URL || reqUrl.origin + "/auth/me";
  if (!target) return fallback;
  try {
    const t = new URL(target, fallback);
    if ((t.protocol === "https:" || (isLoopback(reqUrl) && isLoopback(t))) &&
        !t.username && !t.password && trustedOrigin(env, reqUrl, t.origin)) return t.toString();
  } catch {}
  return fallback;
}

const cookieName = (url: URL, name: string) => url.protocol === "https:" ? `__Host-evade_${name}` : `evade_${name}`;

function cookieHeader(reqUrl: URL, name: string, value: string, maxAge: number) {
  const parts = [`${cookieName(reqUrl, name)}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (reqUrl.protocol === "https:") parts.push("Secure");
  return parts.join("; ");
}

function readCookie(req: Request, name: string) {
  const c = req.headers.get("Cookie") ?? "";
  for (const part of c.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return null;
}

export const sessionCookie = (req: Request, url = new URL(req.url)) => readCookie(req, cookieName(url, "session"));

// ---------- sessions ----------
export async function getSessionPrincipal(req: Request, env: AuthEnv): Promise<Principal | null> {
  let token = sessionCookie(req);
  const authz = req.headers.get("Authorization");
  if (!token && authz?.startsWith("Bearer ")) token = authz.slice(7);
  if (!token) return null;
  const s = await env.SESSIONS.get<{ user_id: string; role: string; email: string | null; provider?: Provider }>(`sess:${await sha256(token)}`, "json");
  if (!s) return null;
  let role = "astronaut";
  if (s.provider === "auth0" && STAFF_ROLES.has(s.role)) {
    const user = await env.DB.prepare("SELECT role FROM users WHERE user_id=?").bind(s.user_id).first<{ role: string }>();
    if (!user) return null;
    if (user.role === s.role) role = s.role;
  }
  return { kind: "user", user_id: s.user_id, role, email: s.email };
}

async function createSession(env: AuthEnv, user: { user_id: string; role: string }, email: string | null, provider: string) {
  const token = randomToken();
  await env.SESSIONS.put(`sess:${await sha256(token)}`, JSON.stringify({ user_id: user.user_id, role: user.role, email, provider, created: Date.now() }), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

// ---------- identity -> astronaut ----------
export interface IdentityIn {
  provider: string;
  subject: string;
  email?: string | null;
  display_name?: string | null;
  role?: string;
  environment?: string;
  mission_name?: string | null;
  user_id?: string;
}

/** Find or create the astronaut behind a login. `seedTasks` gives new astronauts today's routine.
 *  New users are astronauts unless `role` says otherwise; roles are granted in Auth0, never from an email list. */
export async function linkIdentity(env: AuthEnv, id: IdentityIn, seedTasks: (userId: string) => Promise<void>, auth0Role?: string) {
  const now = new Date().toISOString();
  const userId = id.user_id ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (!id.user_id) {
    statements.push(env.DB.prepare(
      `INSERT INTO users (user_id,display_name,role,environment,mission_name,mission_start)
       SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM auth_identities WHERE provider=? AND subject=?)`
    ).bind(userId, id.display_name || id.email || "Crew member", id.role ?? "astronaut", id.environment ?? "station",
      id.mission_name ?? null, now, id.provider, id.subject));
  }
  statements.push(env.DB.prepare(
    `INSERT INTO auth_identities (provider,subject,user_id,email,last_login)
     VALUES (?,?,COALESCE((SELECT user_id FROM auth_identities WHERE provider=? AND subject=?),?),?,?)
     ON CONFLICT(provider,subject) DO UPDATE SET last_login=excluded.last_login,
       email=CASE WHEN ? THEN excluded.email ELSE COALESCE(excluded.email,email) END`
  ).bind(id.provider, id.subject, id.provider, id.subject, userId, id.email ?? null, now, auth0Role !== undefined ? 1 : 0));
  statements.push(env.DB.prepare(
    `UPDATE users SET last_active=?, role=COALESCE(?,role)
     WHERE user_id=(SELECT user_id FROM auth_identities WHERE provider=? AND subject=?) RETURNING *`
  ).bind(now, auth0Role ?? null, id.provider, id.subject));

  // D1 batches are atomic, including when two first-time logins race.
  const batch = await env.DB.batch<{ user_id: string; role: string }>(statements);
  const user = batch.at(-1)?.results[0];
  if (!user) throw new Error("Identity provisioning failed");
  if (!id.user_id && batch[0].meta.changes && user.role === "astronaut") await seedTasks(user.user_id);
  return user;
}

// ---------- provider calls ----------
interface Profile {
  subject: string;
  email: string | null;
  name: string | null;
  role?: string; // only set when the provider is the source of truth for roles (Auth0)
}

async function exchangeAndProfile(
  env: AuthEnv, p: Provider, code: string, verifier: string, redirectUri: string, nonce?: string, devEmail?: string,
): Promise<Profile> {
  if (p === "dev") {
    const email = devEmail || "dev.astronaut@evade.health";
    return { subject: `dev:${email}`, email, name: email.split("@")[0] };
  }
  const { id, secret } = clientFor(env, p);
  const tokenRes = await fetch(endpoints(env, p).token, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: id!, client_secret: secret!, code_verifier: verifier,
    }),
  });
  const tok = await tokenRes.json<any>();
  if (!tokenRes.ok || !tok.access_token) throw new Error("OAuth token exchange failed");
  const auth = { Authorization: `Bearer ${tok.access_token}`, "User-Agent": "EVAde", Accept: "application/json" };

  if (p === "auth0") {
    if (typeof tok.id_token !== "string" || !nonce) throw new Error("Auth0 ID token or nonce missing");
    const issuer = `https://${auth0Host(env)}/`;
    const keys = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
    const { payload: claims } = await jwtVerify(tok.id_token, keys, {
      algorithms: ["RS256"], issuer, audience: id!, requiredClaims: ["exp", "iat", "nonce", "sub"],
    });
    if (claims.nonce !== nonce || ((claims.azp !== undefined || (Array.isArray(claims.aud) && claims.aud.length > 1)) && claims.azp !== id))
      throw new Error("Auth0 token is not bound to this login");
    const ui = await fetch(new URL("userinfo", issuer), { headers: auth, redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (!ui.ok) throw new Error("Auth0 profile request failed");
    const u = await ui.json<{ sub?: string; email?: string; email_verified?: boolean; name?: string; nickname?: string }>();
    if (!claims.sub || u.sub !== claims.sub) throw new Error("Auth0 profile missing or mismatched sub");
    const email = u.email_verified === true && typeof u.email === "string" ? u.email : null;
    const name = [u.name, u.nickname, claims.name, claims.nickname]
      .find(value => typeof value === "string" && value.trim() && !value.includes("@")) as string | undefined;
    return {
      subject: claims.sub,
      email,
      name: name ?? email,
      role: roleFromClaim(claims[ROLES_CLAIM]),
    };
  }

  if (p === "google") {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: auth, redirect: "manual" });
    if (!response.ok) throw new Error("Google profile request failed");
    const u = await response.json<any>();
    if (!u.sub) throw new Error("Google profile missing sub");
    return { subject: String(u.sub), email: u.email_verified === true ? u.email : null, name: u.name ?? u.email };
  }
  const response = await fetch("https://api.github.com/user", { headers: auth, redirect: "manual" });
  if (!response.ok) throw new Error("GitHub profile request failed");
  const u = await response.json<any>();
  if (!u.id) throw new Error("GitHub profile missing id");
  let email: string | null = null;
  try {
    const response = await fetch("https://api.github.com/user/emails", { headers: auth, redirect: "manual" });
    if (response.ok) {
      const emails = await response.json<any[]>();
      email = emails.find((e) => e.primary && e.verified)?.email ?? null;
    }
  } catch {}
  return { subject: String(u.id), email, name: u.name || u.login };
}

async function verifyTurnstile(env: AuthEnv, token: string | null, ip: string | null, hostname: string) {
  if (!env.TURNSTILE_SECRET || typeof token !== "string" || !token || token.length > 2048) return false;
  const r = await fetch(TURNSTILE_ORIGIN + "/turnstile/v0/siteverify", {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  if (!r.ok) return false;
  const result = await r.json<{ success: boolean; hostname?: string; action?: string }>();
  return result.success === true && result.hostname === hostname && result.action === "login";
}

// ---------- pages ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function loginPage(env: AuthEnv, url: URL, redirect: string, error?: string, status = 200) {
  const providers = enabledProviders(env, url);
  const nonce = randomToken();
  const label: Record<string, string> = { auth0: "Sign in", google: "Continue with Google", github: "Continue with GitHub", dev: "Test login (dev only)" };
  const buttons = providers.length
    ? providers.map((p) => `<button name="provider" value="${p}" class="btn ${p}">${label[p]}</button>`).join("") +
      (providers.includes("auth0")
        ? `<button name="provider" value="auth0" formaction="/auth/start?screen_hint=signup" class="btn auth0-signup">Create account</button>`
        : "")
    : `<p class="err">No login provider is configured yet.</p>`;
  const devField = providers.includes("dev") ? `<input name="dev_email" placeholder="test email (dev login)" />` : "";
  const ts = providers.some((p) => p !== "dev") && env.TURNSTILE_SITE_KEY
    ? `<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-action="login" data-theme="dark"></div>
       <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EVAde · Sign in</title>
<style nonce="${nonce}">
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
  background:radial-gradient(circle at 30% 20%,#1b2a4a,#05070d 60%);font:16px/1.5 system-ui,sans-serif;color:#e8ecf5}
  main{width:min(380px,92vw);padding:32px;border:1px solid #26324d;border-radius:16px;background:#0b1120cc}
  h1{margin:0 0 4px;font-size:28px;letter-spacing:.5px}p{margin:0 0 20px;color:#9aa6c0}
  .btn{display:block;width:100%;margin:10px 0;padding:12px;border-radius:10px;border:1px solid #33415f;background:#141c30;color:#e8ecf5;font-size:15px;cursor:pointer}
  .btn:hover{border-color:#5b8cff}.google{background:#fff;color:#1f1f1f}.github{background:#24292f}
  input{width:100%;padding:10px;margin:8px 0;border-radius:8px;border:1px solid #33415f;background:#0b1120;color:#e8ecf5}
  .err{color:#ff8a8a}.cf-turnstile{margin:12px 0}small{display:block;margin-top:18px;color:#6f7b96}
</style></head><body><main>
<h1>EVAde</h1><p>Astronaut health monitoring</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/auth/start">
  <input type="hidden" name="redirect" value="${esc(redirect)}">${devField}${ts}${buttons}
</form>
<small>Protected by Cloudflare Turnstile · runs on Cloudflare Workers</small>
</main></body></html>`;
  return new Response(html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; script-src ${TURNSTILE_ORIGIN}; frame-src ${TURNSTILE_ORIGIN}; connect-src ${TURNSTILE_ORIGIN}; style-src 'nonce-${nonce}'; form-action 'self' https://accounts.google.com https://github.com${providers.includes("auth0") ? ` https://${auth0Host(env)}` : ""}; base-uri 'none'; frame-ancestors 'none'`,
  } });
}

// ---------- route handler (returns null when the path isn't an auth route) ----------
export async function handleAuth(req: Request, env: AuthEnv, url: URL, seedTasks: (id: string) => Promise<void>): Promise<Response | null> {
  const path = url.pathname.replace(/\/$/, "");
  const ip = req.headers.get("CF-Connecting-IP");
  if (path === "/auth/start" || path.startsWith("/auth/callback/")) {
    const bucket = path === "/auth/start" ? "start" : "callback";
    const { success } = await env.AUTH_RATE_LIMITER.limit({ key: `${bucket}:${ip ?? "unknown"}` });
    if (!success) return Response.json({ error: "Too many sign-in requests. Try again in a minute." }, {
      status: 429, headers: { "Retry-After": "60" },
    });
  }

  if (path === "/login" && req.method === "GET") {
    return loginPage(env, url, safeRedirect(env, url.searchParams.get("redirect"), url), url.searchParams.get("error") ?? undefined);
  }

  if (path === "/auth/providers" && req.method === "GET") {
    const providers = enabledProviders(env, url);
    return Response.json({ providers, default_provider: providers[0] ?? null, turnstile_site_key: hasTurnstile(env) ? env.TURNSTILE_SITE_KEY : null });
  }

  if (path === "/auth/start" && req.method === "POST") {
    const origin = req.headers.get("Origin");
    if (!trustedOrigin(env, url, origin)) return Response.json({ error: "Cross-origin sign-in blocked" }, { status: 403 });
    const contentType = req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
    if (contentType !== "application/x-www-form-urlencoded") return Response.json({ error: "Expected a sign-in form" }, { status: 415 });
    const encoded = await req.text();
    if (encoded.length > 8192) return Response.json({ error: "Sign-in form is too large" }, { status: 413 });
    const form = new URLSearchParams(encoded);
    const providers = enabledProviders(env, url);
    const provider = (form.get("provider") ?? providers[0]) as Provider | undefined;
    const screenHint = (form.get("screen_hint") ?? url.searchParams.get("screen_hint")) === "signup" ? "signup" : null;
    const redirect = safeRedirect(env, String(form.get("redirect") ?? ""), url);
    const back = (msg: string) => Response.redirect(`${url.origin}/login?error=${encodeURIComponent(msg)}&redirect=${encodeURIComponent(redirect)}`, 303);
    if (!provider || !providers.includes(provider)) return back("That sign-in method isn't available.");
    if (provider !== "dev" && !(await verifyTurnstile(env, form.get("cf-turnstile-response"), ip, new URL(origin).hostname).catch(() => false)))
      return back("Human check failed, please try again.");

    const state = randomToken(24);
    const browser = randomToken();
    const verifier = randomToken(48);
    const nonce = provider === "auth0" ? randomToken() : undefined;
    await env.SESSIONS.put(`oauth:${state}`, JSON.stringify({ provider, verifier, redirect, browser: await sha256(browser), nonce, dev_email: form.get("dev_email") }), {
      expirationTtl: OAUTH_TTL,
    });
    const redirectUri = `${url.origin}/auth/callback/${provider}`;
    const next = (location: string) => new Response(null, { status: 303, headers: {
      Location: location, "Set-Cookie": cookieHeader(url, "oauth", browser, OAUTH_TTL),
    } });
    if (provider === "dev") return next(`${redirectUri}?code=dev&state=${state}`);
    const challenge = await sha256(verifier);
    const ep = endpoints(env, provider);
    const q = new URLSearchParams({
      client_id: clientFor(env, provider).id!, redirect_uri: redirectUri, response_type: "code",
      scope: ep.scope, state, code_challenge: challenge, code_challenge_method: "S256",
    });
    if (provider === "google") q.set("prompt", "select_account");
    if (provider === "auth0") {
      q.set("nonce", nonce!);
      if (screenHint) {
        q.set("screen_hint", screenHint);
        q.set("prompt", "login");
      }
    }
    return next(`${ep.authorize}?${q}`);
  }

  const cb = path.match(/^\/auth\/callback\/(auth0|google|github|dev)$/);
  if (cb && req.method === "GET") {
    const provider = cb[1] as Provider;
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const fail = (msg: string) => Response.redirect(`${url.origin}/login?error=${encodeURIComponent(msg)}`, 303);
    if (url.searchParams.get("error")) return fail("Sign-in was cancelled.");
    const browser = readCookie(req, cookieName(url, "oauth"));
    if (!state || !/^[\w-]{32}$/.test(state) || !code || !browser) return fail("Sign-in expired, please try again.");
    const saved = await env.SESSIONS.get<{ provider: Provider; verifier: string; redirect: string; browser: string; nonce?: string; dev_email: string | null }>(`oauth:${state}`, "json");
    if (!saved || saved.provider !== provider || saved.browser !== await sha256(browser)) return fail("Sign-in expired, please try again.");
    await env.SESSIONS.delete(`oauth:${state}`); // one-time use
    if (!enabledProviders(env, url).includes(provider)) return fail("That sign-in method isn't available.");

    try {
      const profile = await exchangeAndProfile(env, provider, code, saved.verifier, `${url.origin}/auth/callback/${provider}`, saved.nonce, saved.dev_email ?? undefined);
      const user = await linkIdentity(
        env,
        { provider, subject: profile.subject, email: profile.email, display_name: profile.name, role: profile.role },
        seedTasks, profile.role
      );
      const token = await createSession(env, { user_id: user.user_id, role: profile.role ?? "astronaut" }, profile.email, provider);
      await env.DB.prepare("INSERT INTO action_log (user_id, action, detail) VALUES (?, 'login', ?)").bind(user.user_id, provider).run();
      const headers = new Headers({ Location: safeRedirect(env, saved.redirect, url) });
      headers.append("Set-Cookie", cookieHeader(url, "session", token, SESSION_TTL));
      headers.append("Set-Cookie", cookieHeader(url, "oauth", "", 0));
      return new Response(null, { status: 302, headers });
    } catch {
      console.warn("OAuth callback failed", provider);
      return fail("Sign-in failed, please try again.");
    }
  }

  if (path === "/auth/me" && req.method === "GET") {
    const p = await getSessionPrincipal(req, env);
    if (!p) return Response.json({ error: "Not signed in", login: `${url.origin}/login` }, { status: 401 });
    const user = await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(p.user_id).first<Record<string, unknown>>();
    if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });
    return Response.json({ user: { ...user, role: p.role }, role: p.role, email: p.email });
  }

  if (path === "/auth/logout") {
    if (req.method !== "POST") return Response.json({ error: "Use POST to sign out" }, { status: 405, headers: { Allow: "POST" } });
    if (!trustedOrigin(env, url, req.headers.get("Origin"))) return Response.json({ error: "Cross-origin sign-out blocked" }, { status: 403 });
    const token = sessionCookie(req, url);
    let provider: string | null = null;
    if (token) {
      const key = `sess:${await sha256(token)}`;
      provider = (await env.SESSIONS.get<{ provider?: string }>(key, "json"))?.provider ?? null;
      await env.SESSIONS.delete(key);
    }
    const clear = { "Set-Cookie": cookieHeader(url, "session", "", 0) };
    const host = auth0Host(env);
    if (provider === "auth0" && host && env.AUTH0_CLIENT_ID) {
      const params = new URLSearchParams({ client_id: env.AUTH0_CLIENT_ID, returnTo: "https://evade.health" });
      const logoutUrl = `https://${host}/v2/logout?${params}`;
      if ((req.headers.get("Accept") ?? "").includes("application/json")) {
        return Response.json({ logout_url: logoutUrl }, { headers: clear });
      }
      return new Response(null, { status: 303, headers: { ...clear, Location: logoutUrl } });
    }
    return new Response(null, { status: 204, headers: clear });
  }

  return null;
}
