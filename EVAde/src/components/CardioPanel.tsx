import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { HeartIcon } from '@heroicons/react/24/outline';
import { CARDIO_EVENTS } from '../data/mission';
import { worstStatus } from '../data/status';
import EcgLine from './EcgLine';
import ImmunePanel from './ImmunePanel';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';
import './css/CardioPanel.css';

// Live ECG strip, ML-detected cardiac events, and immune markers.
export default function CardioPanel() {
  const status = worstStatus(CARDIO_EVENTS.slice(0, 2).map(e => e.status));

  return (
    <PanelCard title="Cardiovascular & immune" subtitle="ECG model events · weekly blood panel" icon={HeartIcon} status={status}>
      <VStack gap={1} className="cardio-panel__strip">
        <HStack hAlign="between">
          <Text type="label">Live ECG · lead II</Text>
          <Text type="supporting">Sinus rhythm</Text>
        </HStack>
        <EcgLine speed="normal" />
      </VStack>
      <List density="compact" hasDividers edge="flush">
        {CARDIO_EVENTS.map(event => (
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
      <ImmunePanel />
    </PanelCard>
  );
}
