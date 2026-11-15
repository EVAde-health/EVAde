// Typed calls to the EVAde Worker. Every function here reads or writes D1 through the API;
// the Worker checks the session, ownership and points, so the browser never decides either.
import { API_ORIGIN, api, userPath } from './api';

export type Level = 'green' | 'yellow' | 'red';

export interface SessionUser {
  user_id: string;
  display_name: string;
  full_name: string | null;
  role: string;
  demo?: boolean;
  synthetic?: number;
  environment: string;
  mission_name: string | null;
  mission_start: string | null;
  mission_length_days: number | null;
  crew_role: string | null;
  points: number;
  streak_days: number;
}

export interface MetricDefinition {
  metric: string;
  label: string;
  unit: string;
  domain: string;
  green_min: number | null;
  green_max: number | null;
  yellow_min: number | null;
  yellow_max: number | null;
  bad_direction: 'up' | 'down' | 'both';
  how_to_measure: string;
  why_it_matters: string;
  what_to_do: string;
  escalate_when: string;
  decimals: number;
  display_max: number | null;
  aggregation: 'mean' | 'sum' | 'last';
  ui_group: string | null;
}

export interface Observation {
  metric: string;
  value: number;
  unit: string;
  ts: string;
  level: Level | null;
  z: number | null;
  source: string;
}

export interface Alert {
  id: number;
  ts: string;
  level: 'yellow' | 'red';
  metric: string | null;
  message: string;
  action: string | null;
  escalate: number;
}

export interface Risk {
  r: number;
  band: string;
  action: string;
  mdtr: string | null;
  top_domains: string[];
}

export interface DashboardSummary {
  user: SessionUser;
  risk: Risk;
  alerts: Alert[];
}

export interface RadiationDose {
  ts: string;
  daily_dose_msv: number | null;
  cumulative_msv: number | null;
  spe_flag: number;
}

export interface RadiationHistory {
  limit_msv: number;
  doses: RadiationDose[];
}

export interface ApiTask {
  id: number;
  task_key: string;
  title: string;
  detail: string | null;
  category: string;
  metric: string | null;
  recurrence: 'daily' | 'weekly';
  points: number;
  completed_at: string | null;
  tutorial_id: string | null;
  time_window: string | null;
  kind: 'protocol' | 'basic';
  icon: string | null;
}

export interface TodayResponse {
  day: string;
  tasks: ApiTask[];
  streak_days: number;
  points: number;
}

export interface UserSettings {
  kcal_goal: number;
  protein_goal_g: number;
  carbs_goal_g: number;
  fat_goal_g: number;
  water_goal_ml: number;
  water_step_ml: number;
  sleep_target_h: number;
  timezone: string;
  color_mode: 'light' | 'dark' | null;
  reduced_motion: boolean;
}

export interface ApiTutorial {
  id: string;
  title: string;
  summary: string;
  category: string;
  minutes: number;
  points: number;
  metric: string | null;
  steps: string[];
  video_url: string | null;
  poster_url: string | null;
}

export interface TutorialProgress {
  tutorial_id: string;
  completed_at: string;
  points_awarded: number;
}

export interface ApiMeal {
  id: string;
  ts: string;
  name: string;
  grams: number;
  macros: { kcal: number; protein: number; carbs: number; fat: number };
  points_awarded?: number;
}

export interface ApiJournalMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
}

export interface ApiMedia {
  id: string;
  kind: string;
  content_type: string;
  bytes: number;
  note: string | null;
  ts: string;
  url: string;
}

export interface ApiFood {
  id: string;
  label: string;
  brand: string | null;
  source: 'space_pantry' | 'usda' | 'open_food_facts' | 'custom';
  per100g: { kcal: number; protein: number; carbs: number; fat: number };
}

export interface AuthProviders {
  providers: string[];
  default_provider: string | null;
}

type Signal = { signal?: AbortSignal };

// Local calendar day (YYYY-MM-DD) used for daily tasks and logs.
export function localDay(date = new Date()) {
  return date.toLocaleDateString('en-CA');
}

// ISO bounds of the local day, for meal and water queries.
export function localDayWindow(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return { since: start.toISOString(), until: end.toISOString() };
}

// ---------- session ----------

// Current signed-in user, or throws ApiError 401.
export const fetchSession = ({ signal }: Signal = {}) => api<{ user: SessionUser | null; demo?: boolean }>('/auth/me', { signal });

// Login methods the Worker has enabled.
export const fetchAuthProviders = ({ signal }: Signal = {}) => api<AuthProviders>('/auth/providers', { signal });

// End the EVAde session before navigating to the Access logout on the configured API host.
// Throws when the EVAde logout fails. Returns true when the page is navigating away to the Access logout.
// With redirect: false the Access session is ended in the background (same-site request) and the caller
// decides where the user lands.
export async function signOut({ clearAccess = true, redirect = true } = {}) {
  await api<void>('/auth/logout', { method: 'POST' });
  const accessLogout = new URL('/cdn-cgi/access/logout', API_ORIGIN);
  if (!clearAccess || accessLogout.protocol !== 'https:') return false;
  if (!redirect) {
    await fetch(accessLogout, { method: 'GET', mode: 'no-cors', credentials: 'include', cache: 'no-store' }).catch(() => undefined);
    return false;
  }
  window.location.assign(accessLogout.href);
  return true;
}

