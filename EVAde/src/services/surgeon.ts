// Types and calls for the flight-surgeon console, 1:1 messages, emergencies and the astronaut's notes.
import { api } from './api';

export type Level = 'green' | 'yellow' | 'red' | null;
export type CrewStatus = 'nominal' | 'caution' | 'critical';

export interface VitalReading { value: number; unit: string; level: Level; ts: string; label: string }
export interface ProgressItem { value: number; target: number; unit: string }

export interface Emergency {
  id: number;
  user_id: string;
  display_name?: string;
  full_name?: string | null;
  status: 'open' | 'acknowledged' | 'resolved';
  message: string | null;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_name?: string | null;
  resolved_at: string | null;
  resolved_by_name?: string | null;
  resolution_note: string | null;
}

export interface CrewRow {
  user_id: string;
  synthetic?: number;
  display_name: string;
  full_name: string | null;
  crew_role: string | null;
  mission_name: string | null;
  points: number;
  streak_days: number;
  last_active: string | null;
  status?: CrewStatus;
  last_band?: string | null;
  red_indicators?: number;
  emergency?: Pick<Emergency, 'id' | 'status' | 'message' | 'created_at' | 'acknowledged_at' | 'acknowledged_by_name'> | null;
  open_alerts: number;
  red_alerts?: number;
  unread_messages?: number;
  vitals?: Partial<Record<'heart_rate' | 'systolic_bp' | 'diastolic_bp' | 'spo2' | 'body_temp' | 'respiration_rate', VitalReading | null>> | null;
  last_checkin?: { ts: string; mood: number | null; stress: number | null; source: string; level: Level } | null;
  last_journal_at: string | null;
  progress?: Partial<Record<'calories' | 'protein' | 'water_ml' | 'tasks', ProgressItem | null>> | null;
  goal_progress?: number | null;
}

export interface AstronautOption {
  user_id: string;
  display_name: string;
  full_name: string | null;
  crew_role: string | null;
  mission_name: string | null;
  emergency_status: 'open' | 'acknowledged' | null;
}

export interface AstronautDetail {
  user: {
    user_id: string; display_name: string; full_name: string | null; crew_role: string | null; mission_name: string | null;
    synthetic?: number;
    mission_start: string | null; mission_length_days: number | null; points: number; streak_days: number; last_active: string | null;
  };
  risk: { band: string; r: number; mdtr: string | null; ts: string } | null;
  open_alerts: number;
  escalated_alerts: number;
  open_emergencies: number;
  latest: { metric: string; label: string; domain: string; value: number; unit: string; level: Level; ts: string }[];
  last_checkin: { ts: string; mood: number | null; stress: number | null; fatigue: number | null; source: string; checkin_level: Level } | null;
}

export interface SeriesMetric {
  metric: string;
  label: string;
  unit: string;
  decimals: number;
  green_min: number | null;
  green_max: number | null;
  latest: { value: number; level: Level; ts: string } | null;
  points: { day: string; value: number; min: number; max: number; n: number }[];
}

export interface Observation {
  id: number;
  metric: string;
  label: string;
  value: number;
  unit: string;
  ts: string;
  level: Level;
  source: string;
  decimals: number | null;
  corrections: number;
  original_value: number | null;
}

export interface Correction {
  id: number;
  observation_id: number;
  metric: string;
  label: string;
  unit: string;
  original_value: number;
  corrected_value: number;
  original_level: Level;
  corrected_level: Level;
  reason: string;
  corrected_by_name: string | null;
  created_at: string;
  observed_at: string;
}

export type GoalType = 'calories' | 'protein' | 'carbs' | 'fat' | 'water_ml' | 'sleep_h' | 'steps';
export interface GoalTypeInfo { label: string; noun: string; unit: string; target: number; min: number; max: number }
export interface ResolvedGoal {
  goal_type: GoalType;
  label: string;
  unit: string;
  target: number;
  source: 'surgeon' | 'set' | 'self' | 'settings' | 'default';
  note: string | null;
  set_by_name: string | null;
  set_at: string | null;
}
export interface GoalHistoryRow {
  id: number;
  goal_type: GoalType;
  target: number;
  unit: string;
  note: string | null;
  created_at: string;
  set_by: string | null;
  set_by_name: string | null;
  set_by_role: string | null;
}

export interface JournalData {
  checkins: {
    id: number; ts: string; mood: number | null; stress: number | null; fatigue: number | null; sleep_quality: number | null;
    source: string; sleep_hours: number | null; symptoms: string[]; checkin_level: Level;
  }[];
  journal: { ts: string; source: string; mood_label: string | null; concern_level: string | null; ai_summary: string | null }[];
}

