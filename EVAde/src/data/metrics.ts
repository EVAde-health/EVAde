import type { ComponentType, SVGProps } from 'react';
import { BeakerIcon, BoltIcon, FireIcon, HeartIcon, SignalIcon, SparklesIcon } from '@heroicons/react/24/outline';
import type { Level, MetricDefinition, Observation } from '../services/healthApi';
import { zoneOf, type HealthStatus, type Range, type Zone } from './status';

export type TimeWindow = '24h' | '7d' | '30d';

export interface Reading {
  t: number;
  value: number;
  status: HealthStatus | null;
}

export interface TrendPoint {
  t: number;
  value: number;
  range: [number, number];
}

export interface ExplorerVital {
  id: string;
  shortLabel: string;
  color: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  source: string;
  pair?: string;
}

const HOUR = 3_600_000;
const BUCKET_HOURS: Record<TimeWindow, number> = { '24h': 1, '7d': 6, '30d': 24 };
const WINDOW_HOURS: Record<TimeWindow, number> = { '24h': 24, '7d': 168, '30d': 720 };

export const LEVEL_STATUS: Record<Level, HealthStatus> = { green: 'nominal', yellow: 'caution', red: 'critical' };

// Presentation for the vitals shown as tiles and in the explorer (data comes from D1).
export const EXPLORER_VITALS: ExplorerVital[] = [
  { id: 'heart_rate', shortLabel: 'HR', color: 'var(--color-data-categorical-blue)', icon: HeartIcon, source: 'ECG chest patch' },
  { id: 'systolic_bp', shortLabel: 'BP', color: 'var(--color-data-categorical-blue)', icon: HeartIcon, source: 'Cuff · twice daily', pair: 'diastolic_bp' },
  { id: 'blood_glucose', shortLabel: 'GLU', color: 'var(--color-data-categorical-teal)', icon: BeakerIcon, source: 'Continuous glucose monitor' },
  { id: 'body_temp', shortLabel: 'TEMP', color: 'var(--color-data-categorical-orange)', icon: FireIcon, source: 'Core temp sensor' },
  { id: 'spo2', shortLabel: 'SpO2', color: 'var(--color-data-categorical-purple)', icon: SparklesIcon, source: 'Pulse oximeter' },
  { id: 'hrv_rmssd', shortLabel: 'HRV', color: 'var(--color-data-categorical-teal)', icon: SignalIcon, source: 'ECG / HRV session' },
  { id: 'respiration_rate', shortLabel: 'RESP', color: 'var(--color-data-categorical-orange)', icon: BoltIcon, source: 'Chest strap' },
  { id: 'stress_index', shortLabel: 'STRESS', color: 'var(--color-data-categorical-purple)', icon: BoltIcon, source: 'EEG + HRV model' },
];

export const PAIR_COLOR = 'var(--color-data-categorical-orange)';

// Green band of a metric, when the catalogue defines one.
export function normalRange(def: MetricDefinition | undefined): Range | null {
  return def && def.green_min !== null && def.green_max !== null ? [def.green_min, def.green_max] : null;
}

// Groups API observations into time-sorted readings per metric.
export function groupReadings(observations: Observation[]) {
  const byMetric = new Map<string, Reading[]>();
  for (const o of observations) {
    const list = byMetric.get(o.metric) ?? [];
    list.push({ t: Date.parse(o.ts), value: o.value, status: o.level ? LEVEL_STATUS[o.level] : null });
    byMetric.set(o.metric, list);
  }
  for (const list of byMetric.values()) list.sort((a, b) => a.t - b.t);
  return byMetric;
}

// Rounds a value to the metric's display precision.
export function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// Formats a reading with the metric's precision.
export function formatReading(value: number, decimals = 0) {
  return value.toFixed(decimals);
}

// Readings inside a time window ending now.
export function windowReadings(readings: Reading[], window: TimeWindow, now = Date.now()) {
  const from = now - WINDOW_HOURS[window] * HOUR;
  return readings.filter(r => r.t >= from);
}

// Buckets readings into averaged points with a min/max range.
export function getTrend(readings: Reading[], window: TimeWindow, decimals: number): TrendPoint[] {
  const size = BUCKET_HOURS[window] * HOUR;
  const buckets = new Map<number, number[]>();
  for (const r of windowReadings(readings, window)) {
    const key = Math.floor(r.t / size) * size;
    buckets.set(key, [...(buckets.get(key) ?? []), r.value]);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([t, values]) => ({
    t,
    value: roundTo(values.reduce((a, b) => a + b, 0) / values.length, decimals),
    range: [Math.min(...values), Math.max(...values)],
  }));
}

// Percent of readings below, inside and above the normal band.
export function getZoneShare(readings: Reading[], normal: Range): Record<Zone, number> {
  const counts: Record<Zone, number> = { low: 0, normal: 0, high: 0 };
  for (const r of readings) counts[zoneOf(r.value, normal)]++;
  const total = readings.length || 1;
  return {
    low: roundTo((counts.low / total) * 100, 1),
    normal: roundTo((counts.normal / total) * 100, 1),
    high: roundTo((counts.high / total) * 100, 1),
  };
}

// Histogram bins with each bin's zone for colouring.
export function getHistogram(readings: Reading[], normal: Range, decimals: number, binCount = 12) {
  const values = readings.map(r => r.value);
  if (!values.length) return [];
  const min = Math.min(...values);
  const width = (Math.max(...values) - min) / binCount || 1;
  const bins = Array.from({ length: binCount }, (_, i) => {
    const center = roundTo(min + width * (i + 0.5), decimals + 1);
    return { center, count: 0, zone: zoneOf(center, normal) };
  });
  for (const v of values) bins[Math.min(binCount - 1, Math.floor((v - min) / width))].count++;
  return bins;
}

// Day × hour cells of the last week for the rhythm heatmap.
export function getRhythm(readings: Reading[], normal: Range | null) {
  return windowReadings(readings, '7d').map(r => {
    const date = new Date(r.t);
    return {
      t: r.t,
      day: date.toLocaleDateString(undefined, { weekday: 'short' }),
      hour: date.getHours(),
      value: r.value,
      zone: normal ? zoneOf(r.value, normal) : ('normal' as Zone),
    };
  });
}

// Latest reading, change vs the previous reading, and recent sparkline.
export function getSnapshot(readings: Reading[], decimals: number) {
  if (!readings.length) return null;
  const latest = readings[readings.length - 1];
  const previous = readings[readings.length - 2];
  return {
    latest,
    delta: previous ? roundTo(latest.value - previous.value, decimals) : undefined,
    spark: readings.slice(-14).map(r => r.value),
  };
}

// Axis label for a timestamp at the given window granularity.
export function formatTick(t: number, window: TimeWindow) {
  const date = new Date(t);
  if (window === '24h') return date.toLocaleTimeString(undefined, { hour: 'numeric' });
  if (window === '7d') return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
