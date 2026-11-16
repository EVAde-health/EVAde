/** Small HTTP helpers: JSON + FastAPI-style errors + CORS for the React Native app. */
import { envStr, type EnvLike } from "./config";

export class HttpError extends Error {
  constructor(public status: number, public detail: unknown) { super(typeof detail === "string" ? detail : "HTTP error"); }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { ...init, headers });
}

/** FastAPI's HTTPException body shape: {"detail": ...} */
export function errorResponse(status: number, detail: unknown): Response {
  return json({ detail }, { status });
}

export function corsHeaders(env: EnvLike, request: Request): Headers {
  const headers = new Headers();
  const allowed = (envStr(env, "CORS_ALLOW_ORIGINS", "*") ?? "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  if (allowed.includes("*")) headers.set("Access-Control-Allow-Origin", "*");
  else if (origin && allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.append("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-EVADE-Token");
  headers.set("Access-Control-Expose-Headers", "Retry-After");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

export function withCors(env: EnvLike, request: Request, response: Response): Response {
  if (response.status === 101) return response; // WebSocket upgrades are not CORS responses
  const res = new Response(response.body, response);
  corsHeaders(env, request).forEach((value, key) => res.headers.set(key, value));
  return res;
}

export function preflight(env: EnvLike, request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env, request) });
}
