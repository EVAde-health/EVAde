// EVAde login: OAuth 2.0 authorization code + PKCE for Google and GitHub, run entirely on Cloudflare.
//   Turnstile  - bot check on the login page before any OAuth redirect
//   Workers KV - short-lived OAuth state (10 min) and sessions (7 days), read at the edge on every request
//   D1         - auth_identities links each login to an astronaut (users.user_id)
// Session token lives only in an HttpOnly cookie; KV stores its SHA-256 hash, never the token itself.

export interface AuthEnv {
  DB: D1Database;
  SESSIONS: KVNamespace;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  FRONTEND_URL?: string;
  COOKIE_DOMAIN?: string;
  STAFF_EMAILS?: string; // comma-separated: these logins become flight_surgeon
  DEV_LOGIN?: string; // "true" enables the no-OAuth test provider. Never on in production.
}

export interface Principal {
  kind: "user" | "service";
  user_id?: string;
  role?: string;
  email?: string | null;
}

export const STAFF_ROLES = new Set(["flight_surgeon", "therapist", "admin"]);
const SESSION_TTL = 7 * 24 * 3600;
const COOKIE = "evade_session";

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
type Provider = keyof typeof PROVIDERS | "dev";

// ---------- small crypto helpers ----------
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
const sha256 = async (s: string) => b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

function clientFor(env: AuthEnv, p: Provider) {
  if (p === "google") return { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET };
  if (p === "github") return { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
  return { id: "dev", secret: "dev" };
}
const enabledProviders = (env: AuthEnv): Provider[] => {
  const out: Provider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) out.push("google");
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.DEV_LOGIN === "true") out.push("dev");
  return out;
};

