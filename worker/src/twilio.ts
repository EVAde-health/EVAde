/** Twilio helpers: TwiML builders, X-Twilio-Signature validation (WebCrypto), REST call. */
import { envStr, flag, isLocalRequest, publicBaseUrl, type EnvLike } from "./config";

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

/** <Response><Connect><Stream url=...><Parameter .../></Stream></Connect></Response> */
export function connectStreamTwiml(streamUrl: string, params: Record<string, string>): string {
  const p = Object.entries(params)
    .map(([name, value]) => `<Parameter name="${xmlEscape(name)}" value="${xmlEscape(value)}" />`).join("");
  return `${XML_DECL}<Response><Connect><Stream url="${xmlEscape(streamUrl)}">${p}</Stream></Connect></Response>`;
}

/** Same TwiML the Python alert used: Say, Pause 1s, Say (voice Polly.Joanna). */
export function alertTwiml(message: string): string {
  const say = `<Say voice="Polly.Joanna">${xmlEscape(message)}</Say>`;
  return `${XML_DECL}<Response>${say}<Pause length="1" />${say}</Response>`;
}

// --------------------------------------------------------- signature check
export function signatureCheckEnabled(env: EnvLike): boolean {
  return Boolean(envStr(env, "TWILIO_AUTH_TOKEN")) && flag(env, "TWILIO_VALIDATE_SIGNATURE", true);
}

/** Checks are on (the default) but there is no auth token to check with: a public webhook must refuse, not trust. */
export function signatureTokenMissing(env: EnvLike, request: Request): boolean {
  return flag(env, "TWILIO_VALIDATE_SIGNATURE", true) && !envStr(env, "TWILIO_AUTH_TOKEN") && !isLocalRequest(request);
}

/** The URL Twilio actually called (PUBLIC_BASE_URL + path + query), not the internal one. */
export function publicUrlFor(env: EnvLike, request: Request): string {
  const url = new URL(request.url);
  const base = publicBaseUrl(env);
  if (!base) return request.url;
  return base + url.pathname + url.search;
}

const enc = new TextEncoder();

/** Twilio's algorithm: HMAC-SHA1(authToken, url + sorted(key+value)), base64. */
export async function computeSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let bin = "";
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Variants twilio-python's RequestValidator accepts: URL with and without the default port. */
function urlVariants(raw: string): string[] {
  try {
    const u = new URL(raw);
    const defaultPort = u.protocol === "https:" ? "443" : u.protocol === "http:" ? "80" : "";
    const withoutPort = new URL(raw); withoutPort.port = "";
    const auth = u.username ? `${u.username}${u.password ? ":" + u.password : ""}@` : "";
    const withPort = `${u.protocol}//${auth}${u.hostname}:${u.port || defaultPort}${u.pathname}${u.search}`;
    return [...new Set([raw, withoutPort.toString(), withPort])];
  } catch {
    return [raw];
  }
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

export async function validateSignature(authToken: string, url: string, params: Record<string, string>, signature: string): Promise<boolean> {
  if (!signature) return false;
  for (const candidate of urlVariants(url)) {
    if (await constantTimeEqual(await computeSignature(authToken, candidate, params), signature)) return true;
  }
  return false;
}

export async function isValidTwilioRequest(env: EnvLike, request: Request, params: Record<string, string>): Promise<boolean> {
  const signature = request.headers.get("X-Twilio-Signature") ?? "";
  return Boolean(signature) && validateSignature(envStr(env, "TWILIO_AUTH_TOKEN")!, publicUrlFor(env, request), params, signature);
}

/** parse_qsl(body, keep_blank_values=True) -> dict (last value wins, like dict()). */
export function parseForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

// ------------------------------------------------------------ REST: calls
export interface CallResult { call_sid: string; status: string }

export async function createCall(env: EnvLike, to: string, twiml: string, fetcher: typeof fetch = fetch): Promise<CallResult> {
  const sid = envStr(env, "TWILIO_ACCOUNT_SID")!;
  const token = envStr(env, "TWILIO_AUTH_TOKEN")!;
  const from = envStr(env, "TWILIO_PHONE_NUMBER")!;
  const resp = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml }).toString(),
  });
  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    throw new TwilioError(resp.status, String(data.message ?? `Twilio returned HTTP ${resp.status}`));
  }
  return { call_sid: String(data.sid), status: String(data.status) };
}

export class TwilioError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "TwilioError"; }
}
