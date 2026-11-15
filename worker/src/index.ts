/**
 * EVAde voice agent on Cloudflare Workers (port of api/main.py + api/voice*.py).
 *
 * Phone (Twilio)
 *   POST /voice/incoming          Twilio voice webhook -> TwiML <Connect><Stream>
 *   WS   /voice/stream            Twilio Media Stream (one-time token checked on "start")
 *   POST /voice/alert             outbound red-alert call (alias POST /api/alert)
 * App / browser (React Native or /voice/ page) - see worker/API.md
 *   POST /api/voice/start         one-time WebSocket ticket for the voice socket
 *   WS   /api/voice/ws            voice WebSocket (alias WS /voice/browser)
 *   GET  /api/checkins/latest     (alias /voice/api/checkins/latest)
 *   GET  /api/downlink            (alias /voice/api/downlink)
 * Other
 *   GET  /                        landing page; /voice/ static page from ../frontend
 *   GET  /health
 */
import { log } from "./agent";
import { alertAuth, appAllowed } from "./auth";
import { envStr, publicBaseUrl } from "./config";
import { errorResponse, json, preflight, withCors } from "./http";
import { LANDING_HTML } from "./landing";
import { acquireBrowserSlot, countBrowserSlots, maxConcurrentSessions, maxSessionSeconds, releaseSlot, TOO_MANY_TALKING } from "./slots";
import { issueStreamToken, issueToken, WS_TICKET_PREFIX } from "./tokens";
import { latestCheckin, listDownlink } from "./tools";
import { alertTwiml, connectStreamTwiml, createCall, isValidTwilioRequest, parseForm, signatureCheckEnabled, TwilioError } from "./twilio";

export { VoiceSession } from "./session";

const DEFAULT_ALERT = "EVAde red alert. Please check the crew health dashboard now.";
const WS_TICKET_TTL_S = 60;

const isWsUpgrade = (r: Request) => r.headers.get("Upgrade")?.toLowerCase() === "websocket";

/** Accept the socket, tell the client why, and close (so the web page can show the reason). */
function rejectSocket(message: string): Response {
  const pair = new WebSocketPair();
  const [clientEnd, server] = [pair[0], pair[1]];
  server.accept();
  server.send(JSON.stringify({ type: "notice", message }));
  server.send(JSON.stringify({ type: "error", message }));
  server.send(JSON.stringify({ type: "status", state: "ended", reason: message }));
  server.close(1000, message);
  return new Response(null, { status: 101, webSocket: clientEnd });
}

// ------------------------------------------------------------------ phone
async function incomingCall(request: Request, env: Env): Promise<Response> {
  // Python: body.decode("utf-8", errors="replace")
  const body = new TextDecoder().decode(await request.arrayBuffer());
  const params = parseForm(body);
  if (signatureCheckEnabled(env) && !(await isValidTwilioRequest(env, request, params))) {
    log("warn", "Rejected /voice/incoming: bad or missing X-Twilio-Signature");
    return errorResponse(403, "Invalid Twilio signature");
  }
  const base = publicBaseUrl(env);
  const host = base ? new URL(base).host : request.headers.get("host") ?? new URL(request.url).host;
  const token = await issueStreamToken(env.DB, params.CallSid ?? null);
  const twiml = connectStreamTwiml(`wss://${host}/voice/stream`, { caller: params.From ?? "unknown", token });
  return new Response(twiml, { headers: { "Content-Type": "application/xml" } });
}