// ---------- health data ----------

// Metric catalogue: units, colour bands and how-to text.
export const fetchMetrics = ({ signal }: Signal = {}) => api<MetricDefinition[]>('/metrics', { signal });

// Every reading for the user over the last `days` days, oldest first.
export const fetchObservations = (userId: string, days: number, { signal }: Signal = {}) =>
  api<Observation[]>(userPath(userId, `observations?days=${days}`), { signal });

// Risk score, open alerts and the user record in one call.
export const fetchDashboard = (userId: string, { signal }: Signal = {}) => api<DashboardSummary>(userPath(userId, 'dashboard'), { signal });

// Dosimeter history plus the career radiation limit.
export const fetchRadiation = (userId: string, days: number, { signal }: Signal = {}) =>
  api<RadiationHistory>(userPath(userId, `radiation?days=${days}`), { signal });

// ---------- manual readings ----------

export interface LoggedReading {
  metric: string;
  value: number;
  unit: string;
  level: Level;
  ts: string;
}

// Logs readings at the current time; the Worker grades them, raises alerts and awards task XP.
// A daily radiation dose goes through the dosimeter log so the mission total and radiation chart include it.
export const postReadings = (readings: { metric: string; value: number }[]) => {
  const ts = new Date().toISOString();
  const dose = readings.length === 1 && readings[0].metric === 'daily_radiation_msv' ? readings[0].value : null;
  if (dose !== null) {
    return api<{ stored: LoggedReading[]; points_awarded: number }>('/radiation', {
      method: 'POST', body: { client_id: crypto.randomUUID(), ts, daily_dose_msv: dose, source: 'manual' },
    });
  }
  return api<{ stored: LoggedReading[]; points_awarded: number }>('/observations', {
    method: 'POST',
    body: { observations: readings.map(r => ({ ...r, ts, source: 'manual', client_id: crypto.randomUUID() })) },
  });
};

// ---------- flight surgeon contact ----------

export interface SurgeonRequestResult {
  delivered_to: number;
  urgent: boolean;
  emergency_id: number | null;
  summary: string;
}

// Delivers an assistant's "contact the flight surgeon" to the surgeon console; urgent ones open an emergency.
export const postSurgeonRequest = (request: { client_id: string; message: string; priority?: 'routine' | 'urgent'; source: 'voice' | 'journal' }) =>
  api<SurgeonRequestResult>('/surgeon-requests', { method: 'POST', body: request });

// ---------- return forecast ----------

export type ReturnDriver = 'risk' | 'trend' | 'radiation_limit' | 'bone_limit' | 'acute' | 'extreme_domain';

export interface MetricTrend {
  metric: string;
  label: string;
  unit: string;
  domain: string;
  level: Level;
  latest: number;
  latest_ts: string;
  days_with_data: number;
  slope_per_week: number | null;
  direction: 'rising' | 'falling' | 'steady' | null;
  worsening: boolean;
  r2: number | null;
  confidence: 'high' | 'medium' | 'low' | null;
  limit: number | null;
  days_to_limit: number | null;
  days_to_limit_range: { low: number; high: number | null } | null;
  concern: number;
}

export interface ReturnPrediction {
  generated_at: string;
  source: 'workers-ai' | 'model-api' | 'rules';
  model: string | null;
  provider_fallback: string | null;
  window_days: number;
  return: {
    status: 'ok' | 'insufficient_data';
    days: number | null;
    display: string;
    driver: ReturnDriver | null;
    driver_metric: string | null;
    driver_label: string | null;
    interval_days: { low: number; high: number | null } | null;
    provisional: boolean;
    scheduled_days_left: number | null;
  };
  most_concerning: { metric: string; label: string; level: Level; reason: string } | null;
  headline: string;
  explanation: string;
  trends: MetricTrend[];
  note: string;
  cached?: boolean;
}

// Trend analysis and the projected days until return; refresh skips the 30-minute cache.
export const fetchPrediction = (userId: string, refresh = false, { signal }: Signal = {}) =>
  api<ReturnPrediction>(userPath(userId, `prediction${refresh ? '?refresh=1' : ''}`), { signal });

// Saves a mood (and optional stress) self-report; also closes the mood task.
export const postSelfReport = (report: { mood?: number; stress?: number; note?: string }) =>
  api<{ ok: boolean }>('/self-reports', { method: 'POST', body: { client_id: crypto.randomUUID(), ...report } });

// ---------- missions ----------

// Today's tasks for the local day, the streak and the user's points.
export const fetchToday = (userId: string, { signal }: Signal = {}) => api<TodayResponse>(userPath(userId, `today?day=${localDay()}`), { signal });

