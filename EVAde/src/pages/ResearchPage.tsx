import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Link } from '@astryxdesign/core/Link';
import { List, ListItem } from '@astryxdesign/core/List';
import BodyFactsPanel from '../components/BodyFactsPanel';
import DoseComparisonPanel from '../components/DoseComparisonPanel';
import MissionTimelinePanel from '../components/MissionTimelinePanel';
import PageHeader from '../components/PageHeader';
import SectionTitle from '../components/SectionTitle';
import SpaceWeatherPanel from '../components/SpaceWeatherPanel';
import StormScalePanel from '../components/StormScalePanel';
import { RESEARCH_SOURCES, sourceHost, type ResearchSource } from '../data/research';
import './css/ResearchPage.css';

const TOPICS: ResearchSource['topic'][] = ['Radiation', 'Space weather', 'Body', 'Mission'];

// NASA research behind EVAde: radiation, solar storms, the body and sources.
export default function ResearchPage() {
  return (
    <VStack gap={8} padding={6} className="page research">
      <PageHeader
        eyebrow="NASA research"
        title={<>What spaceflight does to <Text type="inherit" className="text-gradient">the human body</Text></>}
        description="The published numbers EVAde is built on. Every value links to its source and says how it was measured."
      />

      <VStack gap={4}>
        <SectionTitle title="Radiation" caption="Dose rates by destination and how fast a mission uses up NASA’s career limit" />
        <Grid columns={{ minWidth: 380, max: 2 }} gap={4}>
          <DoseComparisonPanel />
          <SpaceWeatherPanel />
        </Grid>
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Solar storms" caption="The spikes on top of the daily dose, and what shielding does" />
        <StormScalePanel />
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="The body" caption="Bone, muscle, sleep, heart and immune changes on long missions" />
        <BodyFactsPanel />
        <MissionTimelinePanel />
      </VStack>

      <VStack gap={4}>
        <SectionTitle title="Sources" caption="Open any study to check a number" />
        <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
          {TOPICS.map(topic => (
            <Card key={topic} padding={4} className="research__sources reveal-on-scroll">
              <VStack gap={2}>
                <Heading level={3}>{topic}</Heading>
                <List hasDividers edge="flush">
                  {RESEARCH_SOURCES.filter(s => s.topic === topic).map(s => (
                    <ListItem key={s.url} label={<Link href={s.url} isExternalLink>{s.title}</Link>} description={sourceHost(s.url)} />
                  ))}
                </List>
              </VStack>
            </Card>
          ))}
        </Grid>
        <Text type="supporting">Reference values describe crews in published studies, not you. Your own readings stay on the dashboard.</Text>
      </VStack>
    </VStack>
  );
}
