import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { api } from '../services/api';
import { useResource } from '../services/useResource';
import PageHeader from '../components/PageHeader';

interface CatalogModel {
  id: string;
  type: string;
  name: string;
  task: string;
  status: string;
  served_as: string | null;
  weights: string;
  inputs: string;
  runnable_here: string;
  why: string;
  michael: boolean;
}

interface Transparency {
  catalog: CatalogModel[];
  catalog_sha256: string;
  catalog_note: string;
  vision: { model: string; binding: boolean; note: string };
  gateway: { status: number; body: unknown };
}

interface RunResult {
  id: string;
  ran: boolean;
  latency_ms: number;
  input: unknown;
  output: unknown;
  model_sha256: string | null;
  http_status?: number;
  weights?: string;
}

// Lists every registered model, the hash of the catalog that was loaded, and a live run that shows raw input and output.
export default function ModelsPage() {
  const data = useResource<Transparency>('/model-transparency');
  const [runs, setRuns] = useState<Record<string, RunResult | { error: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function run(id: string) {
    setBusy(id);
    try {
      const result = await api<RunResult>('/model-transparency/run', { method: 'POST', body: { id } });
      setRuns(current => ({ ...current, [id]: result }));
    } catch (error) {
      setRuns(current => ({ ...current, [id]: { error: error instanceof Error ? error.message : 'The model run failed.' } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <VStack gap={5} padding={6}>
      <PageHeader title="Model transparency" description="What is loaded, which hash the catalog has, and what a live run returns." />
      {data.loading && <Text type="supporting">Loading the model catalog…</Text>}
      {data.error && <Text role="alert">{data.error}</Text>}
      {data.data && (
        <VStack gap={4}>
          <Card padding={4}>
            <VStack gap={2}>
              <Text type="label">Catalog document SHA-256</Text>
              <Text>{data.data.catalog_sha256}</Text>
              <Text type="supporting">{data.data.catalog_note}</Text>
              <Text type="supporting">{data.data.vision.note} Model: {data.data.vision.model}. Binding: {data.data.vision.binding ? 'present' : 'not bound'}.</Text>
              <Text type="supporting">Gateway status {data.data.gateway.status}. A 503 means the weight files were not loaded, so no prediction was made.</Text>
            </VStack>
          </Card>
          {data.data.catalog.map(model => {
            const result = runs[model.id];
            return (
              <Card key={model.id} padding={4}>
                <VStack gap={2}>
                  <HStack hAlign="between" wrap="wrap" gap={2}>
                    <VStack gap={0.5}>
                      <Heading level={3}>{model.id} · {model.name}</Heading>
                      <Text type="supporting">{model.type} · {model.status} · {model.michael ? 'Michael' : 'other'}</Text>
                    </VStack>
                    <Button label={busy === model.id ? 'Running…' : 'Run this model'} onClick={() => run(model.id)} isDisabled={busy === model.id} />
                  </HStack>
                  <Text>{model.task}</Text>
                  <Text type="supporting">Inputs: {model.inputs}</Text>
                  <Text type="supporting">Weights: {model.weights}</Text>
                  <Text type="supporting">Where it runs: {model.runnable_here}{model.served_as ? ` · ${model.served_as}` : ''}</Text>
                  <Text type="supporting">{model.why}</Text>
                  {result && 'error' in result && <Text role="alert">{result.error}</Text>}
                  {result && !('error' in result) && (
                    <VStack gap={1}>
                      <Text type="label">{result.ran ? 'Raw run' : 'Not run'} · {result.latency_ms} ms{result.model_sha256 ? ` · sha256 ${result.model_sha256}` : ' · no weight hash returned'}</Text>
                      <Text>{JSON.stringify({ input: result.input, output: result.output })}</Text>
                    </VStack>
                  )}
                </VStack>
              </Card>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}