// Completes or reopens a task; the Worker decides the points.
export const setTaskDone = (taskId: string, done: boolean) =>
  api<{ ok: boolean; already?: boolean; points_awarded?: number }>(`/tasks/${encodeURIComponent(taskId)}/${done ? 'complete' : 'reopen'}`, { method: 'POST', body: {} });

// Goals and preferences for the signed-in user.
export const fetchSettings = (userId: string, { signal }: Signal = {}) => api<UserSettings>(userPath(userId, 'settings'), { signal });

// ---------- nutrition ----------

// Today's meals for the local day.
export const fetchMeals = (userId: string, { signal }: Signal = {}) =>
  api<ApiMeal[]>(userPath(userId, `meals?${new URLSearchParams(localDayWindow())}`), { signal });

// Today's water total for the local day.
export const fetchHydration = (userId: string, { signal }: Signal = {}) =>
  api<{ total_ml: number }>(userPath(userId, `hydration?${new URLSearchParams(localDayWindow())}`), { signal });

// Logs a meal portion; returns the stored row and any XP awarded.
export const postMeal = (meal: { name: string; grams: number; macros: ApiMeal['macros'] }) =>
  api<ApiMeal>('/meals', { method: 'POST', body: { id: crypto.randomUUID(), ...meal } });

// Deletes one of the user's meals.
export const deleteMeal = (id: string) => api<void>(`/meals/${encodeURIComponent(id)}`, { method: 'DELETE' });

// Adds or removes water within today's local tracking window.
export const postHydration = (amountMl: number) => {
  const now = new Date();
  return api<{ amount_ml: number; points_awarded?: number }>('/hydration', {
    method: 'POST', body: { id: crypto.randomUUID(), amount_ml: amountMl, ts: now.toISOString(), ...localDayWindow(now) },
  });
};

// Searches the pantry, USDA and Open Food Facts through the Worker.
export const searchFoods = (query: string, { signal }: Signal = {}) =>
  api<ApiFood[]>(`/foods/search?${new URLSearchParams({ q: query })}`, { signal });

// ---------- tutorials ----------

// Tutorial library from D1.
export const fetchTutorials = ({ signal }: Signal = {}) => api<ApiTutorial[]>('/tutorials', { signal });

// Tutorials this user has completed.
export const fetchTutorialProgress = (userId: string, { signal }: Signal = {}) =>
  api<TutorialProgress[]>(userPath(userId, 'tutorials'), { signal });

// Marks a tutorial complete; points are awarded once by the Worker.
export const completeTutorialRequest = (id: string) =>
  api<{ points_awarded: number; already?: boolean }>(`/tutorials/${encodeURIComponent(id)}/complete`, { method: 'POST', body: {} });

// ---------- journal ----------

// Journal chat history, oldest first.
export const fetchJournalMessages = (userId: string, { signal }: Signal = {}) =>
  api<ApiJournalMessage[]>(userPath(userId, 'journal/messages'), { signal });

// Sends one journal message and returns the stored reply.
export const postJournalMessage = (id: string, content: string, { signal }: Signal = {}) =>
  api<{ message?: ApiJournalMessage; reply: ApiJournalMessage | null; duplicate?: boolean }>('/journal/messages', {
    method: 'POST', body: { id, content }, signal,
  });

export const postJournalChat = (id: string, message: string, { signal }: Signal = {}) =>
  api<{ reply: ApiJournalMessage | null }>('/journal/chat', { method: 'POST', body: { id, message }, signal });

// One finished voice check-in: the transcript turns plus the agent's saved check-in (if any). The Worker stores the
// entry and turns, then parses self-reports and readings. The session id makes retries safe (no duplicates).
export interface VoiceSessionTurn {
  sender: 'user' | 'assistant';
  content: string;
  ts: string;
}

export interface VoiceSessionCheckin {
  sleep_hours?: number | null;
  mood?: number | null;
  symptoms?: string[];
  systolic?: number | null;
  diastolic?: number | null;
  temperature_c?: number | null;
  blood_sugar_mg_dl?: number | null;
  notes?: string | null;
  level?: string;
  reasons?: string[];
  actions?: string[];
}

export interface VoiceSessionResult {
  entry_id: number;
  duplicate: boolean;
  messages: ApiJournalMessage[];
  reply: ApiJournalMessage | null;
}

export const postVoiceSession = (
  session: { session_id: string; turns: VoiceSessionTurn[]; checkin?: VoiceSessionCheckin | null },
  { signal }: Signal = {},
) => api<VoiceSessionResult>('/journal/voice-sessions', { method: 'POST', body: session, signal });

// ---------- media (selfies) ----------

// The user's stored photos, newest first.
export const fetchMedia = (userId: string, { signal }: Signal = {}) => api<ApiMedia[]>(userPath(userId, 'media'), { signal });

// Uploads a photo to R2 through the Worker.
export const uploadPhoto = (blob: Blob, note: string) =>
  api<ApiMedia>(`/media?${new URLSearchParams({ kind: 'photo', ...(note ? { note } : {}) })}`, { method: 'POST', raw: blob });

// Deletes one of the user's photos.
export const deleteMedia = (id: string) => api<void>(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' });
