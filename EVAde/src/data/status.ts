import type { StatusDotVariant } from '@astryxdesign/core/StatusDot';

export type HealthStatus = 'nominal' | 'caution' | 'critical';
export type Zone = 'low' | 'normal' | 'high';
export type Range = readonly [number, number];

export interface StatusStyle {
  label: string;
  dot: StatusDotVariant;
  badge: 'success' | 'warning' | 'error';
  color: string;
}

export const STATUS_STYLES: Record<HealthStatus, StatusStyle> = {
  nominal: { label: 'Nominal', dot: 'success', badge: 'success', color: 'var(--color-success)' },
  caution: { label: 'Caution', dot: 'warning', badge: 'warning', color: 'var(--color-warning)' },
  critical: { label: 'Critical', dot: 'error', badge: 'error', color: 'var(--color-error)' },
};

export const ZONE_COLORS: Record<Zone, string> = {
  low: 'var(--color-info)',
  normal: 'var(--color-success)',
  high: 'var(--color-error)',
};

// Grades a reading against its normal and caution bands.
export function classify(value: number, normal: Range, caution: Range): HealthStatus {
  if (value >= normal[0] && value <= normal[1]) return 'nominal';
  if (value >= caution[0] && value <= caution[1]) return 'caution';
  return 'critical';
}

// Places a reading below, inside, or above its normal band.
export function zoneOf(value: number, normal: Range): Zone {
  if (value < normal[0]) return 'low';
  return value > normal[1] ? 'high' : 'normal';
}

// Returns the most severe of several statuses.
export function worstStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('critical')) return 'critical';
  return statuses.includes('caution') ? 'caution' : 'nominal';
}

// Status for a yes/no "is it in range" signal with no catalogue band.
export function statusFromScore(score: number): HealthStatus {
  return classify(score, [85, 100], [65, 100]);
}
