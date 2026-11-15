import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { HeartIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { cardioEvents } from '../data/health';
import type { Reading } from '../data/metrics';
import { worstStatus } from '../data/status';
import EcgLine from './EcgLine';
import ImmunePanel from './ImmunePanel';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';
import './css/CardioPanel.css';

// Rhythm label from the latest ECG irregular-time reading.
function rhythmLabel(irregular: Reading[] | undefined) {
  if (!irregular?.length) return 'Awaiting ECG session';
  return irregular[irregular.length - 1].value <= 1 ? 'Sinus rhythm' : 'Irregular rhythm flagged';
}

// ECG strip, cardiac alerts from the Worker, and immune markers.
export default function CardioPanel() {
  const { summary, defs, readings } = useHealthData();
  const events = cardioEvents(summary?.alerts ?? [], defs);
  const status = events.length ? worstStatus(events.slice(0, 3).map(e => e.status)) : undefined;

  return (
    <PanelCard logMetric="crp" title="Cardiovascular & immune" subtitle="Cardiac alerts · weekly blood panel" icon={HeartIcon} status={status}>
      <VStack gap={1} className="cardio-panel__strip">
        <HStack hAlign="between">
          <Text type="label">ECG · lead II</Text>
          <Text type="supporting">{rhythmLabel(readings.get('ecg_irregular_pct'))}</Text>
        </HStack>
        <EcgLine speed="normal" />
      </VStack>
      {events.length ? (
        <List density="compact" hasDividers edge="flush">
          {events.map(event => (
            <ListItem
              key={event.id}
              label={event.title}
              description={
                <HStack gap={1} wrap="wrap">
                  <Text type="supporting">{event.detail} ·</Text>
                  <Timestamp value={event.t} />
                </HStack>
              }
              endContent={<StatusBadge status={event.status} />}
            />
          ))}
        </List>
      ) : (
        <Text type="supporting">No open cardiac alerts.</Text>
      )}
      <ImmunePanel />
    </PanelCard>
  );
}
