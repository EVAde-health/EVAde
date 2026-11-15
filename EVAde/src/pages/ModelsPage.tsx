import { useEffect, useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Link } from '@astryxdesign/core/Link';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import PageHeader from '../components/PageHeader';
import { citations } from '../data/bibliography';
import { modelRegistry, modelRegistryUrl } from '../data/modelRegistry';
import { api } from '../services/api';
import { formatModelId, isModelPlaceholder, type ModelCatalog } from '../services/modelCatalog';
import { useResource } from '../services/useResource';

type CatalogCheck = { data: ModelCatalog['data']; checkedAt: string };
type ModelRuns = {
  scope: 'staff' | 'demo' | 'personal';
  models: { model_id: string; last_run: string | null }[];
};
const RUN_SCOPE = { staff: 'all accounts', demo: 'demo crew', personal: 'your account' };

export function ModelsContent({ catalog, runs, runsError }: { catalog?: CatalogCheck; runs?: ModelRuns; runsError?: boolean }) {
  const live = catalog?.data;
  const label = live ? 'Model API reachable' : catalog ? 'Model API unavailable' : 'Checking model API';
  const loaded = new Set([
    ...live?.models?.filter(entry => entry.available === true && !isModelPlaceholder(entry)) ?? [],
    ...live?.deep_models?.filter(entry => entry.state === 'available' && !isModelPlaceholder(entry)) ?? [],
  ].map(entry => entry.model_id));
  const mocks = [...live?.models ?? [], ...live?.deep_models ?? [], ...live?.unavailable ?? []].filter(isModelPlaceholder);
  const unavailable = new Set([
    ...live?.unavailable ?? [],
    ...live?.deep_models?.filter(entry => entry.state === 'unavailable') ?? [],
  ].map(entry => entry.model_id));
  const lastRuns = new Map(runs?.models.map(row => [row.model_id, row.last_run]));

  return (
    <VStack gap={5} padding={6} className="page">
      <PageHeader title="Models" description="Training evidence and live availability for every EVAde model and architecture."
        actions={<><Link href={modelRegistryUrl} isExternalLink>GitHub model registry</Link><Link href="/bibliography">Bibliography</Link></>} />
      <HStack vAlign="center" gap={2} wrap="wrap" role="status">
        <StatusDot variant={live ? 'success' : catalog ? 'warning' : 'neutral'} label={label} />
        <Text>{label}</Text>
        {catalog && <Text type="supporting">Last checked <Timestamp value={catalog.checkedAt} /></Text>}
      </HStack>
      <Grid columns={{ minWidth: 290, max: 3 }} gap={4}>
        {modelRegistry.map(model => {
          const id = formatModelId(model.id);
          const serving = loaded.has(model.id);
          const placeholder = !serving && mocks.some(entry => entry.model_id === model.id ||
            (model.placeholderTask !== undefined && entry.task === model.placeholderTask));
          const lastRun = lastRuns.get(model.id);
          const references = model.citations.map(key => citations.get(key)).filter(entry => entry !== undefined)
            .sort((a, b) => a.number - b.number);
          return (
            <Card key={model.id} padding={4}>
              <VStack as="article" gap={3} aria-labelledby={`model-${id}`}>
                <VStack gap={1}>
                  <Text type="label" color="accent">{id}</Text>
                  <Heading id={`model-${id}`} level={2}>{model.name}</Heading>
                  <HStack gap={1} wrap="wrap">
                    {model.type === 'architecture' && <Badge variant="blue" label="Architecture spec" />}
                    {serving && <Badge variant="success" label={'ON \u2014 serving'} />}
                    {model.type === 'model' && live && !serving && <Badge variant="neutral" label="Developed, not served" />}
                    {model.type === 'model' && !live && <Badge variant="neutral" label="Serving status unknown" />}
                    {placeholder && <Badge variant="warning" label="Placeholder" />}
                    {model.metric && <Badge variant="teal" label="Evaluated" />}
                  </HStack>
                </VStack>
                <VStack gap={2}>
                  <ModelFact label="Type">{model.type === 'architecture' ? 'Architecture' : 'Trained model'}</ModelFact>
                  <ModelFact label="Parent architecture">{model.parent ? formatModelId(model.parent) : 'None registered'}</ModelFact>
                  <ModelFact label="Task">{formatModelId(model.task)}</ModelFact>
                  <ModelFact label="Input">{model.input}</ModelFact>
                  <ModelFact label="Data">{model.data ? formatModelId(model.data) : 'Not specified in the registry'}</ModelFact>
                  <ModelFact label="Split">{model.split ? formatModelId(model.split) : 'Not specified in the registry'}</ModelFact>
                  <ModelFact label="Evaluation">{model.evaluation ? formatModelId(model.evaluation) : 'Not evaluated'}</ModelFact>
                  <ModelFact label="Headline metric">
                    {model.metric ? formatModelId(model.metric) : 'Not reported'}
                    {model.metric && !model.hasHeadlineInterval && ' (headline 95% CI not reported)'}
                  </ModelFact>
                  {model.note && <Text type="supporting">{formatModelId(model.note)}</Text>}
                  {!serving && !placeholder && unavailable.has(model.id) &&
                    <Text type="supporting">The live API lists this model as unavailable.</Text>}
                  <Text type="supporting"><time dateTime={model.created}>{model.created}</time>{' · '}
                    <Link href={`https://github.com/Mikeblackbelt/EVAde-backend-models/commit/${model.commit.split(' ')[0]}`} isExternalLink>
                      {model.commit.split(' ')[0]}
                    </Link>
                  </Text>
                  {serving && <Text type="supporting">Last run{runs ? ` (${RUN_SCOPE[runs.scope]})` : ''}{' '}
                    {lastRun ? <Timestamp value={lastRun} /> : runsError ? 'unavailable' : runs ? 'not recorded' : 'loading…'}
                  </Text>}
                  <Text type="supporting">Data and methods [{references.map((citation, i) => (
                    <Link key={citation.key} href={`/bibliography#ref-${citation.number}`} aria-label={`Reference ${citation.number}: ${citation.title}`}>
                      {citation.number}{i === references.length - 1 ? '' : ', '}
                    </Link>
                  ))}]</Text>
                </VStack>
              </VStack>
            </Card>
          );
        })}
      </Grid>
      <VStack gap={1}>
        <Text>Every output is a flag for human review, not a diagnosis.</Text>
        <Text type="supporting">IDs are shown zero-padded; the registry writes them as EVA-n.</Text>
      </VStack>
    </VStack>
  );
}

function ModelFact({ label, children }: { label: string; children: React.ReactNode }) {
  return <VStack gap={0.5}><Text type="label">{label}</Text><Text type="supporting">{children}</Text></VStack>;
}

export default function ModelsPage() {
  const [catalog, setCatalog] = useState<CatalogCheck>();
  const runs = useResource<ModelRuns>('/models/runs');
  useEffect(() => {
    const controller = new AbortController();
    const update = (data: ModelCatalog['data']) => {
      if (!controller.signal.aborted) setCatalog({ data, checkedAt: new Date().toISOString() });
    };
    api<ModelCatalog>('/models', { signal: controller.signal })
      .then(response => update(Array.isArray(response?.data?.models) && Array.isArray(response?.data?.deep_models)
        ? response.data : undefined), () => update(undefined));
    return () => controller.abort();
  }, []);
  return <ModelsContent catalog={catalog} runs={runs.data} runsError={Boolean(runs.error)} />;
}
