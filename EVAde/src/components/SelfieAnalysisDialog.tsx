import { Button } from '@astryxdesign/core/Button';
import { CodeBlock } from '@astryxdesign/core/CodeBlock';
import { Collapsible } from '@astryxdesign/core/Collapsible';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import type { HealthStatus } from '../data/status';
import type { ApiMedia, SignLevel } from '../services/healthApi';
import StatusBadge from './StatusBadge';
import './css/SelfieAnalysisDialog.css';

const SIGN_STATUS: Record<SignLevel, HealthStatus> = { none: 'nominal', mild: 'nominal', moderate: 'caution', marked: 'critical' };
const OBSERVATION_LABELS = [['eyes', 'Eyes'], ['expression', 'Expression'], ['posture', 'Posture'], ['skin', 'Skin']] as const;

// Capitalises the first letter of a model label for display.
function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Surgeon-facing pop-up: the selfie, the vision model's descriptive assessment, and what it would follow up on.
export default function SelfieAnalysisDialog({ photo, imageUrl, onClose }: { photo: ApiMedia; imageUrl?: string; onClose: () => void }) {
  const analysis = photo.analysis ?? null;
  const isOk = analysis?.status === 'ok';
  const observations = analysis?.observations ?? null;
  const modelName = analysis?.model ?? photo.analysis_model ?? 'No model recorded';

  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="info" width={560}>
      <Layout>
        <DialogHeader title="Selfie analysis" subtitle={`${new Date(photo.ts).toLocaleString()} · ${modelName}`}
          onOpenChange={open => { if (!open) onClose(); }} />
        <LayoutContent>
          <VStack gap={3}>
            {imageUrl && <img src={imageUrl} alt={photo.note || 'Astronaut selfie'} className="selfie-analysis__photo" />}
            {isOk && analysis ? (
              <VStack gap={3}>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="large" weight="semibold">{capitalise(analysis.mood ?? 'unclear')}</Text>
                  <Text type="supporting">
                    {analysis.confidence != null ? `${Math.round(analysis.confidence * 100)}% model confidence` : 'confidence not reported'}
                  </Text>
                </HStack>
                {(analysis.fatigue || analysis.stress) && (
                  <HStack gap={2} wrap="wrap">
                    {analysis.fatigue && <StatusBadge status={SIGN_STATUS[analysis.fatigue]} label={`Fatigue: ${analysis.fatigue}`} />}
                    {analysis.stress && <StatusBadge status={SIGN_STATUS[analysis.stress]} label={`Stress: ${analysis.stress}`} />}
                  </HStack>
                )}
                {analysis.explanation && <Text>{analysis.explanation}</Text>}
                {observations && (
                  <MetadataList title="What the model saw">
                    {OBSERVATION_LABELS.filter(([key]) => observations[key]).map(([key, label]) => (
                      <MetadataListItem key={key} label={label}>{observations[key]}</MetadataListItem>
                    ))}
                  </MetadataList>
                )}
                {analysis.follow_up && (
                  <VStack gap={0.5}>
                    <Text type="label">Suggested follow-up</Text>
                    <Text>{analysis.follow_up}</Text>
                  </VStack>
                )}
                <Text type="supporting">
                  A descriptive read of one photo by a general vision model, not a diagnosis. It never identifies the person.
                </Text>
              </VStack>
            ) : (
              <VStack gap={2}>
                <Text>
                  {analysis?.status === 'unparsed'
                    ? 'The vision model answered, but not in the structured format, so no mood was extracted. Its words are below.'
                    : analysis?.reason ?? 'This selfie has no assessment. The vision model was not available, and no mood was invented.'}
                </Text>
                {analysis?.raw && (
                  <Collapsible trigger="Model's raw reply" defaultIsOpen>
                    <CodeBlock code={analysis.raw} maxHeight={220} />
                  </Collapsible>
                )}
              </VStack>
            )}
          </VStack>
        </LayoutContent>
        <LayoutFooter>
          <HStack hAlign="end"><Button label="Close" onClick={onClose} /></HStack>
        </LayoutFooter>
      </Layout>
    </Dialog>
  );
}
