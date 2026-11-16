import { Badge } from '@astryxdesign/core/Badge';
import { Code } from '@astryxdesign/core/Code';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import type { ModelProbability } from '../services/healthApi';

export interface ModelRunViewProps {
  headline: string;
  probabilities: ModelProbability[];
  input: { source: string; description: string } | null;
  requestId?: string | null;
  servedIds?: string[];
  latencyMs?: number;
  ts?: string;
  ran?: boolean;
  raw?: unknown;
}

// Formats a 0-1 probability as a percent with one decimal.
function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

// One model's answer: headline, a bar per probability, what it was given, and proof it came from the model service.
export default function ModelRunView({ headline, probabilities, input, requestId, servedIds, latencyMs, ts, ran = true, raw }: ModelRunViewProps) {
  const isSimulated = input?.source === 'simulated waveform';

  return (
    <VStack gap={2}>
      <Text weight="semibold">{headline}</Text>
      {probabilities.length > 0 && (
        <VStack gap={1.5}>
          {probabilities.map(item => (
            <VStack key={item.label} gap={0.5}>
              <ProgressBar label={item.label} value={item.value * 100} hasValueLabel formatValueLabel={value => percent(value / 100)}
                variant="neutral" />
              {item.note && <Text type="supporting">{item.note}</Text>}
            </VStack>
          ))}
        </VStack>
      )}
      {input && (
        <HStack gap={1} vAlign="center" wrap="wrap">
          <Badge variant={isSimulated ? 'purple' : 'blue'} label={isSimulated ? 'Simulated input' : 'Live data'} />
          <Text type="supporting">{input.description}</Text>
        </HStack>
      )}
      {ran && (requestId || ts) && (
        <Text type="supporting">
          {servedIds?.length ? `Answered by ${servedIds.join(', ')} on evade-gateway` : 'Answered by evade-gateway'}
          {requestId && <> · request <Code>{requestId}</Code></>}
          {typeof latencyMs === 'number' && ` · ${latencyMs} ms`}
          {ts && <> · <Timestamp value={ts} format="relative" /></>}
        </Text>
      )}
      {raw !== undefined && raw !== null && (
        <Collapsible trigger="Raw model response" defaultIsOpen={false}>
          <CodeBlock code={JSON.stringify(raw, null, 2)} language="json" maxHeight={260} />
        </Collapsible>
      )}
    </VStack>
  );
}
