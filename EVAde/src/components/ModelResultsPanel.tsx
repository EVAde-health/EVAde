import { useEffect } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { CpuChipIcon } from '@heroicons/react/24/outline';
import { useMission } from '../context/MissionContext';
import { userPath } from '../services/api';
import { formatModelId } from '../services/modelCatalog';
import { usePoll } from '../hooks/usePoll';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';

const REFRESH_MS = 60 * 1000;

// One row of GET /users/:id/model-results (the Worker stores only real model output, never placeholders).
export interface ModelResultRow {
  id: number;
  endpoint: string;
  model_id: string | null;
  ts: string;
  output: string;
  flag: string | null;
  confidence: string | null;
  source: string | null;
}

// Short human label for each stored endpoint.
const MODEL_LABEL: Record<string, string> = {
  '/v1/predict/ecg': 'ECG rhythm (rules and beta model)',
  '/v1/predict/ecg-deep': 'Deep 12-lead ECG',
  '/v1/predict/eeg': 'EEG seizure-suspect flag',
  '/v1/predict/sleep-deep': 'Deep sleep staging',
  '/v1/predict/space-weather': 'Space weather forecast',
  '/v1/predict/radiation-risk': 'Radiation dose',
  '/v1/predict/risk': 'Overall risk score',
};

// Keeps the newest row per endpoint; the list is already ordered newest first.
function latestPerEndpoint(rows: ModelResultRow[] | undefined) {
  const seen = new Map<string, ModelResultRow>();
  for (const r of rows ?? []) if (!seen.has(r.endpoint)) seen.set(r.endpoint, r);
  return [...seen.values()];
}

// Pulls a readable headline out of the stored JSON without assuming its exact shape.
function headline(output: string) {
  try {
    const data = (JSON.parse(output) as { data?: Record<string, unknown> })?.data ?? {};
    const risk = data.risk as { r_disp?: number; band?: string } | undefined;
    if (risk?.band) return `risk ${risk.r_disp?.toFixed(2) ?? '—'} · ${risk.band}`;
    const seizure = data.seizure as { flag?: string | null; max_probability?: number } | undefined;
    if (seizure?.flag !== undefined) return `seizure ${seizure.flag ?? 'none'}`;
    const probs = (data.probabilities ?? data.class_probabilities) as Record<string, number> | undefined;
    if (probs) {
      const top = Object.entries(probs).sort((a, b) => b[1] - a[1])[0];
      if (top) return `top class ${top[0]} ${(top[1] * 100).toFixed(0)}%`;
    }
    const summary = data.summary as { sleep_efficiency?: number } | undefined;
    if (summary?.sleep_efficiency !== undefined) return `sleep efficiency ${(summary.sleep_efficiency * 100).toFixed(0)}%`;
    return null;
  } catch {
    return null;
  }
}

// Model outputs for the signed-in astronaut: what each model last said, with its label and source.
export default function ModelResultsPanel() {
  const { user } = useMission();
  const results = usePoll<ModelResultRow[]>(userPath(user.user_id, 'model-results'), REFRESH_MS);
  const rows = latestPerEndpoint(results.data);

  useEffect(() => {
    // Development only: each model result in the console, with its model ID and source.
    if (import.meta.env.DEV && results.data) {
      console.debug('[EVAde models]', latestPerEndpoint(results.data).map(r => ({
        endpoint: r.endpoint, model_id: r.model_id, source: r.source, flag: r.flag, ts: r.ts,
      })));
    }
  }, [results.data]);

  return (
    <PanelCard title="Model results" subtitle="Latest output from each model · flags for review, not diagnoses" icon={CpuChipIcon}>
      {rows.length === 0 ? (
        <NoReadings what="Model results" hint={results.loading ? 'Loading model results…' : 'Model results appear once a model has run for you.'} hasTutorialLink={false} />
      ) : (
        <VStack gap={1.5}>
          {rows.map(r => {
            const text = headline(r.output);
            return (
              <HStack key={r.id} gap={2} wrap="wrap" vAlign="center">
                <Text weight="semibold">{MODEL_LABEL[r.endpoint] ?? r.endpoint}</Text>
                {r.model_id && <Text type="supporting">{formatModelId(r.model_id)}</Text>}
                {text && <Text type="supporting" hasTabularNumbers>{text}</Text>}
                {r.source && <Text type="supporting">{r.source === 'simulated' ? 'simulated data' : r.source}</Text>}
                <Timestamp value={r.ts} />
              </HStack>
            );
          })}
          <Text type="supporting">Flags are for human review, not a diagnosis.</Text>
        </VStack>
      )}
    </PanelCard>
  );
}
