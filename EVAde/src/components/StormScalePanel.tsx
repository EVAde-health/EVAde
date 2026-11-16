import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import { BoltIcon } from '@heroicons/react/24/outline';
import { usePoll } from '../hooks/usePoll';
import { STORM_CASES, STORM_LEVELS, STORM_SCALE_SOURCE, SOLAR_EVENT_LIMIT_MSV, stormLevelFor } from '../data/research';
import { SPACE_WEATHER_LATEST, type SpaceWeatherRow } from '../services/healthApi';
import EvidenceToken from './EvidenceToken';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';
import './css/StormScalePanel.css';

const REFRESH_MS = 5 * 60 * 1000;

// Proton threshold as a readable pfu figure.
function thresholdLabel(pfu: number) {
  return pfu === 0 ? 'below 10 pfu' : `≥ ${pfu.toLocaleString()} pfu`;
}

// NOAA S-scale with today's live level marked, plus real storm case studies.
export default function StormScalePanel() {
  const latest = usePoll<SpaceWeatherRow | null>(SPACE_WEATHER_LATEST, REFRESH_MS);
  const row = latest.data ?? null;
  const current = row ? stormLevelFor(row.storm_level, row.proton_flux_10mev).level : null;

  return (
    <PanelCard title="NOAA storm scale" subtitle={`NOAA S-scale · NASA allows ${SOLAR_EVENT_LIMIT_MSV} mSv per event`} icon={BoltIcon}>
      <List hasDividers edge="flush">
        {STORM_LEVELS.map(level => (
          <ListItem
            key={level.level}
            isSelected={level.level === current}
            label={`${level.level} · ${level.name}`}
            description={level.pfu === 0 ? 'Protons ≥10 MeV below 10 pfu · most days' : `${thresholdLabel(level.pfu)} protons ≥10 MeV · ${level.perCycle} per 11-year cycle`}
            endContent={
              <HStack gap={2} vAlign="center">
                {level.level === current && <Text type="label" color="accent">Now</Text>}
                <StatusBadge status={level.status} />
              </HStack>
            }
          />
        ))}
      </List>
      <Grid columns={{ minWidth: 200, max: 2 }} gap={3}>
        {STORM_CASES.map(c => (
          <VStack key={c.id} gap={1} padding={3} className="storm-panel__case glass hover-lift">
            <HStack gap={2} vAlign="center" hAlign="between">
              <Text type="label" color="secondary">{c.title}</Text>
              <EvidenceToken evidence={c.evidence} />
            </HStack>
            <Text type="large" weight="semibold" hasTabularNumbers>{c.value}</Text>
            <Text type="supporting">{c.detail}</Text>
            <Link href={c.source} isExternalLink>Source</Link>
          </VStack>
        ))}
      </Grid>
      <Text type="supporting"><Link href={STORM_SCALE_SOURCE} isExternalLink>About the NOAA solar radiation storm scale</Link></Text>
    </PanelCard>
  );
}