async function outboundAlert(request: Request, env: Env): Promise<Response> {
  const denied = await alertAuth(env, request);
  if (denied) return errorResponse(denied.status, denied.detail);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(422, [{ type: "json_invalid", loc: ["body"], msg: "JSON decode error" }]);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const errors: unknown[] = [];
  if (typeof b.to !== "string") errors.push({ type: b.to === undefined ? "missing" : "string_type", loc: ["body", "to"], msg: b.to === undefined ? "Field required" : "Input should be a valid string" });
  const message = b.message === undefined ? DEFAULT_ALERT : b.message;
  if (typeof message !== "string") errors.push({ type: "string_type", loc: ["body", "message"], msg: "Input should be a valid string" });
  else if ([...message].length > 600) errors.push({ type: "string_too_long", loc: ["body", "message"], msg: "String should have at most 600 characters" });
  if (errors.length) return errorResponse(422, errors);

  if (!(envStr(env, "TWILIO_ACCOUNT_SID") && envStr(env, "TWILIO_AUTH_TOKEN") && envStr(env, "TWILIO_PHONE_NUMBER"))) {
    return errorResponse(503, "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER must be set");
  }
  try {
    return json(await createCall(env, b.to as string, alertTwiml(message as string)));
  } catch (err) {
    if (err instanceof TwilioError) return errorResponse(502, `Twilio error: ${err.message}`);
    throw err;
  }
}

function toSession(request: Request, env: Env, mode: "phone" | "browser", crew?: string, slot?: string): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL("https://voice-session/connect");
  target.searchParams.set("mode", mode);
  target.searchParams.set("maxSeconds", String(maxSessionSeconds(env, mode)));
  if (crew !== undefined) target.searchParams.set("crew", crew);
  if (slot) target.searchParams.set("slot", slot);
  const stub = env.VOICE_SESSION.get(env.VOICE_SESSION.newUniqueId());
  log("info", "voice session", { mode, path: url.pathname });
  return stub.fetch(new Request(target.toString(), request));
}

// ------------------------------------------------------------ app / browser
const forbidden = () => errorResponse(403, "Missing or wrong token (Authorization: Bearer <EVADE_BROWSER_TOKEN>)");

async function voiceSocket(request: Request, env: Env): Promise<Response> {
  if (!isWsUpgrade(request)) return errorResponse(426, "Expected a WebSocket upgrade");
  if (!(await appAllowed(env, request, { allowTicket: true }))) return forbidden();
  const cap = maxConcurrentSessions(env);
  const slot = await acquireBrowserSlot(env.DB, cap);
  if (!slot) return rejectSocket(TOO_MANY_TALKING);
  const crew = (new URL(request.url).searchParams.get("crew") || "browser-demo").slice(0, 64);
  try {
    return await toSession(request, env, "browser", crew, slot);
  } catch (err) {
    await releaseSlot(env.DB, slot);
    throw err;
  }
}

async function voiceStart(request: Request, env: Env): Promise<Response> {
  if (!(await appAllowed(env, request))) return forbidden();
  if ((await countBrowserSlots(env.DB)) >= maxConcurrentSessions(env)) {
    return errorResponse(429, TOO_MANY_TALKING);
  }
  const url = new URL(request.url);
  let crew = url.searchParams.get("crew");
  if (!crew && request.headers.get("Content-Type")?.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.crew === "string") crew = body.crew;
  }
  crew = (crew || "browser-demo").slice(0, 64);
  const ticket = await issueToken(env.DB, { prefix: WS_TICKET_PREFIX, ttlS: WS_TICKET_TTL_S });
  const base = publicBaseUrl(env) ?? url.origin;
  const wsBase = base.replace(/^http/, "ws");
  const qs = new URLSearchParams({ ticket, crew });
  return json({
    ws_url: `${wsBase}/api/voice/ws?${qs}`,
    ticket,
    crew_id: crew,
    expires_in: WS_TICKET_TTL_S,
    protocol: "evade-voice-1",
    audio: { input: { format: "pcm16le", sample_rate: 24000, channels: 1, encoding: "base64" },
             output: { format: "pcm16le", sample_rate: 24000, channels: 1, encoding: "base64" } },
  });
}

