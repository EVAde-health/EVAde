// Browser client for the EVAde Worker API. The session lives in an HttpOnly cookie set by the Worker,
// so no token or key ever touches JavaScript; every request just sends credentials to one fixed origin.

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  raw?: Blob;
  signal?: AbortSignal;
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
async function send(path: string, { method = 'GET', body, raw, signal }: RequestOptions) {
  const headers = new Headers({ Accept: 'application/json' });
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
  if (response.status === 401) window.dispatchEvent(new Event(SIGN_IN_REQUIRED));
  if (!response.ok) {
    const detail = await response.json().then((data: { error?: string }) => data.error, () => undefined);
    throw new ApiError(response.status, detail);
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

export const staffLoginUrl = () => loginUrl('/auth/access/staff', '/admin');
export const demoLoginUrl = () => loginUrl('/auth/demo', '/dashboard');
