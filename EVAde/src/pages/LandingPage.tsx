import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { Token } from '@astryxdesign/core/Token';
import {
  ArrowRightIcon,
  BookOpenIcon,
  CameraIcon,
  ChartBarSquareIcon,
  PlayCircleIcon,
  RocketLaunchIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import DecodeText from '../components/DecodeText';
import NebulaCanvas from '../components/NebulaCanvas';
import OrbitalHud from '../components/OrbitalHud';
import StatCounter from '../components/StatCounter';
import ThemeToggle from '../components/ThemeToggle';
import { stagger } from '../utils/style';
import './css/LandingPage.css';

const SIGNALS = [
  'Heart rate', 'Blood pressure', 'Blood glucose', 'Body temperature', 'Sleep hours', 'Mood',
  'Behavioral health', 'Radiation dose', 'Bone density', 'Immune markers', 'Cardiovascular events', 'Nutrition',
];

const PILLARS = [
  { icon: ChartBarSquareIcon, color: 'blue', title: 'Live health dashboard', body: 'Every signal color-coded against safe ranges, with trend, range, distribution and daily-rhythm views.', href: '/dashboard' },
  { icon: PlayCircleIcon, color: 'pink', title: 'Self-measurement tutorials', body: 'Short guided videos so crew can take clinical-grade readings without a flight surgeon on board.', href: '/tutorials' },
  { icon: TrophyIcon, color: 'orange', title: 'Gamified daily missions', body: 'Protocols and basics earn XP, streaks and ranks — healthy habits that survive six months in orbit.', href: '/tasks' },
  { icon: BookOpenIcon, color: 'purple', title: 'Journal & AI companion', body: 'A private space to reflect, with an assistant that will learn to spot behavioral-health trends.', href: '/journal' },
  { icon: CameraIcon, color: 'teal', title: 'Selfie check-ins', body: 'Daily photos to track facial fluid shift, fatigue and wellbeing over the mission.', href: '/selfies' },
] as const;

// Marketing landing page with the animated orbital hero.
export default function LandingPage() {
  return (
    <VStack className="landing">
      <Stack as="section" className="landing__hero">
        <NebulaCanvas />
        <Stack className="landing__grain" aria-hidden="true" />

        <HStack as="header" className="landing__nav" hAlign="between" vAlign="center" padding={5}>
          <HStack gap={2} vAlign="center">
            <BrandMark />
            <Text type="large" weight="bold">EVAde</Text>
          </HStack>
          <HStack gap={2} vAlign="center">
            <ThemeToggle />
            <Button label="Sign in" variant="ghost" href="/login" />
            <Button label="Launch app" variant="primary" href="/dashboard" icon={<Icon icon={RocketLaunchIcon} />} />
          </HStack>
        </HStack>

        <Grid columns={{ minWidth: 340, max: 2 }} gap={8} className="landing__hero-grid">
          <VStack gap={6} vAlign="center" className="landing__copy">
            <HStack className="rise-in">
              <Token label="NASA Space Apps 2026 · Crew health" color="purple" icon={<Icon icon={RocketLaunchIcon} size="sm" />} />
            </HStack>
            <Heading level={1} type="display-1" className="landing__title rise-in" style={stagger(1)}>
              Health telemetry for life{' '}
              <Text type="inherit" className="text-gradient landing__title-accent">
                <DecodeText text="beyond Earth." delayMs={300} />
              </Text>
            </Heading>
            <Text type="large" color="secondary" className="landing__lede rise-in" style={stagger(2)}>
              EVAde turns ECG, EEG and biosensor streams into one calm, color-coded picture of an astronaut’s
              body and mind — then helps them act on it, every single day of the mission.
            </Text>
            <HStack gap={3} wrap="wrap" className="rise-in" style={stagger(3)}>
              <Button label="Open mission dashboard" variant="primary" size="lg" href="/dashboard" endContent={<Icon icon={ArrowRightIcon} />} className="landing__cta" />
              <Button label="Create crew account" size="lg" href="/login?mode=signup" />
            </HStack>
          </VStack>
          <Stack className="landing__visual rise-in" style={stagger(2)}>
            <OrbitalHud />
          </Stack>
        </Grid>

        <Stack className="landing__marquee" aria-label="Signals EVAde monitors">
          <HStack gap={3} className="landing__marquee-track">
            {[...SIGNALS, ...SIGNALS].map((signal, i) => (
              <Token key={`${signal}-${i}`} label={signal} size="lg" aria-hidden={i >= SIGNALS.length ? 'true' : undefined} />
            ))}
          </HStack>
        </Stack>
      </Stack>

      <VStack as="section" gap={8} className="landing__section page" paddingInline={6} paddingBlock={10}>
        <VStack gap={2} className="reveal-on-scroll">
          <Text type="label" color="accent">Built for 180-day missions</Text>
          <Heading level={2} type="display-3">One crew member. Twelve signals. Zero guesswork.</Heading>
        </VStack>
        <Grid columns={{ minWidth: 180, max: 4 }} gap={6}>
          <StatCounter value={12} label="health signals monitored" />
          <StatCounter value={4} label="ways to view every trend" />
          <StatCounter value={180} label="day missions supported" />
          <StatCounter value={6} label="crew ranks to earn" />
        </Grid>
      </VStack>

      <VStack as="section" gap={6} className="landing__section page" paddingInline={6} paddingBlockEnd={10}>
        <Heading level={2} className="reveal-on-scroll">Everything the mission needs, in one place</Heading>
        <Grid columns={{ minWidth: 260, max: 3 }} gap={4}>
          {PILLARS.map(pillar => (
            <Card key={pillar.title} padding={6} className="landing__pillar hover-lift reveal-on-scroll">
              <VStack gap={3}>
                <Stack className={`landing__pillar-icon landing__pillar-icon--${pillar.color}`}>
                  <Icon icon={pillar.icon} size="lg" color={pillar.color} />
                </Stack>
                <Heading level={3}>{pillar.title}</Heading>
                <Text color="secondary">{pillar.body}</Text>
                <HStack>
                  <Button label="Explore" variant="ghost" href={pillar.href} endContent={<Icon icon={ArrowRightIcon} />} />
                </HStack>
              </VStack>
            </Card>
          ))}
        </Grid>
      </VStack>

      <VStack as="footer" gap={2} hAlign="center" paddingBlock={8} className="landing__footer">
        <HStack gap={2} vAlign="center">
          <BrandMark size="sm" />
          <Text type="label">EVAde</Text>
        </HStack>
        <Text type="supporting">Built for the NASA Space Apps Challenge 2026 · Demo data only</Text>
      </VStack>
    </VStack>
  );
}