async function apiLatest(request: Request, env: Env): Promise<Response> {
  if (!(await appAllowed(env, request))) return forbidden();
  const crew = new URL(request.url).searchParams.get("crew_id");
  return json({ checkin: await latestCheckin(env.DB, crew || null) });
}

async function apiDownlink(request: Request, env: Env): Promise<Response> {
  if (!(await appAllowed(env, request))) return forbidden();
  const sp = new URL(request.url).searchParams;
  const raw = sp.get("limit");
  let limit = 10;
  if (raw !== null) {
    if (!/^[+-]?\d+$/.test(raw.trim())) return errorResponse(422, [{ type: "int_parsing", loc: ["query", "limit"], msg: "Input should be a valid integer" }]);
    limit = parseInt(raw, 10);
    if (limit < 1) return errorResponse(422, [{ type: "greater_than_equal", loc: ["query", "limit"], msg: "Input should be greater than or equal to 1" }]);
    if (limit > 100) return errorResponse(422, [{ type: "less_than_equal", loc: ["query", "limit"], msg: "Input should be less than or equal to 100" }]);
  }
  return json({ messages: await listDownlink(env.DB, limit, sp.get("crew_id") || null) });
}

function apiIndex(): Response {
  return json({
    name: "EVAde voice API",
    docs: "https://github.com/ryanmarklin-arch/EVAde/blob/feature/twilio-grok-voice-agent/worker/API.md",
    endpoints: [
      "POST /api/voice/start", "WS /api/voice/ws", "GET /api/checkins/latest", "GET /api/downlink",
      "POST /api/alert", "GET /health",
    ],
  });
}

// ------------------------------------------------------------------ router
type Handler = (request: Request, env: Env) => Promise<Response> | Response;

const ROUTES: Record<string, Partial<Record<string, Handler>>> = {
  "/health": { GET: () => json({ status: "ok" }) },
  "/": { GET: () => new Response(LANDING_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } }) },
  "/voice/incoming": { POST: incomingCall },
  "/voice/stream": { GET: (r, e) => (isWsUpgrade(r) ? toSession(r, e, "phone") : errorResponse(426, "Expected a WebSocket upgrade")) },
  "/voice/alert": { POST: outboundAlert },
  "/voice/browser": { GET: voiceSocket },
  "/voice/api/checkins/latest": { GET: apiLatest },
  "/voice/api/downlink": { GET: apiDownlink },
  "/api": { GET: apiIndex },
  "/api/": { GET: apiIndex },
  "/api/voice/start": { POST: voiceStart },
  "/api/voice/ws": { GET: voiceSocket },
  "/api/checkins/latest": { GET: apiLatest },
  "/api/downlink": { GET: apiDownlink },
  "/api/alert": { POST: outboundAlert },
};

/** Paths that get CORS headers (JSON API used by the React Native app). */
const isApiPath = (p: string) => p === "/api" || p.startsWith("/api/") || p.startsWith("/voice/api/") || p === "/voice/alert" || p === "/health";

/** Route one request (exported so tests can pass a custom env). */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const api = isApiPath(path);
  if (request.method === "OPTIONS" && api) return preflight(env, request);

  const route = ROUTES[path];
  let response: Response;
  if (route) {
    const handler = route[request.method] ?? (request.method === "HEAD" ? route.GET : undefined);
    if (!handler) response = errorResponse(405, "Method Not Allowed");
    else {
      try {
        response = await handler(request, env);
      } catch (err) {
        log("error", "unhandled error", { path, error: String(err), stack: (err as Error)?.stack });
        response = errorResponse(500, "Internal Server Error");
      }
    }
  } else if (env.ASSETS) {
    response = await env.ASSETS.fetch(request); // frontend/ (e.g. /voice/, /voice/app.js)
  } else {
    response = errorResponse(404, "Not Found");
  }
  return api ? withCors(env, request, response) : response;
}

export default {
  fetch: (request, env) => handleRequest(request, env),
} satisfies ExportedHandler<Env>;
