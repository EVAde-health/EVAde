import { Badge } from '@astryxdesign/core/Badge';
import { Link } from '@astryxdesign/core/Link';
import { VStack } from '@astryxdesign/core/Stack';
import { Step, Stepper } from '@astryxdesign/core/Stepper';
import { Heading, Text } from '@astryxdesign/core/Text';
import PageHeader from '../components/PageHeader';
import { roadmap, roadmapGroups, type ReleaseStatus } from '../data/roadmap';
import { formatModelId } from '../services/modelCatalog';

const statusVariant = {
  Shipped: 'success',
  'In progress': 'info',
  Planned: 'blue',
  Research: 'purple',
} as const satisfies Record<ReleaseStatus, string>;

export default function RoadmapPage() {
  return (
    <VStack gap={5} padding={6} className="page">
      <PageHeader title="Roadmap" description="Future release labels and windows are a team proposal."
        actions={<Link href="/models">Models</Link>} />
      <Stepper activeStep={0} orientation="vertical" indicatorPosition="on-track" label="Release timeline">
        {roadmap.map((release, index) => (
          <Step key={release.version} step={index} label={release.version} description={release.window}
            endContent={<Badge variant={statusVariant[release.status]} label={release.status} />}>
            <VStack gap={3} paddingBlock={2} as="section" aria-label={`${release.version} ${release.title}`}>
              <Heading level={2}>{release.title}</Heading>
              {roadmapGroups.map(group => {
                const items = release.groups[group];
                if (!items?.length) return null;
                return (
                  <VStack key={group} gap={1}>
                    <Heading level={3}>{group}</Heading>
                    <VStack as="ul" gap={1}>
                      {items.map(({ text, source }) => (
                        <li key={text}>
                          <Text>
                            {formatModelId(text)}{' '}
                            {source === 'team proposal' ? <Text type="inherit" color="secondary">[team proposal]</Text> : (
                              <Link href={source.href} isExternalLink>{source.label}</Link>
                            )}
                          </Text>
                        </li>
                      ))}
                    </VStack>
                  </VStack>
                );
              })}
            </VStack>
          </Step>
        ))}
      </Stepper>
      <VStack as="footer">
        <Text type="supporting">Planned work, not commitments. Every model output stays a flag for human review, not a diagnosis.</Text>
      </VStack>
    </VStack>
  );
}
