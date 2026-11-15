import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Grid } from '@astryxdesign/core/Grid';
import { Icon } from '@astryxdesign/core/Icon';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { HeartIcon, RocketLaunchIcon } from '@heroicons/react/24/solid';
import BrandMark from './BrandMark';
import './css/SpaceAppsFooter.css';

const EVENT_URL = 'https://www.spaceappschallenge.org/';

// 2026 Space Agency Partners as listed on spaceappschallenge.org.
const SPACE_AGENCY_PARTNERS = [
  'Angola · National Space Programme Management Office',
  'Argentina · CONAE',
  'Bahrain Space Agency',
  'Brazilian Space Agency',
  'Canadian Space Agency',
  'European Space Agency',
  'Indian Space Research Organisation',
  'Italian Space Agency',
  'Japan Aerospace Exploration Agency',
  'Korea AeroSpace Administration',
  'Nigeria · NASRDA',
  'Paraguayan Space Agency',
  'Senegalese Space Studies Agency',
  'Spanish Space Agency',
  'Turkish Space Agency',
  'UAE · Mohammed Bin Rashid Space Centre',
  'UK Space Agency',
];

const ROW_SPLIT = Math.ceil(SPACE_AGENCY_PARTNERS.length / 2);
const PARTNER_ROWS = [SPACE_AGENCY_PARTNERS.slice(0, ROW_SPLIT), SPACE_AGENCY_PARTNERS.slice(ROW_SPLIT)];

// Infinite drifting row of partner names; the duplicate half is aria-hidden.
function PartnerRow({ partners, isReversed }: { partners: string[]; isReversed?: boolean }) {
  return (
    <Stack className="space-footer__row" aria-hidden="true">
      <HStack gap={3} className={`space-footer__track ${isReversed ? 'space-footer__track--reverse' : ''}`}>
        {[...partners, ...partners].map((partner, i) => (
          <Text key={`${partner}-${i}`} type="label" className="space-footer__chip glass">{partner}</Text>
        ))}
      </HStack>
    </Stack>
  );
}

// Hackathon credits: event name, partner agencies and a thank-you.
export default function SpaceAppsFooter() {
  return (
    <VStack as="footer" gap={10} paddingBlock={10} className="space-footer">
      <VStack gap={4} hAlign="center" paddingInline={6} className="space-footer__thanks reveal-on-scroll">
        <HStack gap={2} vAlign="center" className="space-footer__badge glass">
          <Icon icon={RocketLaunchIcon} size="sm" color="accent" />
          <Text type="label">NASA International Space Apps Challenge 2026 · November 14–15</Text>
        </HStack>
        <Heading level={2} type="display-2" className="space-footer__title">
          Thank you to <Text type="inherit" className="text-gradient">NASA</Text> and every partner agency
        </Heading>
        <Text type="large" color="secondary" className="space-footer__lede">
          For opening your data, challenges and expertise to builders everywhere, and for giving our team
          a weekend to imagine how astronauts might care for themselves on the way to the Moon and Mars.
        </Text>
      </VStack>

      <VStack gap={3}>
        <Text type="label" color="secondary" className="space-footer__caption">2026 Space Agency Partners</Text>
        <VisuallyHidden>
          <ul>
            {SPACE_AGENCY_PARTNERS.map(partner => (
              <li key={partner}>{partner}</li>
            ))}
          </ul>
        </VisuallyHidden>
        {PARTNER_ROWS.map((row, i) => (
          <PartnerRow key={row[0]} partners={row} isReversed={i === 1} />
        ))}
      </VStack>

      <VStack paddingInline={6} className="space-footer__meta page">
        <Grid columns={{ minWidth: 240, max: 3 }} gap={6}>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center">
              <BrandMark size="sm" />
              <Text type="large" weight="bold">EVAde</Text>
            </HStack>
            <Text type="supporting">Astronaut health monitoring · Challenge entry, demo data only.</Text>
          </VStack>
          <VStack gap={2}>
            <Text type="label">The event</Text>
            <Text type="supporting">
              Space Apps is a global hackathon led by NASA with space agencies around the world. Learn more at{' '}
              <a href={EVENT_URL} target="_blank" rel="noreferrer" className="space-footer__link">spaceappschallenge.org</a>.
            </Text>
          </VStack>
          <VStack gap={2}>
            <HStack gap={1} vAlign="center">
              <Text type="label">Made with</Text>
              <Icon icon={HeartIcon} size="sm" color="pink" />
              <Text type="label">on Earth</Text>
            </HStack>
            <Text type="supporting">
              Independent team project. Not affiliated with or endorsed by NASA or any partner agency.
            </Text>
          </VStack>
        </Grid>
      </VStack>
    </VStack>
  );
}
