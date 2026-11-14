import type { ComponentType, SVGProps } from 'react';
import { BeakerIcon, BoltIcon, FireIcon, HeartIcon } from '@heroicons/react/24/outline';
import { createRandom, gaussian, round } from './random';
import { classify, zoneOf, type HealthStatus, type Range, type Zone } from './status';

export type VitalId = 'heartRate' | 'systolic' | 'diastolic' | 'glucose' | 'temperature' | 'stress';
export type TimeWindow = '24h' | '7d' | '30d';

export interface VitalDefinition {
  id: VitalId;
  label: string;
  shortLabel: string;
  unit: string;
  decimals: number;
  color: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  normal: Range;
  caution: Range;
  base: number;
  circadianAmp: number;
  peakHour: number;
  noise: number;
  mealSpike?: number;
  source: string;
}

export interface Reading {
  t: number;
  value: number;
}

export interface TrendPoint {
  t: number;
  value: number;
  range: [number, number];
}

const HOUR = 3_600_000;
const HISTORY_HOURS = 30 * 24;
const MEAL_HOURS = [8, 13, 19];
const BUCKET_HOURS: Record<TimeWindow, number> = { '24h': 1, '7d': 4, '30d': 24 };
const WINDOW_HOURS: Record<TimeWindow, number> = { '24h': 24, '7d': 168, '30d': 720 };

export const NOW = Math.floor(Date.now() / HOUR) * HOUR;

export const VITALS: Record<VitalId, VitalDefinition> = {
  heartRate: {
    id: 'heartRate', label: 'Heart rate', shortLabel: 'HR', unit: 'bpm', decimals: 0,
    color: 'var(--color-data-categorical-blue)', icon: HeartIcon,
    normal: [55, 95], caution: [45, 110], base: 68, circadianAmp: 8, peakHour: 15, noise: 3,
    source: 'ECG chest patch',
  },
  systolic: {
    id: 'systolic', label: 'Systolic pressure', shortLabel: 'SYS', unit: 'mmHg', decimals: 0,
    color: 'var(--color-data-categorical-blue)', icon: HeartIcon,
    normal: [90, 129], caution: [85, 139], base: 117, circadianAmp: 6, peakHour: 10, noise: 4,
    source: 'Cuff · twice daily',
  },
  diastolic: {
    id: 'diastolic', label: 'Diastolic pressure', shortLabel: 'DIA', unit: 'mmHg', decimals: 0,
    color: 'var(--color-data-categorical-orange)', icon: HeartIcon,
    normal: [60, 84], caution: [55, 89], base: 76, circadianAmp: 4, peakHour: 10, noise: 3,
    source: 'Cuff · twice daily',
  },
  glucose: {
    id: 'glucose', label: 'Blood glucose', shortLabel: 'GLU', unit: 'mg/dL', decimals: 0,
    color: 'var(--color-data-categorical-teal)', icon: BeakerIcon,
    normal: [70, 140], caution: [60, 180], base: 94, circadianAmp: 3, peakHour: 6, noise: 4, mealSpike: 38,
    source: 'Continuous glucose monitor',
  },
  temperature: {
    id: 'temperature', label: 'Body temperature', shortLabel: 'TEMP', unit: '°C', decimals: 1,
    color: 'var(--color-data-categorical-orange)', icon: FireIcon,
    normal: [36.1, 37.5], caution: [35.5, 38], base: 37.05, circadianAmp: 0.3, peakHour: 17, noise: 0.08,
    source: 'Core temp sensor',
  },
  stress: {
    id: 'stress', label: 'Stress index', shortLabel: 'STRESS', unit: '/100', decimals: 0,
    color: 'var(--color-data-categorical-purple)', icon: BoltIcon,
    normal: [0, 55], caution: [0, 75], base: 38, circadianAmp: 10, peakHour: 14, noise: 6,
    source: 'EEG + HRV model',
  },
};

export const EXPLORER_VITALS: VitalId[] = ['heartRate', 'systolic', 'glucose', 'temperature', 'stress'];

const seriesCache = new Map<VitalId, Reading[]>();

// Adds a decaying post-meal glucose bump for a given hour.
function mealEffect(hour: number, spike: number) {
  return MEAL_HOURS.reduce((sum, meal) => {
    const since = (hour - meal + 24) % 24;
    return since < 4 ? sum + spike * Math.exp(-since / 1.1) * (since === 0 ? 0.6 : 1) : sum;
  }, 0);
}

