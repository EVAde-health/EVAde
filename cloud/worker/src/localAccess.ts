// Local stand-in for the Cloudflare Access login page, used only by `wrangler dev` on a loopback (or private LAN) host with
// DEV_LOGIN=true. In production /auth/access sits behind real Cloudflare Access, which shows its own
// "Sign in with a passkey" or "Email: send login code" page. Locally nothing sits in front of the Worker, so
// /auth/access sends the browser here instead and the same two choices work end to end against local D1/KV:
//   * Email: a 6-digit code (shown on the page and in the wrangler console, since no email is sent).
//   * Passkey: real WebAuthn (navigator.credentials) with signatures verified by WebCrypto; keys live in local KV.
// Accounts are "dev" identities keyed by email, so the seeded test accounts (vega@ / ortiz@demo.evade.local)
// sign in with the role stored in D1. Nothing here is reachable on a public host or without DEV_LOGIN.

export interface LocalAccessDeps {
  env: { SESSIONS: KVNamespace };
  url: URL;
  redirectFrom: (target: string | null) => string;
  cookie: (name: string, value: string, maxAge: number) => string;
  readCookie: (name: string) => string | null;
  /** Signs in (or creates) the dev identity for this email and returns the session Set-Cookie header. */
  finish: (email: string, method: "email_code" | "passkey") => Promise<string>;
}

