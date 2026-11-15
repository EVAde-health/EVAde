export interface CrewMember {
  user_id: string;
  display_name: string;
  full_name: string | null;
  crew_id: string | null;
  crew_role: string | null;
  environment: string;
  mission_name: string | null;
  mission_start: string | null;
  points: number;
  streak_days: number;
  last_active: string | null;
  last_r: number | null;
  last_band: string | null;
  open_alerts: number;
  escalated_alerts: number;
  red_indicators: number;
  open_emergencies: number;
  heart_rate: number | null;
  heart_rate_level: string | null;
  sleep_hours: number | null;
  mood: number | null;
}

export interface Goal {
  metric: string;
  label: string;
  unit: string;
  target: number;
  source: 'default' | 'set';
  note: string | null;
  effective_at: string | null;
  set_by_name: string | null;
}

export interface GoalChange extends Goal {
  id: number;
  superseded_at: string | null;
}

export interface SeriesMetric {
  metric: string;
  label: string;
  unit: string;
  latest: { value: number; level: string | null; ts: string } | null;
  points: { day: string; value: number; min: number; max: number; n: number; source: string }[];
}

export interface StaffMember {
  user_id: string;
  display_name: string;
  full_name: string | null;
  role: string;
  crew_role: string | null;
}

export interface ChatThread {
  id: number;
  astronaut_id: string;
  staff_id: string;
  astronaut_name: string;
  staff_name: string;
  staff_role: string;
  updated_at: string;
  last_body: string | null;
  last_at: string | null;
  unread: number;
}

export interface ChatMessageRow {
  id: number;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

export interface Emergency {
  id: number;
  user_id: string;
  display_name?: string;
  status: 'open' | 'acknowledged' | 'resolved';
  message: string | null;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  acknowledged_by_name?: string | null;
  resolved_by_name?: string | null;
}

export interface ClinicAlert {
  id: number;
  user_id?: string;
  display_name?: string;
  ts: string;
  level: 'yellow' | 'red';
  metric: string | null;
  message: string;
  action: string | null;
  escalate: number;
  acknowledged: number;
  resolved_at: string | null;
}

export function roleLabel(role: string) {
  if (role === 'flight_surgeon') return 'Flight surgeon';
  if (role === 'therapist') return 'Therapist';
  if (role === 'admin') return 'Admin';
  return 'Astronaut';
}

export function bandStatus(band: string | null | undefined) {
  if (band === 'high' || band === 'critical' || band === 'red') return 'critical' as const;
  if (band === 'guarded' || band === 'elevated' || band === 'moderate' || band === 'yellow') return 'caution' as const;
  return 'nominal' as const;
}