export interface TasksData {
  day: string;
  points: number;
  streak_days: number;
  today: { id: number; title: string; detail: string | null; category: string; points: number; completed_at: string | null; kind: string | null }[];
  history: { day: string; total: number; done: number; points: number }[];
  tutorials: { tutorial_id: string; title: string; completed_at: string; points_awarded: number }[];
}

export interface NutritionData {
  days: { day: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; meals: number }[];
  meals: { id: string; ts: string; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number }[];
  goals: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null; water_ml: number | null };
}

export interface SleepData {
  target: number;
  nights: { day: string; hours: number | null; deep: number | null; rem: number | null; light: number | null; awake: number | null }[];
}

export interface AdminNotifications {
  emergencies: Emergency[];
  open_count: number;
  acknowledged_count: number;
  unread_messages: number;
  server_time: string;
}

export interface Contact {
  user_id: string;
  display_name: string;
  full_name: string | null;
  role: string;
  crew_role: string | null;
  conversation_id: number | null;
  last_body: string | null;
  last_at: string | null;
  last_from_me: boolean;
  unread: number;
}

export interface Message {
  id: number;
  sender_id: string;
  sender_name?: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Thread {
  contact: Omit<Contact, 'conversation_id' | 'last_body' | 'last_at' | 'last_from_me' | 'unread'>;
  conversation: { id: number } | null;
  messages: Message[];
}

export interface UserNotification {
  id: number;
  kind: 'goal_updated' | 'emergency_acknowledged' | 'emergency_resolved' | 'vital_corrected' | 'message';
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
  actor_name: string | null;
}

export function personName(row: { display_name: string; full_name?: string | null }) {
  if (typeof row.full_name === 'string' && row.full_name.trim()) return row.full_name;
  return typeof row.display_name === 'string' && row.display_name.trim() ? row.display_name : 'Name unavailable';
}

// A partially rolled-out API can omit collections or include empty records.
export function responseRows<T extends object>(rows: T[] | null | undefined): T[] {
  return Array.isArray(rows) ? rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
}

export const hasTimestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

export const acknowledgeEmergency = (id: number) =>
  api<{ emergency: Emergency; claimed: boolean }>(`/admin/emergencies/${id}/acknowledge`, { method: 'POST', body: {} });
export const resolveEmergency = (id: number, note?: string) =>
  api<{ emergency: Emergency }>(`/admin/emergencies/${id}/resolve`, { method: 'POST', body: { note: note?.trim() || undefined } });
export const raiseEmergency = (message?: string) =>
  api<{ emergency: Emergency; already: boolean }>('/emergencies', { method: 'POST', body: { message: message?.trim() || undefined } });
export const sendMessage = (otherId: string, body: string) =>
  api<{ message: Message }>(`/messages/with/${encodeURIComponent(otherId)}`, { method: 'POST', body: { body } });
export const markThreadRead = (otherId: string) =>
  api<{ marked: number }>(`/messages/with/${encodeURIComponent(otherId)}/read`, { method: 'POST', body: {} });
export const setGoals = (astronautId: string, changes: { goal_type: GoalType; target: number }[], note?: string) =>
  api<{ goals: ResolvedGoal[]; changed: GoalType[] }>(`/admin/astronauts/${encodeURIComponent(astronautId)}/goals`, {
    method: 'POST', body: { changes, note: note?.trim() || undefined },
  });
export const correctObservation = (id: number, value: number, reason: string) =>
  api<{ correction: Correction }>(`/admin/observations/${id}/correct`, { method: 'POST', body: { value, reason } });
export const markNotificationsRead = (ids?: number[]) =>
  api<void>('/me/notifications/read', { method: 'POST', body: ids ? { ids } : {} });

export function levelStatus(level: Level | string | undefined): CrewStatus {
  if (level === 'red') return 'critical';
  if (level === 'yellow') return 'caution';
  return 'nominal';
}

/** "3 min ago", "2 h ago", "Mar 3". */
export function ago(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return 'never';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return 'unavailable';
  const minutes = Math.round((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatValue(value: number | null | undefined, decimals?: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  const precision = decimals != null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 20 ? decimals : 1;
  return value.toLocaleString(undefined, { maximumFractionDigits: precision });
}

/** 1-based mission day for a mission start timestamp. */
export function missionDayOf(start: string | null | undefined, now = Date.now()) {
  return hasTimestamp(start) ? Math.max(1, Math.floor((now - Date.parse(start)) / 86400000) + 1) : null;
}
