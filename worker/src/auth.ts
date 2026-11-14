/**
 * Access control for the app/browser API (port of browser_allowed() in
 * api/voice_browser.py, adapted for a public Worker + React Native clients).
 *
 * Allowed when ANY of:
 *  - `DEMO_OPEN` is true (hackathon demo: web/app voice + read APIs are public;
 *    spending guards still apply; /voice/alert and /api/alert stay protected),
 *  - `Authorization: Bearer <EVADE_BROWSER_TOKEN>` header (preferred for the RN app),
 *  - `?token=<EVADE_BROWSER_TOKEN>` query (web page links, WebSockets where the client
 *    cannot set headers),
 *  - `?ticket=<one-time ticket>` from POST /api/voice/start (WebSockets only),
 *  - local development: request host is localhost under `wrangler dev`, and the Origin
 *    (when present) matches the Host, same as the Python localhost-only rule.
 * On evade.health, when DEMO_OPEN is false the last rule can never match, so a token
 * is required.
 */
import { envStr, flag, isLocalRequest, safeEqual, type EnvLike } from "./config";
import { consumeToken, WS_TICKET_PREFIX } from "./tokens";

export function demoOpen(env: EnvLike): boolean {
  return flag(env, "DEMO_OPEN", false);
}

export function bearerToken(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

export function suppliedToken(request: Request): string | null {
  return bearerToken(request) ?? new URL(request.url).searchParams.get("token");
}

function originMatchesHost(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function appAllowed(env: EnvLike & { DB?: D1Database }, request: Request, opts: { allowTicket?: boolean } = {}): Promise<boolean> {
  if (demoOpen(env)) return true;
  const expected = envStr(env, "EVADE_BROWSER_TOKEN");
  const token = suppliedToken(request);
  if (expected && token && (await safeEqual(token, expected))) return true;
  if (opts.allowTicket && env.DB) {
    const ticket = new URL(request.url).searchParams.get("ticket");
    if (ticket && (await consumeToken(env.DB, ticket, { prefix: WS_TICKET_PREFIX }))) return true;
  }
  return isLocalRequest(request) && originMatchesHost(request);
}

/** /voice/alert guard: X-EVADE-Token (or Bearer) == EVADE_ALERT_TOKEN; localhost only if unset. */
export async function alertAuth(env: EnvLike, request: Request): Promise<{ status: number; detail: string } | null> {
  const expected = envStr(env, "EVADE_ALERT_TOKEN");
  if (expected) {
    const got = request.headers.get("X-EVADE-Token") ?? bearerToken(request) ?? "";
    if (!(await safeEqual(got, expected))) return { status: 401, detail: "Missing or wrong X-EVADE-Token" };
    return null;
  }
  if (!isLocalRequest(request)) return { status: 403, detail: "Set EVADE_ALERT_TOKEN to call this remotely" };
  return null;
}
