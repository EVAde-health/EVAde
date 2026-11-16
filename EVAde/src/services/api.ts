// Browser client for the EVAde Worker API. The session lives in an HttpOnly cookie set by the Worker,
// so no token or key ever touches JavaScript; every request just sends credentials to one fixed origin.
import { requestTurnstile } from './turnstile';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  raw?: Blob;
  signal?: AbortSignal;
  demoAction?: 'demo_reset' | 'demo_chat';
}

export const SIGN_IN_REQUIRED = 'evade:sign-in-required';
export const STAFF_ROLES = new Set(['flight_surgeon', 'therapist', 'admin']);

// Validates VITE_API_URL: HTTPS only, except a loopback Worker during local development.
function resolveApiOrigin() {
  const url = new URL(import.meta.env.VITE_API_URL || 'https://api.evade.health');
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const isAllowedHttp = import.meta.env.DEV && url.protocol === 'http:' && isLoopback;
  if ((url.protocol !== 'https:' && !isAllowedHttp) || url.username || url.password) {
    throw new Error('VITE_API_URL must be an HTTPS API origin.');
  }
  return url.origin;
}

export const API_ORIGIN = resolveApiOrigin();

export class ApiError extends Error {
  readonly status: number;

  // Carries the HTTP status so callers can tell 401/403/503 apart.
  constructor(status: number, message?: string) {
    super(message ?? `EVAde request failed (HTTP ${status})`);
    this.status = status;
  }
}

// Builds an absolute API URL and refuses anything outside the API origin.
function apiUrl(path: string) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error('Expected an EVAde API path.');
  return url;
}

// Sends one credentialed request; signals sign-in expiry on 401.
async function send(path: string, { method = 'GET', body, raw, signal, demoAction }: RequestOptions) {
  const headers = new Headers({ Accept: 'application/json' });
  if (demoAction) {
    const config = await api<{ demo_turnstile_site_key?: string }>('/auth/providers', { signal });
    if (config.demo_turnstile_site_key) {
      headers.set('X-Turnstile-Token', await requestTurnstile(config.demo_turnstile_site_key, demoAction, signal));
    }
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (raw) headers.set('Content-Type', raw.type);
  const response = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    signal,
    headers,
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  if (response.status === 401 && !signal?.aborted) window.dispatchEvent(new Event(SIGN_IN_REQUIRED));
  if (!response.ok) {
    const failure = await response.json().then((data: { error?: string; safety_guidance?: boolean }) => data, () => undefined);
    const detail = failure?.error;
    const minuteLimit = response.status === 429 && Number(response.headers.get('Retry-After')) <= 60;
    throw new ApiError(response.status, minuteLimit && !failure?.safety_guidance && !detail?.startsWith('Voice is paused for today')
      ? 'Too many attempts, try again in a minute' : detail);
  }
  return response;
}

// JSON request helper used by every service module.
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

// Downloads a private file (e.g. a selfie) as a Blob with the session cookie.
export async function apiBlob(path: string, signal?: AbortSignal) {
  return (await send(path, { signal })).blob();
}

// Path to one user's sub-resource, safely encoded.
export function userPath(userId: string, resource: string) {
  return `/users/${encodeURIComponent(userId)}/${resource}`;
}

// Where the Worker sends the browser after a successful sign-in.
function loginUrl(path: string, destination: '/dashboard' | '/admin') {
  const url = apiUrl(path);
  url.searchParams.set('redirect', `${window.location.origin}${destination}`);
  return url.href;
}

// Cloudflare Access sign-in (also creates the account on first visit); Access guards this Worker path.
export function accessLoginUrl() {
  return loginUrl('/auth/access', '/dashboard');
}

// "Try the demo" as the seeded astronaut, or the seeded flight surgeon; replaces any demo session.
export function demoLoginUrl(persona: 'astronaut' | 'surgeon' = 'astronaut') {
  return persona === 'surgeon' ? loginUrl('/auth/demo?as=surgeon', '/admin') : loginUrl('/auth/demo', '/dashboard');
}
