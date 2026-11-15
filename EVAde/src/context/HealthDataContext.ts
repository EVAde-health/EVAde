import { createContext, useContext } from 'react';
import type { Reading } from '../data/metrics';
import type { DashboardSummary, MetricDefinition, RadiationHistory } from '../services/healthApi';

export interface HealthData {
  status: 'loading' | 'ready' | 'error';
  defs: Map<string, MetricDefinition>;
  readings: Map<string, Reading[]>;
  summary: DashboardSummary | null;
  radiation: RadiationHistory | null;
  updatedAt: number | null;
  reload: () => void;
}

export const HealthDataContext = createContext<HealthData | null>(null);

// Reads the dashboard's health data; must be used under HealthDataProvider.
export function useHealthData() {
  const value = useContext(HealthDataContext);
  if (!value) throw new Error('useHealthData must be used inside HealthDataProvider');
  return value;
}

// Readings for one metric, oldest first (empty when none recorded).
export function useReadings(metric: string) {
  return useHealthData().readings.get(metric) ?? [];
}
