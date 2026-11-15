import { useState } from 'react';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { Slider } from '@astryxdesign/core/Slider';
import { Token } from '@astryxdesign/core/Token';
import { List, ListItem } from '@astryxdesign/core/List';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import { MISSION_EVENTS, MISSION_LENGTH_DAYS, sourceHost } from '../data/research';
import PanelCard from './PanelCard';

const LAST_EVENT_DAY = Math.max(MISSION_LENGTH_DAYS, ...MISSION_EVENTS.map(e => e.day));

const ACRONYMS = new Set(['eeg', 'ecg', 'hrv']);

// Sentence-case label from a snake_case event type, keeping acronyms.
function eventTitle(type: string) {
  const words = type.split('_').map(w => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const title = words.join(' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// What research says happens to the body, day by day, on a long mission.
export default function MissionTimelinePanel() {
  const [day, setDay] = useState<number>(MISSION_LENGTH_DAYS);
  const events = MISSION_EVENTS.filter(e => e.day <= day);

  return (
    <PanelCard title="A long mission, day by day" subtitle="When published studies see each change appear" icon={CalendarDaysIcon}>
      <Slider
        label="Mission day"
        value={day}
        onChange={(value: number) => setDay(value)}
        min={0}
        max={LAST_EVENT_DAY}
        step={1}
        valueDisplay="text"
        formatValue={value => `Day ${value}`}
      />
      <Text type="supporting">{events.length} of {MISSION_EVENTS.length} research milestones reached by day {day}.</Text>
      <List hasDividers edge="flush">
        {events.map(e => (
          <ListItem
            key={`${e.day}-${e.type}`}
            align="first-line"
            startContent={<Token label={`Day ${e.day}`} color="purple" size="sm" />}
            label={<Text weight="semibold">{eventTitle(e.type)}</Text>}
            description={
              <VStack gap={0.5}>
                <Text type="supporting">{e.description}</Text>
                <HStack gap={2} wrap="wrap">
                  <Text type="supporting">Evidence: {e.evidence}</Text>
                  <Link href={e.source} isExternalLink>{sourceHost(e.source)}</Link>
                </HStack>
              </VStack>
            }
          />
        ))}
      </List>
    </PanelCard>
  );
}
