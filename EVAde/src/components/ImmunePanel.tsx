import { List, ListItem } from '@astryxdesign/core/List';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { Icon } from '@astryxdesign/core/Icon';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { immuneMarkers, type ImmuneMarker } from '../data/health';
import { STATUS_STYLES, worstStatus } from '../data/status';
import NoReadings from './NoReadings';
import './css/ImmunePanel.css';

// Converts a marker value into a percentage along its scale.
function percentOf(value: number, marker: ImmuneMarker) {
  return `${Math.min(100, Math.max(0, (value / marker.scaleMax) * 100))}%`;
}

// Bullet bar: normal band with a marker for the current value.
function BulletBar({ marker }: { marker: ImmuneMarker }) {
  return (
    <HStack className="immune-bullet" role="img" aria-label={`${marker.value} ${marker.unit}, normal ${marker.normal[0]} to ${marker.normal[1]}`}>
      <HStack
        className="immune-bullet__band"
        style={{ insetInlineStart: percentOf(marker.normal[0], marker), inlineSize: `calc(${percentOf(marker.normal[1], marker)} - ${percentOf(marker.normal[0], marker)})` }}
      />
      <HStack className="immune-bullet__value" style={{ insetInlineStart: percentOf(marker.value, marker), background: STATUS_STYLES[marker.status].color }} />
    </HStack>
  );
}

// Latest immune panel markers as rows with range bullets.
export default function ImmunePanel() {
  const { defs, readings } = useHealthData();
  const markers = immuneMarkers(defs, readings);
  const status = markers.length ? worstStatus(markers.map(m => m.status)) : null;
  const drawnAt = markers.length ? Math.max(...markers.map(m => m.t)) : null;

  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Icon icon={SparklesIcon} size="sm" color="pink" />
        <Text type="label">Immune panel</Text>
        {drawnAt && <Timestamp value={drawnAt} />}
        {status && <StatusDot variant={STATUS_STYLES[status].dot} label={STATUS_STYLES[status].label} tooltip={STATUS_STYLES[status].label} />}
      </HStack>
      {markers.length ? (
        <List density="compact" hasDividers edge="flush">
          {markers.map(marker => (
            <ListItem
              key={marker.id}
              label={marker.label}
              description={<BulletBar marker={marker} />}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Text type="label" hasTabularNumbers>{marker.value}</Text>
                  <Text type="supporting">{marker.unit}</Text>
                  <StatusDot variant={STATUS_STYLES[marker.status].dot} label={STATUS_STYLES[marker.status].label} tooltip={STATUS_STYLES[marker.status].label} />
                </HStack>
              }
            />
          ))}
        </List>
      ) : (
        <NoReadings what="Immune markers" hint="White cells, lymphocytes, IL-6, CRP and EBV appear after your weekly blood draw." />
      )}
    </VStack>
  );
}
