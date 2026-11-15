import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { HealthDataContext, type HealthData } from '../context/HealthDataContext';
import { groupReadings, type Reading } from '../data/metrics';
import {
  fetchDashboard,
  fetchMetrics,
  fetchObservations,
  fetchRadiation,
  type DashboardSummary,
  type MetricDefinition,
  type RadiationHistory,
} from '../services/healthApi';

const HISTORY_DAYS = 35;
const RADIATION_DAYS = 400;

// Loads the metric catalogue, recent readings, alerts and dosimetry from D1 for the dashboard.
export default function HealthDataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [status, setStatus] = useState<HealthData['status']>('loading');
  const [defs, setDefs] = useState(new Map<string, MetricDefinition>());
  const [readings, setReadings] = useState(new Map<string, Reading[]>());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [radiation, setRadiation] = useState<RadiationHistory | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    Promise.all([
      fetchMetrics(options),
      fetchObservations(userId, HISTORY_DAYS, options),
      fetchDashboard(userId, options),
      fetchRadiation(userId, RADIATION_DAYS, options),
    ])
      .then(([metricRows, observations, dashboard, doses]) => {
        if (controller.signal.aborted) return;
        setDefs(new Map(metricRows.map(def => [def.metric, def])));
        setReadings(groupReadings(observations));
        setSummary(dashboard);
        setRadiation(doses);
        setUpdatedAt(Date.now());
        setStatus('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus(previous => (previous === 'ready' ? 'ready' : 'error'));
      });
    return () => controller.abort();
  }, [userId, revision]);

  // Fetches everything again (Refresh button).
  const reload = useCallback(() => setRevision(previous => previous + 1), []);

  const value = useMemo<HealthData>(
    () => ({ status, defs, readings, summary, radiation, updatedAt, reload }),
    [status, defs, readings, summary, radiation, updatedAt, reload],
  );

  return <HealthDataContext.Provider value={value}>{children}</HealthDataContext.Provider>;
}
