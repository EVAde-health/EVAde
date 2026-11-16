import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { useResource } from '../services/useResource';

export interface MetricModelMatch {
  id: string;
  name: string;
  task: string;
  runnable_from_reading: boolean;
  reason: string;
}

export interface MetricModelInfo {
  metric: string;
  label: string;
  matches: MetricModelMatch[];
  probability: number | null;
  note: string;
}

// Opens when a vital is selected. Shows a percent only when the API returns one from a real model run.
export default function MetricModelDialog({
  userId, metric, label, onClose,
}: { userId: string; metric: string; label: string; onClose: () => void }) {
  const info = useResource<MetricModelInfo>(`/users/${encodeURIComponent(userId)}/metric-models?metric=${encodeURIComponent(metric)}`);
  const probability = typeof info.data?.probability === 'number' ? info.data.probability : null;

  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="info" width={560}>
      <Layout>
        <DialogHeader title={label} subtitle="Adverse-event model" onOpenChange={open => { if (!open) onClose(); }} />
        <LayoutContent>
          <VStack gap={3}>
            {info.loading && <Text type="supporting">Checking Michael&apos;s model registry…</Text>}
            {info.error && <Text role="alert">{info.error}</Text>}
            {info.data && probability !== null && (
              <VStack gap={1}>
                <Heading level={3}>{Math.round(probability * 1000) / 10}%</Heading>
                <Text type="supporting">Chance reported by the model for this reading. See Model transparency for the artifact hash.</Text>
              </VStack>
            )}
            {info.data && probability === null && (
              <Text>{info.data.matches.length ? info.data.note : info.data.note}</Text>
            )}
            {info.data?.matches.map(match => (
              <VStack key={match.id} gap={1}>
                <Text type="label">{match.id} · {match.name}</Text>
                <Text type="supporting">{match.task}</Text>
                <Text type="supporting">{match.reason}</Text>
              </VStack>
            ))}
          </VStack>
        </LayoutContent>
        <LayoutFooter>
          <HStack hAlign="end" gap={2}>
            <Button label="Model transparency" href="/models" variant="secondary" />
            <Button label="Close" onClick={onClose} />
          </HStack>
        </LayoutFooter>
      </Layout>
    </Dialog>
  );
}
