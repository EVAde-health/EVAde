/** Env helpers (port of voice_agent.env / voice_agent.flag). Empty strings count as unset. */

/** Any env object (the generated Env or a plain test object). */
export type EnvLike = object;

export function envStr(env: EnvLike, name: string, fallback?: string): string | undefined {
  const value = (env as Record<string, unknown>)[name];
  if (typeof value === "string" && value !== "") return value;
  return fallback;
}

export function flag(env: EnvLike, name: string, fallback: boolean): boolean {
  const value = envStr(env, name);
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function envInt(env: EnvLike, name: string, fallback: number): number {
  const value = envStr(env, name);
  if (value === undefined) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function publicBaseUrl(env: EnvLike): string | undefined {
  const url = envStr(env, "PUBLIC_BASE_URL");
  return url ? url.replace(/\/+$/, "") : undefined;
}

const enc = new TextEncoder();

/** Constant-time string comparison (port of secrets.compare_digest). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  // Hash both sides first so the comparison length never depends on the secret.
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const equalHash = crypto.subtle.timingSafeEqual(ha, hb);
  return equalHash && a.length === b.length;
}

/** 24 random bytes, base64url (port of secrets.token_urlsafe(24)). */
export function randomToken(bytes = 24): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Python's datetime.now(timezone.utc).isoformat(): 2026-11-14T18:00:00.123000+00:00 */
export function isoNow(date: Date = new Date()): string {
  return date.toISOString().replace(/\.(\d{3})Z$/, ".$1000+00:00");
}

/** Hosts that mean "running locally under wrangler dev" (the Python app's localhost checks). */
export const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalRequest(request: Request): boolean {
  return LOCAL_HOSTNAMES.has(new URL(request.url).hostname);
}