const allowedOrigins = (env: AuthEnv) => (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Only redirect back to our own frontends (stops open-redirect abuse). */
function safeRedirect(env: AuthEnv, target: string | null, reqUrl: URL): string {
  const fallback = env.FRONTEND_URL || reqUrl.origin + "/auth/me";
  if (!target) return fallback;
  try {
    const t = new URL(target, fallback);
    if (allowedOrigins(env).includes(t.origin) || t.origin === reqUrl.origin) return t.toString();
  } catch {}
  return fallback;
}

function cookieHeader(env: AuthEnv, reqUrl: URL, value: string, maxAge: number) {
  const parts = [`${COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (reqUrl.protocol === "https:") parts.push("Secure");
  // Share the cookie between evade.health and api.evade.health
  if (env.COOKIE_DOMAIN && reqUrl.hostname.endsWith(env.COOKIE_DOMAIN.replace(/^\./, ""))) parts.push(`Domain=${env.COOKIE_DOMAIN}`);
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

// ---------- sessions ----------
export async function getSessionPrincipal(req: Request, env: AuthEnv): Promise<Principal | null> {
  let token = readCookie(req, COOKIE);
  const authz = req.headers.get("Authorization");
  if (!token && authz?.startsWith("Bearer ")) token = authz.slice(7);
  if (!token) return null;
  const s = await env.SESSIONS.get<{ user_id: string; role: string; email: string | null }>(`sess:${await sha256(token)}`, "json");
  return s ? { kind: "user", ...s } : null;
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

/** Find or create the astronaut behind a login. `seedTasks` gives new astronauts today's routine. */
export async function linkIdentity(env: AuthEnv, id: IdentityIn, seedTasks: (userId: string) => Promise<void>) {
  const now = new Date().toISOString();
  let userId = id.user_id;
  if (!userId) {
    const existing = await env.DB.prepare("SELECT user_id FROM auth_identities WHERE provider=? AND subject=?")
      .bind(id.provider, id.subject).first<{ user_id: string }>();
    userId = existing?.user_id;
  }
  if (!userId) {
    const staff = (env.STAFF_EMAILS ?? "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const role = id.role ?? (id.email && staff.includes(id.email.toLowerCase()) ? "flight_surgeon" : "astronaut");
    userId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO users (user_id,display_name,role,environment,mission_name,mission_start) VALUES (?,?,?,?,?,?)")
      .bind(userId, id.display_name || id.email || "Crew member", role, id.environment ?? "station", id.mission_name ?? null, now).run();
    if (role === "astronaut") await seedTasks(userId);
  }
  await env.DB.prepare(
    `INSERT INTO auth_identities (provider,subject,user_id,email,last_login) VALUES (?,?,?,?,?)
     ON CONFLICT(provider,subject) DO UPDATE SET last_login=excluded.last_login, email=COALESCE(excluded.email,email)`
  ).bind(id.provider, id.subject, userId, id.email ?? null, now).run();
  await env.DB.prepare("UPDATE users SET last_active=? WHERE user_id=?").bind(now, userId).run();
  return (await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(userId).first<any>())!;
}

// ---------- provider calls ----------
async function exchangeAndProfile(env: AuthEnv, p: Provider, code: string, verifier: string, redirectUri: string, devEmail?: string) {
  if (p === "dev") {
    const email = devEmail || "dev.astronaut@evade.health";
    return { subject: `dev:${email}`, email, name: email.split("@")[0] };
  }
  const { id, secret } = clientFor(env, p);
  const tokenRes = await fetch(PROVIDERS[p].token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: id!, client_secret: secret!, code_verifier: verifier,
    }),
  });
  const tok = await tokenRes.json<any>();
  if (!tokenRes.ok || !tok.access_token) throw new Error(`token exchange failed: ${tok.error_description ?? tok.error ?? tokenRes.status}`);
  const auth = { Authorization: `Bearer ${tok.access_token}`, "User-Agent": "EVAde", Accept: "application/json" };

  if (p === "google") {
    const u = await (await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: auth })).json<any>();
    if (!u.sub) throw new Error("Google profile missing sub");
    return { subject: String(u.sub), email: u.email_verified ? u.email : null, name: u.name ?? u.email };
  }
  const u = await (await fetch("https://api.github.com/user", { headers: auth })).json<any>();
  if (!u.id) throw new Error("GitHub profile missing id");
  let email: string | null = null;
  try {
    const emails = await (await fetch("https://api.github.com/user/emails", { headers: auth })).json<any[]>();
    email = emails.find((e) => e.primary && e.verified)?.email ?? null;
  } catch {}
  return { subject: String(u.id), email, name: u.name || u.login };
}

async function verifyTurnstile(env: AuthEnv, token: string | null, ip: string | null) {
  if (!env.TURNSTILE_SECRET) return true; // not configured (local dev)
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  return ((await r.json<any>()) as any).success === true;
}

// ---------- pages ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function loginPage(env: AuthEnv, redirect: string, error?: string) {
  const providers = enabledProviders(env);
  const label: Record<string, string> = { google: "Continue with Google", github: "Continue with GitHub", dev: "Test login (dev only)" };
  const buttons = providers.length
    ? providers.map((p) => `<button name="provider" value="${p}" class="btn ${p}">${label[p]}</button>`).join("")
    : `<p class="err">No login provider is configured yet.</p>`;
  const devField = providers.includes("dev") ? `<input name="dev_email" placeholder="test email (dev login)" />` : "";
  const ts = env.TURNSTILE_SITE_KEY
    ? `<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-theme="dark"></div>
       <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EVAde · Sign in</title>
<style>
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
}

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });

