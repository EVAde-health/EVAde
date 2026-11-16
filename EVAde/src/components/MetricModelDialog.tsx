import { useState } from 'react';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import ModelRunView from './ModelRunView';
import { useToast } from '../context/ToastCenterContext';
import { metricModelsPath, runModelFor, type MetricModelMatch, type MetricModelInfo, type ModelRunResult } from '../services/healthApi';
import { useResource } from '../services/useResource';

type EegScenario = 'calm' | 'seizure';

// Turns an unknown thrown value into a short message for the dialog.
function messageOf(error: unknown) {
  return error instanceof Error ? error.message : 'The model service did not answer.';
}

// One matched model: its task, the latest stored answer or a fresh run, and a Run now button.
function MatchSection({ userId, match, gatewayConnected, onRan }: {
  userId: string; match: MetricModelMatch; gatewayConnected: boolean; onRan: () => void;
}) {
  const [scenario, setScenario] = useState<EegScenario>('calm');
  const [fresh, setFresh] = useState<ModelRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useToast();
  const isEeg = match.id === 'EVA-2';
  const canRun = match.runnable && gatewayConnected;

  // Runs the model on the model service now and shows its answer.
  async function run() {
    setRunning(true);
    setError(null);
    try {
      const result = await runModelFor(userId, match.id, isEeg && scenario === 'seizure');
      setFresh(result);
      if (!result.ran) setError(result.headline);
      else showToast({ body: `${match.id} answered in ${result.latency_ms ?? '?'} ms.` });
      onRan();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setRunning(false);
    }
  }

  return (
    <VStack gap={2}>
      <VStack gap={0.5}>
        <Text type="label">{match.id} · {match.name}</Text>
        <Text type="supporting">{match.task}</Text>
        <Text type="supporting">{match.reason}</Text>
      </VStack>
      {fresh?.ran ? (
        <ModelRunView headline={fresh.headline} probabilities={fresh.probabilities} input={fresh.input}
          requestId={fresh.request_id} servedIds={fresh.served_model_ids} latencyMs={fresh.latency_ms} raw={fresh.output} />
      ) : match.latest ? (
        <ModelRunView headline={match.latest.headline} probabilities={match.latest.probabilities} input={match.latest.input}
          requestId={match.latest.request_id} ts={match.latest.ts} />
      ) : (
        <Text type="supporting">No run stored for this astronaut yet. Run it to get the model&apos;s answer.</Text>
      )}
      {error && <Text role="alert">{error}</Text>}
      <HStack gap={2} vAlign="center" wrap="wrap">
        {isEeg && (
          <SegmentedControl label="EEG scenario" value={scenario} onChange={value => setScenario(value as EegScenario)} size="sm">
            <SegmentedControlItem value="calm" label="Calm EEG" />
            <SegmentedControlItem value="seizure" label="Seizure-like EEG" />
          </SegmentedControl>
        )}
        <Button label={running ? 'Running…' : 'Run now'} size="sm" variant="secondary" onClick={run}
          isDisabled={!canRun || running} />
        {!gatewayConnected && <Text type="supporting">The model service is not connected right now.</Text>}
      </HStack>
    </VStack>
  );
}

// Opens when a vital is selected. Every percent shown is the output of one of Michael's models, never a UI guess.
export default function MetricModelDialog({
  userId, metric, label, onClose,
}: { userId: string; metric: string; label: string; onClose: () => void }) {
  const info = useResource<MetricModelInfo>(metricModelsPath(userId, metric));
  const matches = info.data?.matches ?? [];

  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="info" width={600}>
      <Layout>
        <DialogHeader title={label} subtitle="Adverse-event models" onOpenChange={open => { if (!open) onClose(); }} />
        <LayoutContent>
          <VStack gap={3}>
            {info.loading && !info.data && <Text type="supporting">Checking Michael&apos;s model registry…</Text>}
            {info.error && <Text role="alert">{info.error}</Text>}
            {info.data && <Text type="supporting">{info.data.note}</Text>}
            {matches.map((match, index) => (
              <VStack key={match.id} gap={3}>
                {index > 0 && <Divider />}
                <MatchSection userId={userId} match={match} gatewayConnected={info.data?.gateway_connected ?? false} onRan={info.reload} />
              </VStack>
            ))}
          </VStack>
        </LayoutContent>
        <LayoutFooter>
          <HStack hAlign="end" gap={2}>
            <Button label="How we verify the models" href="/models" variant="secondary" />
            <Button label="Close" onClick={onClose} />
          </HStack>
        </LayoutFooter>
      </Layout>
    </Dialog>
  );
}
