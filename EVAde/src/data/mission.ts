import { createRandom, clamp, gaussian, round } from './random';
import { classify, type HealthStatus } from './status';
import { NOW } from './vitals';

const DAY = 86_400_000;

export const CREW = {
  name: 'Ryan Vega',
  callSign: 'Nova',
  role: 'Flight Engineer',
  mission: 'Expedition 74',
  missionDay: 142,
  missionLength: 180,
};

export const SLEEP_TARGET = 8;
export const RADIATION_LIMIT_MSV = 600;

export interface SleepNight {
  t: number;
  label: string;
  hours: number;
  deep: number;
  rem: number;
  light: number;
  awake: number;
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
  baseline: number;
}

export interface ImmuneMarker {
  id: string;
  label: string;
  value: number;
  unit: string;
  normal: readonly [number, number];
  scaleMax: number;
  status: HealthStatus;
}

export interface CardioEvent {
  id: string;
  t: number;
  title: string;
  detail: string;
  status: HealthStatus;
}

// Short weekday-and-date label for daily data.
function dayLabel(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Fourteen nights of sleep with stage breakdowns.
function buildSleep(): SleepNight[] {
  const random = createRandom(4242);
  return Array.from({ length: 14 }, (_, i) => {
    const t = NOW - (13 - i) * DAY;
    const hours = round(clamp(6.9 + gaussian(random) * 0.8 - (i === 9 ? 1.6 : 0), 4.2, 9), 1);
    const deep = round(hours * (0.16 + random() * 0.05), 1);
    const rem = round(hours * (0.2 + random() * 0.05), 1);
    const awake = round(0.2 + random() * 0.4, 1);
    const light = round(Math.max(0, hours - deep - rem - awake), 1);
    return { t, label: dayLabel(t), hours, deep, rem, light, awake, status: classify(hours, [7, 10], [6, 10]) };
  });
}

// Thirty-five days of self-reported mood on a 1–5 scale.
function buildMood(): MoodDay[] {
  const random = createRandom(777);
  return Array.from({ length: 35 }, (_, i) => {
    const t = NOW - (34 - i) * DAY;
    const isolationDip = i > 18 && i < 24 ? -0.9 : 0;
    const score = Math.round(clamp(3.7 + isolationDip + gaussian(random) * 0.7, 1, 5));
    return { t, label: dayLabel(t), score };
  });
}

// Daily radiation dose with one solar particle event.
function buildRadiation() {
  const random = createRandom(1337);
  let cumulative = 0;
  const days = Array.from({ length: CREW.missionDay }, (_, i) => {
    const flare = i === 118 ? 2.4 : 0;
    const dose = round(0.52 + random() * 0.18 + flare, 2);
    cumulative = round(cumulative + dose, 1);
    return { t: NOW - (CREW.missionDay - 1 - i) * DAY, label: dayLabel(NOW - (CREW.missionDay - 1 - i) * DAY), dose, cumulative };
  });
  return { days, recent: days.slice(-30), total: cumulative, today: days[days.length - 1].dose };
}

// Weekly bone-density scans plus a projection to mission end.
function buildBoneDensity() {
  const random = createRandom(9001);
  const weeks = Math.ceil(CREW.missionDay / 7);
  const totalWeeks = Math.ceil(CREW.missionLength / 7);
  return Array.from({ length: totalWeeks + 1 }, (_, week) => {
    const decline = -0.28 * week;
    const isMeasured = week <= weeks;
    return {
      week: `W${week}`,
      hip: isMeasured ? round(decline + gaussian(random) * 0.12, 2) : null,
      spine: isMeasured ? round(decline * 0.8 + gaussian(random) * 0.12, 2) : null,
      projected: week >= weeks ? round(-0.28 * week, 2) : null,
    };
  });
}

// Tonight-of-week behavioral dimensions from EEG and surveys.
const BEHAVIOR: BehaviorAxis[] = [
  { axis: 'Focus', today: 72, baseline: 78 },
  { axis: 'Energy', today: 61, baseline: 70 },
  { axis: 'Calm', today: 58, baseline: 66 },
  { axis: 'Social', today: 49, baseline: 64 },
  { axis: 'Cognition', today: 81, baseline: 80 },
  { axis: 'Motivation', today: 70, baseline: 74 },
];

const IMMUNE: ImmuneMarker[] = [
  { id: 'wbc', label: 'White blood cells', value: 5.1, unit: '×10⁹/L', normal: [4, 11], scaleMax: 14, status: 'nominal' },
  { id: 'lymph', label: 'Lymphocytes', value: 1.1, unit: '×10⁹/L', normal: [1, 4.8], scaleMax: 6, status: 'caution' },
  { id: 'il6', label: 'IL-6 inflammation', value: 6.8, unit: 'pg/mL', normal: [0, 7], scaleMax: 14, status: 'caution' },
  { id: 'crp', label: 'C-reactive protein', value: 1.9, unit: 'mg/L', normal: [0, 3], scaleMax: 10, status: 'nominal' },
  { id: 'ebv', label: 'EBV viral shedding', value: 2, unit: 'copies/µg', normal: [0, 5], scaleMax: 20, status: 'nominal' },
];

const CARDIO_EVENTS: CardioEvent[] = [
  { id: 'c1', t: NOW - 3 * 3_600_000, title: 'Sinus rhythm', detail: 'ECG model confidence 98%', status: 'nominal' },
  { id: 'c2', t: NOW - 26 * 3_600_000, title: 'Premature ventricular contraction', detail: '3 isolated PVCs during ARED session', status: 'caution' },
  { id: 'c3', t: NOW - 3 * DAY, title: 'Orthostatic intolerance drill', detail: 'LBNP test passed · HR +18 bpm', status: 'nominal' },
  { id: 'c4', t: NOW - 6 * DAY, title: 'Elevated resting HR', detail: '96 bpm for 40 min after EVA prep', status: 'caution' },
];

export const SLEEP = buildSleep();
export const MOOD = buildMood();
export const RADIATION = buildRadiation();
export const BONE_DENSITY = buildBoneDensity();
export { BEHAVIOR, IMMUNE, CARDIO_EVENTS };

export const MOOD_LABELS = ['Rough', 'Low', 'Okay', 'Good', 'Great'] as const;

// Composite 0–100 behavioral health score for today.
export function behaviorScore() {
  return Math.round(BEHAVIOR.reduce((sum, a) => sum + a.today, 0) / BEHAVIOR.length);
}

// Average sleep over the most recent week.
export function weeklySleepAverage() {
  const week = SLEEP.slice(-7);
  return round(week.reduce((sum, n) => sum + n.hours, 0) / week.length, 1);
}