// ---------- route handler (returns null when the path isn't an auth route) ----------
export async function handleAuth(req: Request, env: AuthEnv, url: URL, seedTasks: (id: string) => Promise<void>): Promise<Response | null> {
  const path = url.pathname;

  if (path === "/login" && req.method === "GET") {
    return html(loginPage(env, safeRedirect(env, url.searchParams.get("redirect"), url), url.searchParams.get("error") ?? undefined));
  }

  if (path === "/auth/providers" && req.method === "GET") {
    return Response.json({ providers: enabledProviders(env), turnstile_site_key: env.TURNSTILE_SITE_KEY ?? null });
  }

  if (path === "/auth/start" && req.method === "POST") {
    const form = await req.formData();
    const provider = String(form.get("provider") ?? "") as Provider;
    const redirect = safeRedirect(env, String(form.get("redirect") ?? ""), url);
    const back = (msg: string) => Response.redirect(`${url.origin}/login?error=${encodeURIComponent(msg)}&redirect=${encodeURIComponent(redirect)}`, 303);
    if (!enabledProviders(env).includes(provider)) return back("That sign-in method isn't available.");
    if (!(await verifyTurnstile(env, form.get("cf-turnstile-response") as string | null, req.headers.get("CF-Connecting-IP"))))
      return back("Human check failed, please try again.");

    const state = randomToken(24);
    const verifier = randomToken(48);
    await env.SESSIONS.put(`oauth:${state}`, JSON.stringify({ provider, verifier, redirect, dev_email: form.get("dev_email") || null }), {
      expirationTtl: 600,
    });
    const redirectUri = `${url.origin}/auth/callback/${provider}`;
    if (provider === "dev") return Response.redirect(`${redirectUri}?code=dev&state=${state}`, 302);
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({
      client_id: clientFor(env, provider).id!, redirect_uri: redirectUri, response_type: "code",
      scope: PROVIDERS[provider].scope, state, code_challenge: challenge, code_challenge_method: "S256",
    });
    if (provider === "google") q.set("prompt", "select_account");
    return Response.redirect(`${PROVIDERS[provider].authorize}?${q}`, 302);
  }

  const cb = path.match(/^\/auth\/callback\/(google|github|dev)$/);
  if (cb && req.method === "GET") {
    const provider = cb[1] as Provider;
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const fail = (msg: string) => html(loginPage(env, env.FRONTEND_URL ?? url.origin, msg), 400);
    if (url.searchParams.get("error")) return fail("Sign-in was cancelled.");
    if (!state || !code) return fail("Missing sign-in parameters.");
    const saved = await env.SESSIONS.get<{ provider: Provider; verifier: string; redirect: string; dev_email: string | null }>(`oauth:${state}`, "json");
    if (!saved || saved.provider !== provider) return fail("Sign-in expired, please try again.");
    await env.SESSIONS.delete(`oauth:${state}`); // one-time use
    if (provider === "dev" && env.DEV_LOGIN !== "true") return fail("Dev login is disabled.");

    try {
      const profile = await exchangeAndProfile(env, provider, code, saved.verifier, `${url.origin}/auth/callback/${provider}`, saved.dev_email ?? undefined);
      const user = await linkIdentity(env, { provider, subject: profile.subject, email: profile.email, display_name: profile.name }, seedTasks);
      const token = await createSession(env, user, profile.email, provider);
      await env.DB.prepare("INSERT INTO action_log (user_id, action, detail) VALUES (?, 'login', ?)").bind(user.user_id, provider).run();
      return new Response(null, { status: 302, headers: { Location: saved.redirect, "Set-Cookie": cookieHeader(env, url, token, SESSION_TTL) } });
    } catch (e: any) {
      console.error("oauth callback", e);
      return fail("Sign-in failed, please try again.");
    }
  }

  if (path === "/auth/me" && req.method === "GET") {
    const p = await getSessionPrincipal(req, env);
    if (!p) return Response.json({ error: "Not signed in", login: `${url.origin}/login` }, { status: 401 });
    const user = await env.DB.prepare("SELECT * FROM users WHERE user_id=?").bind(p.user_id).first();
    return Response.json({ user, role: p.role, email: p.email });
  }

  if (path === "/auth/logout" && (req.method === "POST" || req.method === "GET")) {
    const token = readCookie(req, COOKIE);
    if (token) await env.SESSIONS.delete(`sess:${await sha256(token)}`);
    const to = safeRedirect(env, url.searchParams.get("redirect"), url);
    return new Response(null, { status: req.method === "GET" ? 302 : 204, headers: { "Set-Cookie": cookieHeader(env, url, "", 0), ...(req.method === "GET" ? { Location: to } : {}) } });
  }

  return null;
}
