import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';

const MODELS = [
  { kind: 'ecg-deep', task: 'ecg_deep', label: 'Deep 12-lead ECG', confidence: 'top class probability' },
  { kind: 'sleep-deep', task: 'sleep_deep', label: 'Deep sleep staging', confidence: 'mean stage probability' },
] as const;
const STAGES = ['W', 'N1', 'N2', 'N3', 'REM'] as const;

type RecordedResult = {
  status: 'result';
  model_id: string | null;
  flag: string | null;
  confidence: string | null;
  ts: string;
  source: string;
  minutes_per_stage: Partial<Record<(typeof STAGES)[number], number | null>> | null;
};
export type StaffDeepModelResults = Record<(typeof MODELS)[number]['kind'], RecordedResult | { status: 'placeholder' } | null>;
export type DeepModelCatalog = { data?: { deep_models?: { task: string; state: string; source: string }[] } };

function formatConfidence(value: string | null) {
  if (!value?.trim()) return 'Not reported';
  const probability = Number(value);
  return probability >= 0 && probability <= 1
    ? new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(probability)
    : value;
}

export default function DeepModelResults({ results, catalog }: { results: StaffDeepModelResults; catalog?: DeepModelCatalog }) {
  return (
    <Card padding={4}>
      <VStack gap={4}>
        <VStack gap={1}>
          <Heading level={3}>Deep model results</Heading>
          <Text type="supporting">Flag for human review, not a diagnosis</Text>
        </VStack>
        {MODELS.map(model => {
          const result = results[model.kind];
          const placeholder = result?.status === 'placeholder' || (!result &&
            catalog?.data?.deep_models?.some(entry => entry.task === model.task && (entry.state === 'mock' || entry.source === 'mock')));
          return (
            <VStack gap={1} key={model.kind}>
              <HStack gap={2} wrap="wrap" vAlign="center">
                <Heading level={4}>{model.label}</Heading>
                {result?.status === 'result' && result.source === 'simulated' && <Badge variant="purple" label="Simulated" />}
              </HStack>
              {placeholder ? <Text type="supporting">placeholder</Text> :
                result?.status === 'result' ? (
                  <>
                    <Text type="supporting">Model ID {result.model_id ?? 'Not reported'} · <Timestamp value={result.ts} /></Text>
                    <Text type="supporting">Flag {result.flag ?? 'Not reported'}</Text>
                    <Text type="supporting">Confidence ({model.confidence}) {formatConfidence(result.confidence)}</Text>
                    {model.kind === 'sleep-deep' && result.minutes_per_stage && (
                      <VStack gap={1}>
                        <Text type="supporting">Stage breakdown (submitted epochs)</Text>
                        <HStack gap={2} wrap="wrap">
                          {STAGES.map(stage => {
                            const minutes = result.minutes_per_stage?.[stage];
                            return <Text key={stage} type="supporting">{stage} {minutes == null ? 'Unavailable' : `${minutes.toFixed(1)} min`}</Text>;
                          })}
                        </HStack>
                      </VStack>
                    )}
                  </>
                ) : <Text type="supporting">No result yet</Text>}
            </VStack>
          );
        })}
      </VStack>
    </Card>
  );
}