const STATE_TTL = 600;
const COOKIE = "lac";
const enc = new TextEncoder();

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64url(s: unknown): Uint8Array {
  if (typeof s !== "string" || !/^[\w-]*$/.test(s) || s.length > 4096) throw new LocalAccessError("Malformed passkey response");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const sha256 = async (data: Uint8Array | string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
const hex = async (s: string) => [...await sha256(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

class LocalAccessError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

interface State {
  redirect: string;
  email?: string;
  code_hash?: string;
  attempts?: number;
  challenge?: string;
  challenge_kind?: "register" | "login";
}
interface StoredPasskey { email: string; spki: string; alg: number; counter: number; created_at: string }

const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[a-z0-9-]{2,24}$/i;
function normalEmail(v: unknown) {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) throw new LocalAccessError("Enter a valid email address.", 422);
  return email;
}

export async function handleLocalAccess(req: Request, path: string, deps: LocalAccessDeps): Promise<Response | null> {
  const { env, url } = deps;
  if (path === "/auth/local-access" && req.method === "GET") return page(deps);
  if (!path.startsWith("/auth/local-access/")) return null;
  if (req.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  // Same-origin JSON only: the page is served by this Worker.
  if (req.headers.get("Origin") !== url.origin) return Response.json({ error: "Cross-origin request blocked" }, { status: 403 });
  if (req.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json") return Response.json({ error: "Expected JSON" }, { status: 415 });
  const browser = deps.readCookie(COOKIE);
  const key = browser ? `lac:${await hex(browser)}` : null;
  const state = key ? await env.SESSIONS.get<State>(key, "json") : null;
  if (!key || !state) return Response.json({ error: "This sign-in page expired. Reload and try again." }, { status: 401 });
  const save = (s: State) => env.SESSIONS.put(key, JSON.stringify(s), { expirationTtl: STATE_TTL });
  const done = async (email: string, method: "email_code" | "passkey") => {
    await env.SESSIONS.delete(key);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", await deps.finish(email, method));
    headers.append("Set-Cookie", deps.cookie(COOKIE, "", 0));
    return Response.json({ redirect: state.redirect }, { headers });
  };

  try {
    const text = await req.text();
    if (text.length > 16384) throw new LocalAccessError("Request too large", 413);
    let input: any;
    try { input = JSON.parse(text || "{}"); } catch { throw new LocalAccessError("Malformed JSON"); }

    if (path === "/auth/local-access/code") {
      const email = normalEmail(input.email);
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
      await save({ ...state, email, code_hash: await hex(`${email}:${code}`), attempts: 0 });
      console.log(`[local access] login code for ${email}: ${code}`);
      // Real Cloudflare Access emails this code. Locally there's no mail, so the page shows it.
      return Response.json({ sent: true, email, dev_code: code });
    }

    if (path === "/auth/local-access/verify") {
      if (!state.email || !state.code_hash) throw new LocalAccessError("Request a login code first.");
      const attempts = (state.attempts ?? 0) + 1;
      if (attempts > 5) {
        await save({ redirect: state.redirect });
        throw new LocalAccessError("Too many wrong codes. Request a new one.", 429);
      }
      const code = typeof input.code === "string" ? input.code.replace(/\s/g, "") : "";
      if (!/^\d{6}$/.test(code) || await hex(`${state.email}:${code}`) !== state.code_hash) {
        await save({ ...state, attempts });
        throw new LocalAccessError("That code isn't right. Check it and try again.", 401);
      }
      return done(state.email, "email_code");
    }

    if (path === "/auth/local-access/passkey/options") {
      const kind = input.mode === "register" ? "register" : "login";
      const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
      if (kind === "login") {
        await save({ ...state, challenge, challenge_kind: kind });
        return Response.json({ challenge, rpId: url.hostname, timeout: 60000, userVerification: "preferred" });
      }
      const email = normalEmail(input.email);
      await save({ ...state, email, challenge, challenge_kind: kind });
      return Response.json({
        challenge,
        rp: { id: url.hostname, name: "EVAde (local)" },
        user: { id: b64url((await sha256(`evade-local:${email}`)).slice(0, 16)), name: email, displayName: email },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        attestation: "none",
        timeout: 60000,
      });
    }

    if (path === "/auth/local-access/passkey/register") {
      if (state.challenge_kind !== "register" || !state.challenge || !state.email) throw new LocalAccessError("Start passkey setup again.");
      await save({ ...state, challenge: undefined, challenge_kind: undefined }); // challenges are single-use
      await checkClientData(input.clientDataJSON, "webauthn.create", state.challenge, url.origin);
      const authData = fromB64url(input.authenticatorData);
      const counter = await checkAuthData(authData, url.hostname);
      const alg = Number(input.publicKeyAlgorithm);
      if (alg !== -7 && alg !== -257) throw new LocalAccessError("Unsupported passkey type");
      const spki = fromB64url(input.publicKey);
      await importKey(spki, alg); // rejects anything that isn't a usable public key
      const credId = credentialId(input.id);
      if (await env.SESSIONS.get(`lacpk:${credId}`)) throw new LocalAccessError("That passkey is already registered.", 409);
      const stored: StoredPasskey = { email: state.email, spki: b64url(spki), alg, counter, created_at: new Date().toISOString() };
      await env.SESSIONS.put(`lacpk:${credId}`, JSON.stringify(stored));
      return done(state.email, "passkey");
    }

    if (path === "/auth/local-access/passkey/login") {
      if (state.challenge_kind !== "login" || !state.challenge) throw new LocalAccessError("Start passkey sign-in again.");
      await save({ ...state, challenge: undefined, challenge_kind: undefined });
      const credId = credentialId(input.id);
      const stored = await env.SESSIONS.get<StoredPasskey>(`lacpk:${credId}`, "json");
      if (!stored) throw new LocalAccessError("This passkey isn't registered here. Set one up first.", 401);
      const clientData = await checkClientData(input.clientDataJSON, "webauthn.get", state.challenge, url.origin);
      const authData = fromB64url(input.authenticatorData);
      const counter = await checkAuthData(authData, url.hostname);
      const signed = new Uint8Array(authData.length + 32);
      signed.set(authData);
      signed.set(await sha256(clientData), authData.length);
      const key = await importKey(fromB64url(stored.spki), stored.alg);
      let signature = fromB64url(input.signature);
      if (stored.alg === -7) signature = derToRaw(signature);
      const params = stored.alg === -7 ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
      if (!await crypto.subtle.verify(params, key, signature, signed)) throw new LocalAccessError("Passkey signature check failed.", 401);
      if (counter !== 0 || stored.counter !== 0) {
        if (counter <= stored.counter) throw new LocalAccessError("Passkey counter went backwards; it may be cloned.", 401);
      }
      await env.SESSIONS.put(`lacpk:${credId}`, JSON.stringify({ ...stored, counter }));
      return done(stored.email, "passkey");
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (e) {
    if (e instanceof LocalAccessError) return Response.json({ error: e.message }, { status: e.status });
    console.warn("local access sign-in failed", e);
    return Response.json({ error: "Sign-in failed. Try again." }, { status: 500 });
  }
}

function credentialId(v: unknown) {
  const id = fromB64url(v);
  if (id.length < 16 || id.length > 1023) throw new LocalAccessError("Malformed passkey id");
  return b64url(id);
}

async function checkClientData(v: unknown, type: string, challenge: string, origin: string) {
  const raw = fromB64url(v);
  let data: any;
  try { data = JSON.parse(new TextDecoder().decode(raw)); } catch { throw new LocalAccessError("Malformed passkey response"); }
  if (data?.type !== type || data.challenge !== challenge) throw new LocalAccessError("Passkey challenge didn't match. Try again.", 401);
  if (data.origin !== origin) throw new LocalAccessError("Passkey was made for a different site.", 401);
  return raw;
}

/** Checks the relying-party hash and user-presence flag; returns the signature counter. */
async function checkAuthData(authData: Uint8Array, rpId: string) {
  if (authData.length < 37) throw new LocalAccessError("Malformed passkey response");
  if (!equal(authData.slice(0, 32), await sha256(rpId))) throw new LocalAccessError("Passkey was made for a different site.", 401);
  if (!(authData[32] & 0x01)) throw new LocalAccessError("The passkey didn't confirm you were present.", 401);
  return new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
}

function importKey(spki: Uint8Array, alg: number) {
  const algorithm = alg === -7 ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  return crypto.subtle.importKey("spki", spki, algorithm, false, ["verify"]).catch(() => {
    throw new LocalAccessError("Unsupported passkey key");
  });
}

/** WebAuthn ES256 signatures are ASN.1 DER; WebCrypto wants raw r||s. */
export function derToRaw(der: Uint8Array) {
  const fail = () => { throw new LocalAccessError("Malformed passkey signature"); };
  if (der[0] !== 0x30) fail();
  let i = 2;
  const part = () => {
    if (der[i] !== 0x02) fail();
    const len = der[i + 1];
    let v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) fail();
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = part(), s = part();
  const raw = new Uint8Array(64);
  raw.set(r); raw.set(s, 32);
  return raw;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function page(deps: LocalAccessDeps) {
  const redirect = deps.redirectFrom(deps.url.searchParams.get("redirect"));
  const browser = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await deps.env.SESSIONS.put(`lac:${await hex(browser)}`, JSON.stringify({ redirect } satisfies State), { expirationTtl: STATE_TTL });
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hint = esc(deps.url.searchParams.get("email") ?? "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in ・ Cloudflare Access (local)</title>
<style nonce="${nonce}">
  :root{color-scheme:light;--line:oklch(14.5% 0 0 / .1);--brand:oklch(57.72% .2324 260);--subtle:oklch(55.6% 0 0)}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:32px 8px;background:#fbfbfb;color:#333;font:14px/20px -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;text-align:center}
  .content{width:100%;max-width:460px;display:flex;flex-direction:column;gap:20px}
  .org{font-size:13px;color:var(--subtle)}.box{background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 1px 2px #0000000d;text-align:left}
  .body{padding:32px;display:flex;flex-direction:column;gap:16px}.stack{display:flex;flex-direction:column;gap:16px}h1{margin:0;font-size:20px;line-height:28px;font-weight:600;color:#18181b}
  p{margin:0}.subtle{color:var(--subtle)}label{display:block;font-weight:500;margin-bottom:6px}
  input{width:100%;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:6px;font:inherit}
  input:focus{outline:2px solid var(--brand);outline-offset:1px}
  button{width:100%;height:36px;border-radius:6px;font:inherit;font-weight:500;cursor:pointer;border:1px solid var(--line);background:#fff;color:#18181b}
  button.primary{background:var(--brand);border-color:var(--brand);color:#fff}button:disabled{opacity:.6;cursor:default}
  .divider{display:flex;align-items:center;gap:12px;color:var(--subtle);font-size:12px}.divider::before,.divider::after{content:"";flex:1;height:1px;background:var(--line)}
  .err{color:oklch(50.5% .213 27.518)}.note{font-size:12px;color:var(--subtle)}.devcode{font:600 18px/24px ui-monospace,monospace;letter-spacing:4px;color:#18181b}
  .link{background:none;border:0;height:auto;color:oklch(42.4% .199 265.638);width:auto;padding:0}
  [hidden]{display:none!important}.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:oklch(97% 0 0);border:1px solid var(--line);font-size:12px}
</style></head><body><div class="content">
<div class="org">evade-health.cloudflareaccess.com <span class="badge">local stand-in</span></div>
<div class="box"><div class="body">
  <h1>Log in to EVAde</h1>
  <p id="error" class="err" role="alert" hidden></p>

  <section id="choose">
    <div class="stack">
      <p class="subtle">Sign in with a passkey or Email</p>
      <button type="button" id="pk-open">Sign in with a passkey</button>
      <div class="divider">or</div>
      <form id="email-form"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" value="${hint}" required></form>
      <button type="submit" form="email-form" class="primary" id="send">Send login code</button>
    </div>
  </section>

  <section id="code-step" hidden>
    <div class="stack">
      <p>We sent a login code to <strong id="code-email"></strong>.</p>
      <p class="note">Local stand-in: no email is sent. Your code is <span class="devcode" id="dev-code"></span> (also printed in the wrangler console).</p>
      <form id="code-form"><label for="code">Code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></form>
      <button type="submit" form="code-form" class="primary" id="verify">Sign in</button>
      <button type="button" class="back">Back to sign in</button>
    </div>
  </section>

  <section id="pk-step" hidden>
    <div class="stack">
      <p class="subtle">Use a passkey saved on this device or another device.</p>
      <button type="button" class="primary" id="pk-start">Sign in with a passkey</button>
      <button type="button" id="pk-setup-open">Don't have a passkey? Set one up</button>
      <button type="button" class="back">Back to sign in</button>
    </div>
  </section>

  <section id="pk-setup" hidden>
    <div class="stack">
      <p class="subtle">Create a passkey for your EVAde account. New emails get a new astronaut account.</p>
      <form id="setup-form"><label for="setup-email">Email</label><input id="setup-email" type="email" autocomplete="email" required></form>
      <button type="submit" form="setup-form" class="primary" id="pk-create">Create passkey</button>
      <button type="button" class="back">Back to sign in</button>
    </div>
  </section>
</div></div>
<p class="note">Local development only. In production this page is Cloudflare Access.</p>
</div>
<script nonce="${nonce}">
const $ = (id) => document.getElementById(id);
const sections = ["choose", "code-step", "pk-step", "pk-setup"];
const show = (id) => { sections.forEach((s) => { $(s).hidden = s !== id; }); $("error").hidden = true; };
const fail = (msg) => { $("error").textContent = msg; $("error").hidden = false; };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function post(path, body) {
  const r = await fetch("/auth/local-access/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), credentials: "same-origin" });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Sign-in failed. Try again.");
  return data;
}
const finish = (data) => { window.location.assign(data.redirect); };
async function busy(button, work) {
  button.disabled = true;
  try { await work(); } catch (e) { fail(e && e.name === "NotAllowedError" ? "Passkey request was cancelled or timed out." : (e.message || String(e))); }
  finally { button.disabled = false; }
}
document.querySelectorAll(".back").forEach((b) => b.addEventListener("click", () => show("choose")));
$("email-form").addEventListener("submit", (e) => { e.preventDefault(); busy($("send"), async () => {
  const data = await post("code", { email: $("email").value });
  $("code-email").textContent = data.email; $("dev-code").textContent = data.dev_code; show("code-step"); $("code").focus();
}); });
$("code-form").addEventListener("submit", (e) => { e.preventDefault(); busy($("verify"), async () => finish(await post("verify", { code: $("code").value }))); });
$("pk-open").addEventListener("click", () => { show("pk-step"); });
$("pk-setup-open").addEventListener("click", () => { $("setup-email").value = $("email").value; show("pk-setup"); $("setup-email").focus(); });
$("pk-start").addEventListener("click", () => busy($("pk-start"), async () => {
  if (!window.PublicKeyCredential) throw new Error("This browser doesn't support passkeys.");
  const o = await post("passkey/options", { mode: "login" });
  const cred = await navigator.credentials.get({ publicKey: { challenge: unb64(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: o.userVerification } });
  const r = cred.response;
  finish(await post("passkey/login", { id: b64(cred.rawId), clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.authenticatorData), signature: b64(r.signature) }));
}));
$("setup-form").addEventListener("submit", (e) => { e.preventDefault(); busy($("pk-create"), async () => {
  if (!window.PublicKeyCredential) throw new Error("This browser doesn't support passkeys.");
  const o = await post("passkey/options", { mode: "register", email: $("setup-email").value });
  const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) } } });
  const r = cred.response;
  if (!r.getPublicKey || !r.getAuthenticatorData) throw new Error("This browser can't export passkey keys; use a recent Chrome, Edge, Firefox or Safari.");
  finish(await post("passkey/register", { id: b64(cred.rawId), clientDataJSON: b64(r.clientDataJSON), authenticatorData: b64(r.getAuthenticatorData()),
    publicKey: b64(r.getPublicKey()), publicKeyAlgorithm: r.getPublicKeyAlgorithm() }));
}); });
</script></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Set-Cookie": deps.cookie(COOKIE, browser, STATE_TTL),
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  } });
}