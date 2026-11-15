import type { Alert, MetricDefinition, RadiationHistory, SessionUser } from '../services/healthApi';
import { LEVEL_STATUS, normalRange, roundTo, type Reading } from './metrics';
import type { HealthStatus, Range } from './status';

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export const MOOD_LABELS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;
export const MOOD_EMOJI = ['😣', '😕', '😐', '🙂', '😄'] as const;

export const BEHAVIOR_AXES = [
  { metric: 'behavior_focus', axis: 'Focus' },
  { metric: 'behavior_energy', axis: 'Energy' },
  { metric: 'behavior_calm', axis: 'Calm' },
  { metric: 'behavior_social', axis: 'Social' },
  { metric: 'behavior_cognition', axis: 'Cognition' },
  { metric: 'behavior_motivation', axis: 'Motivation' },
] as const;

export const IMMUNE_METRICS = ['wbc', 'lymphocytes', 'il6', 'crp', 'ebv_shedding'] as const;

const SLEEP_STAGES = { deep: 'sleep_deep_hours', rem: 'sleep_rem_hours', light: 'sleep_light_hours', awake: 'sleep_awake_hours' } as const;
const STATUS_POINTS: Record<HealthStatus, number> = { nominal: 100, caution: 72, critical: 35 };

export interface SleepNight {
  t: number;
  label: string;
  hours: number;
  deep: number | null;
  rem: number | null;
  light: number | null;
  awake: number | null;
  status: HealthStatus;
}

export interface MoodDay {
  t: number;
  label: string;
  score: number;
}

export interface BehaviorAxis {
  axis: string;
  today: number;
  baseline: number | null;
}

export interface ImmuneMarker {
  id: string;
  label: string;
  value: number;
  unit: string;
  normal: Range;
  scaleMax: number;
  status: HealthStatus;
  t: number;
}

export interface CardioEvent {
  id: number;
  t: number;
  title: string;
  detail: string;
  status: HealthStatus;
}

export interface BonePoint {
  week: string;
  hip: number | null;
  spine: number | null;
  overall: number | null;
  projected: number | null;
}

type Readings = Map<string, Reading[]>;

// Local calendar key for a timestamp.
function dayKey(t: number) {
  return new Date(t).toLocaleDateString('en-CA');
}

