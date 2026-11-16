import { useState } from 'react';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HeartIcon } from '@heroicons/react/24/outline';
import { FACT_GROUPS, RESEARCH_FACTS, sourceHost, type FactGroup } from '../data/research';
import { stagger } from '../utils/style';
import EvidenceToken from './EvidenceToken';
import PanelCard from './PanelCard';
import './css/BodyFactsPanel.css';

type GroupFilter = FactGroup | 'all';

// Published effects of long missions on bone, sleep, heart, immunity and distance.
export default function BodyFactsPanel() {
  const [group, setGroup] = useState<GroupFilter>('all');
  const facts = RESEARCH_FACTS.filter(f => group === 'all' || f.group === group);

  return (
    <PanelCard title="The body in space" subtitle="What long missions do, from NASA and peer-reviewed studies" icon={HeartIcon}>
      <SegmentedControl label="Body system" value={group} onChange={v => setGroup(v as GroupFilter)} size="sm">
        <SegmentedControlItem value="all" label="All" />
        {FACT_GROUPS.map(g => (
          <SegmentedControlItem key={g.id} value={g.id} label={g.label} />
        ))}
      </SegmentedControl>
      <Grid columns={{ minWidth: 220, max: 4 }} gap={3}>
        {facts.map((fact, i) => (
          <VStack key={`${group}-${fact.id}`} gap={1} padding={4} className="body-facts__tile glass rise-in hover-lift" style={stagger(i)}>
            <HStack hAlign="between" vAlign="center" gap={2}>
              <Text type="display-3" hasTabularNumbers className="body-facts__value">{fact.value}</Text>
              <EvidenceToken evidence={fact.evidence} />
            </HStack>
            <Text weight="semibold">{fact.label}</Text>
            <Text type="supporting">{fact.detail}</Text>
            <Link href={fact.source} isExternalLink>{sourceHost(fact.source)}</Link>
          </VStack>
        ))}
      </Grid>
    </PanelCard>
  );
}
