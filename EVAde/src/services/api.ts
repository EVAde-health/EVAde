const apiUrl = new URL(import.meta.env.VITE_API_URL || 'https://api.evade.health');
const local = import.meta.env.DEV && apiUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname);
if ((!local && apiUrl.protocol !== 'https:') || apiUrl.username || apiUrl.password) {
  throw new Error('VITE_API_URL must be an HTTPS API origin.');
}

export const API_ORIGIN = apiUrl.origin;
const siteOrigin = import.meta.env.DEV ? window.location.origin : 'https://evade.health';
export const ACCESS_LOGIN_URL = `${API_ORIGIN}/auth/access?redirect=${encodeURIComponent(`${siteOrigin}/dashboard`)}`;
export const ACCESS_STAFF_LOGIN_URL = `${API_ORIGIN}/auth/access/staff?redirect=${encodeURIComponent(`${siteOrigin}/admin`)}`;
export const SIGN_IN_REQUIRED = 'evade:sign-in-required';
export const STAFF_ROLES = new Set(['flight_surgeon', 'therapist', 'admin']);

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, detail?: string) {
    super(detail || `EVAde request failed (HTTP ${status})`);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  { method = 'GET', body, signal }: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error('Expected an EVAde API path.');
  const response = await fetch(url, {
    method,
    credentials: 'include',
    cache: 'no-store',
    redirect: 'error',
    signal,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let detail = '';
    try { detail = ((await response.json()) as { error?: string }).error ?? ''; } catch { /* no body */ }
    if (response.status === 401) window.dispatchEvent(new Event(SIGN_IN_REQUIRED));
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const userPath = (userId: string, resource: string) => `/users/${encodeURIComponent(userId)}/${resource}`;

export interface SessionUser {
  user_id: string;
  display_name: string;
  role: string;
  mission_name: string | null;
  mission_start: string | null;
  points: number;
  streak_days: number;
}

export interface ApiTask {
  id: number;
  title: string;
  category: string;
  metric: string | null;
  due_at: string | null;
  completed_at: string | null;
  points: number;
}