// Builds 30 days of hourly readings for one vital.
function generateSeries(def: VitalDefinition): Reading[] {
  const random = createRandom(def.id.length * 7919 + def.base * 13);
  const readings: Reading[] = [];
  for (let i = HISTORY_HOURS - 1; i >= 0; i--) {
    const t = NOW - i * HOUR;
    const hour = new Date(t).getHours();
    const circadian = def.circadianAmp * Math.cos(((hour - def.peakHour) / 24) * Math.PI * 2);
    const spike = random() < 0.012 ? def.noise * (4 + random() * 4) : 0;
    const meal = def.mealSpike ? mealEffect(hour, def.mealSpike) : 0;
    const value = def.base + circadian + meal + spike + gaussian(random) * def.noise;
    readings.push({ t, value: round(value, def.decimals) });
  }
  return readings;
}

// Returns the cached hourly series for a vital.
export function getSeries(id: VitalId): Reading[] {
  let series = seriesCache.get(id);
  if (!series) {
    series = generateSeries(VITALS[id]);
    seriesCache.set(id, series);
  }
  return series;
}

// Slices the readings that fall inside a time window.
export function windowReadings(id: VitalId, window: TimeWindow): Reading[] {
  return getSeries(id).slice(-WINDOW_HOURS[window]);
}

// Buckets a window into averaged points with min/max range.
export function getTrend(id: VitalId, window: TimeWindow): TrendPoint[] {
  const readings = windowReadings(id, window);
  const size = BUCKET_HOURS[window];
  const decimals = VITALS[id].decimals;
  const points: TrendPoint[] = [];
  for (let i = 0; i < readings.length; i += size) {
    const bucket = readings.slice(i, i + size);
    const values = bucket.map(r => r.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    points.push({
      t: bucket[0].t,
      value: round(mean, decimals),
      range: [Math.min(...values), Math.max(...values)],
    });
  }
  return points;
}

// Percent of readings below, inside and above the normal band.
export function getZoneShare(id: VitalId, window: TimeWindow): Record<Zone, number> {
  const readings = windowReadings(id, window);
  const counts: Record<Zone, number> = { low: 0, normal: 0, high: 0 };
  for (const r of readings) counts[zoneOf(r.value, VITALS[id].normal)]++;
  const total = readings.length || 1;
  return {
    low: round((counts.low / total) * 100, 1),
    normal: round((counts.normal / total) * 100, 1),
    high: round((counts.high / total) * 100, 1),
  };
}

// Histogram bins with each bin's zone for coloring.
export function getHistogram(id: VitalId, window: TimeWindow, binCount = 16) {
  const def = VITALS[id];
  const values = windowReadings(id, window).map(r => r.value);
  const min = Math.min(...values);
  const width = (Math.max(...values) - min) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => {
    const center = round(min + width * (i + 0.5), def.decimals + 1);
    return { center, count: 0, zone: zoneOf(center, def.normal) };
  });
  for (const v of values) bins[Math.min(binCount - 1, Math.floor((v - min) / width))].count++;
  return bins;
}

// Day-by-hour grid of the last week for rhythm heatmaps.
export function getRhythm(id: VitalId) {
  const def = VITALS[id];
  return windowReadings(id, '7d').map(r => {
    const date = new Date(r.t);
    return {
      t: r.t,
      day: date.toLocaleDateString(undefined, { weekday: 'short' }),
      hour: date.getHours(),
      value: r.value,
      zone: zoneOf(r.value, def.normal),
    };
  });
}

// Latest reading, 24h delta and status for a tile.
export function getSnapshot(id: VitalId) {
  const def = VITALS[id];
  const series = getSeries(id);
  const latest = series[series.length - 1].value;
  const dayAgo = series[series.length - 25].value;
  const status: HealthStatus = classify(latest, def.normal, def.caution);
  return {
    latest,
    delta: round(latest - dayAgo, def.decimals),
    status,
    spark: series.slice(-48).map(r => r.value),
  };
}

// Formats a reading with the vital's precision.
export function formatReading(id: VitalId, value: number) {
  return value.toFixed(VITALS[id].decimals);
}

// Axis label for a timestamp at the given window granularity.
export function formatTick(t: number, window: TimeWindow) {
  const date = new Date(t);
  if (window === '24h') return date.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (window === '7d') return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