// Short month-and-day label for daily data.
export function dayLabel(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Keeps the last reading of each local day.
function lastPerDay(readings: Reading[] = []) {
  const days = new Map<string, Reading>();
  for (const r of readings) days.set(dayKey(r.t), r);
  return days;
}

// Mean of a list, or null when empty.
function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

// Grades a value against a metric's green and yellow bands.
export function classifyWith(def: MetricDefinition | undefined, value: number): HealthStatus | null {
  const green = normalRange(def);
  if (!def || !green) return null;
  if (value >= green[0] && value <= green[1]) return 'nominal';
  if (def.yellow_min !== null && def.yellow_max !== null && value >= def.yellow_min && value <= def.yellow_max) return 'caution';
  return 'critical';
}

// Day of the mission (1-based) from the user's mission start.
export function missionDay(user: SessionUser, now = Date.now()) {
  const start = Date.parse(user.mission_start ?? '');
  return Number.isFinite(start) ? Math.max(1, Math.floor((now - start) / DAY) + 1) : null;
}

// Overall 0–100 health score from each signal's status.
export function healthScore(statuses: HealthStatus[]) {
  return statuses.length ? Math.round(statuses.reduce((sum, s) => sum + STATUS_POINTS[s], 0) / statuses.length) : null;
}

// Last fourteen nights of sleep, with stage breakdowns when recorded.
export function sleepNights(byMetric: Readings): SleepNight[] {
  const hours = lastPerDay(byMetric.get('sleep_hours'));
  const stages = Object.fromEntries(Object.entries(SLEEP_STAGES).map(([k, m]) => [k, lastPerDay(byMetric.get(m))])) as Record<keyof typeof SLEEP_STAGES, Map<string, Reading>>;
  return [...hours.entries()].slice(-14).map(([day, r]) => ({
    t: r.t,
    label: dayLabel(r.t),
    hours: roundTo(r.value, 1),
    deep: stages.deep.get(day)?.value ?? null,
    rem: stages.rem.get(day)?.value ?? null,
    light: stages.light.get(day)?.value ?? null,
    awake: stages.awake.get(day)?.value ?? null,
    status: r.status ?? (r.value >= 7 ? 'nominal' : r.value >= 6 ? 'caution' : 'critical'),
  }));
}

// Average of the most recent seven nights.
export function weeklySleepAverage(nights: SleepNight[]) {
  const avg = mean(nights.slice(-7).map(n => n.hours));
  return avg === null ? null : roundTo(avg, 1);
}

// Last thirty-five days of mood check-ins, one score per day.
export function moodDays(byMetric: Readings): MoodDay[] {
  return [...lastPerDay(byMetric.get('mood')).values()].slice(-35).map(r => ({
    t: r.t, label: dayLabel(r.t), score: Math.min(5, Math.max(1, Math.round(r.value))),
  }));
}

// Behavioral dimensions today vs the personal 30-day mean.
export function behaviorAxes(byMetric: Readings): BehaviorAxis[] {
  return BEHAVIOR_AXES.flatMap(({ metric, axis }) => {
    const readings = byMetric.get(metric) ?? [];
    if (!readings.length) return [];
    const today = readings[readings.length - 1];
    const history = readings.slice(0, -1).filter(r => r.t >= today.t - 30 * DAY).map(r => r.value);
    const baseline = mean(history);
    return [{ axis, today: Math.round(today.value), baseline: baseline === null ? null : Math.round(baseline) }];
  });
}

// Behavioral health index: the model's index, else the axis average.
export function behaviorIndex(byMetric: Readings, axes: BehaviorAxis[]) {
  const index = byMetric.get('behavior_index');
  if (index?.length) return Math.round(index[index.length - 1].value);
  const avg = mean(axes.map(a => a.today));
  return avg === null ? null : Math.round(avg);
}

// Latest immune panel markers that have been measured.
export function immuneMarkers(defs: Map<string, MetricDefinition>, byMetric: Readings): ImmuneMarker[] {
  return IMMUNE_METRICS.flatMap(id => {
    const def = defs.get(id);
    const readings = byMetric.get(id);
    const normal = normalRange(def);
    if (!def || !normal || !readings?.length) return [];
    const latest = readings[readings.length - 1];
    const scaleMax = def.display_max ?? Math.max(def.yellow_max ?? normal[1], latest.value) * 1.2;
    return [{
      id, label: def.label, value: latest.value, unit: def.unit, normal, scaleMax, t: latest.t,
      status: latest.status ?? classifyWith(def, latest.value) ?? 'nominal',
    }];
  });
}

// Weekly bone-density change since mission start, with a linear projection to landing.
export function boneSeries(byMetric: Readings, user: SessionUser) {
  const start = Date.parse(user.mission_start ?? '') || Math.min(...['bone_hip_change_pct', 'bone_spine_change_pct', 'bone_density_change_pct'].flatMap(m => (byMetric.get(m) ?? []).map(r => r.t)));
  const weekOf = (t: number) => Math.max(0, Math.floor((t - start) / WEEK));
  const series = { hip: 'bone_hip_change_pct', spine: 'bone_spine_change_pct', overall: 'bone_density_change_pct' } as const;
  const weeks = new Map<number, BonePoint>();
  const point = (week: number) => weeks.get(week) ?? { week: `W${week}`, hip: null, spine: null, overall: null, projected: null };
  for (const [key, metric] of Object.entries(series) as [keyof typeof series, string][]) {
    for (const r of byMetric.get(metric) ?? []) {
      const week = weekOf(r.t);
      weeks.set(week, { ...point(week), [key]: roundTo(r.value, 2) });
    }
  }
  const lead = (['hip', 'overall', 'spine'] as const).find(k => [...weeks.values()].some(p => p[k] !== null));
  if (!lead) return { points: [] as BonePoint[], lead: null, projectedAtEnd: null };
  const measured = [...weeks.entries()].filter(([, p]) => p[lead] !== null).map(([w, p]) => [w, p[lead] as number] as const);
  const lastWeek = Math.max(...measured.map(([w]) => w));
  const endWeek = user.mission_length_days ? Math.ceil(user.mission_length_days / 7) : null;
  let projectedAtEnd: number | null = null;
  if (endWeek && endWeek > lastWeek && measured.length >= 2) {
    const mx = mean(measured.map(([w]) => w))!;
    const my = mean(measured.map(([, v]) => v))!;
    const slope = measured.reduce((s, [w, v]) => s + (w - mx) * (v - my), 0) / (measured.reduce((s, [w]) => s + (w - mx) ** 2, 0) || 1);
    const at = (w: number) => roundTo(my + slope * (w - mx), 2);
    for (let w = lastWeek; w <= endWeek; w++) weeks.set(w, { ...point(w), projected: at(w) });
    projectedAtEnd = at(endWeek);
  }
  const points = [...weeks.entries()].sort(([a], [b]) => a - b).map(([, p]) => p);
  return { points, lead, projectedAtEnd };
}

// Daily dose series, mission total and projection from the dosimeter history.
export function radiationSummary(history: RadiationHistory | null, user: SessionUser) {
  const doses = (history?.doses ?? []).filter(d => d.daily_dose_msv !== null);
  if (!doses.length) return null;
  const days = doses.map(d => ({ t: Date.parse(d.ts), label: dayLabel(Date.parse(d.ts)), dose: roundTo(d.daily_dose_msv!, 2), spe: Boolean(d.spe_flag) }));
  const lastCumulative = [...(history?.doses ?? [])].reverse().find(d => d.cumulative_msv !== null)?.cumulative_msv;
  const total = roundTo(lastCumulative ?? days.reduce((s, d) => s + d.dose, 0), 1);
  const day = missionDay(user);
  const length = user.mission_length_days;
  const peak = days.reduce((p, d) => (d.dose > p.dose ? d : p));
  return {
    days: days.slice(-30),
    total,
    today: days[days.length - 1].dose,
    limit: history?.limit_msv ?? 600,
    projected: day && length ? Math.round((total / day) * length) : null,
    missionLength: length,
    peak: peak.spe || peak.dose > 1 ? peak : null,
  };
}

// Cardiac alerts from the Worker shown as an event timeline.
export function cardioEvents(alerts: Alert[], defs: Map<string, MetricDefinition>): CardioEvent[] {
  return alerts
    .filter(a => a.metric && defs.get(a.metric)?.domain === 'cardiac')
    .map(a => ({
      id: a.id,
      t: Date.parse(a.ts),
      title: defs.get(a.metric!)?.label ?? 'Cardiac reading',
      detail: a.message,
      status: LEVEL_STATUS[a.level],
    }));
}
