import { ACCESS_LOGIN_URL } from '../services/api';
import { Button } from '@astryxdesign/core/Button';
import { Grid } from '@astryxdesign/core/Grid';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { Token } from '@astryxdesign/core/Token';
import { ArrowRightIcon, ChevronDoubleDownIcon, RocketLaunchIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import DecodeText from '../components/DecodeText';
import NebulaCanvas from '../components/NebulaCanvas';
import MissionSequence from '../components/MissionSequence';
import OrbitalHud from '../components/OrbitalHud';
import SignalConstellation from '../components/SignalConstellation';
import SpaceAppsFooter from '../components/SpaceAppsFooter';
import ThemeToggle from '../components/ThemeToggle';
import WordReveal from '../components/WordReveal';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { stagger } from '../utils/style';
import './css/LandingPage.css';

const SIGNALS = [
  'Heart rate', 'Blood pressure', 'Blood glucose', 'Body temperature', 'Sleep hours', 'Mood',
  'Behavioral health', 'Radiation dose', 'Bone density', 'Immune markers', 'Cardiovascular events', 'Nutrition',
];

// Cinematic landing: parallax hero, scroll story, constellation, credits.
export default function LandingPage() {
  const [heroRef] = useScrollProgress<HTMLElement>({ mode: 'exit' });

  return (
    <VStack className="landing">
      <Stack as="section" ref={heroRef} className="landing__hero">
        <NebulaCanvas />
        <Stack className="landing__grain" aria-hidden="true" />

        <HStack as="header" className="landing__nav" hAlign="between" vAlign="center" padding={5}>
          <HStack gap={2} vAlign="center">
            <BrandMark />
            <Text type="large" weight="bold">EVAde</Text>
          </HStack>
          <HStack gap={2} vAlign="center">
            <ThemeToggle />
            <Button label="Sign in" variant="ghost" href={ACCESS_LOGIN_URL} />
            <Button label="Launch app" variant="primary" href="/dashboard" icon={<Icon icon={RocketLaunchIcon} />} />
          </HStack>
        </HStack>

        <Grid columns={{ minWidth: 340, max: 2 }} gap={8} className="landing__hero-grid landing__parallax">
          <VStack gap={6} vAlign="center" className="landing__copy landing__depth-copy">
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
              <Button label="Create crew account" size="lg" href={ACCESS_LOGIN_URL} />
            </HStack>
          </VStack>
          <Stack className="landing__visual landing__depth-visual rise-in" style={stagger(2)}>
            <OrbitalHud />
          </Stack>
        </Grid>

        <VStack gap={1} hAlign="center" className="landing__scroll-cue" aria-hidden="true">
          <Text type="supporting">Scroll to launch</Text>
          <Icon icon={ChevronDoubleDownIcon} size="sm" />
        </VStack>

        <Stack className="landing__marquee" aria-label="Signals EVAde monitors">
          <HStack gap={3} className="landing__marquee-track">
            {[...SIGNALS, ...SIGNALS].map((signal, i) => (
              <Token key={`${signal}-${i}`} label={signal} size="lg" aria-hidden={i >= SIGNALS.length ? 'true' : undefined} />
            ))}
          </HStack>
          <Stack className="landing__marquee-edge landing__marquee-edge--start" aria-hidden="true" />
          <Stack className="landing__marquee-edge landing__marquee-edge--end" aria-hidden="true" />
        </Stack>
      </Stack>

      <MissionSequence />

      <VStack as="section" gap={8} hAlign="center" paddingInline={6} paddingBlock={10} className="landing__signals page">
        <VStack gap={2} hAlign="center" className="landing__section-head reveal-on-scroll">
          <Text type="label" color="accent">Twelve signals, one crew member</Text>
          <Heading level={2} type="display-2">Everything the body says, in orbit.</Heading>
          <Text color="secondary">Hover or tab through the constellation to see what each signal tracks and why it matters in space.</Text>
        </VStack>
        <SignalConstellation />
      </VStack>

      <VStack as="section" gap={8} hAlign="center" paddingInline={6} paddingBlock={10} className="landing__finale">
        <WordReveal
          text="Six months from home, the most important vital sign is how you feel. EVAde keeps it in view."
          accentWords={['feel.', 'EVAde']}
        />
        <HStack gap={3} wrap="wrap" hAlign="center" className="reveal-on-scroll">
          <Button label="Open mission dashboard" variant="primary" size="lg" href="/dashboard" endContent={<Icon icon={ArrowRightIcon} />} className="landing__cta" />
          <Button label="Create crew account" size="lg" href={ACCESS_LOGIN_URL} />
        </HStack>
      </VStack>

      <SpaceAppsFooter />
    </VStack>
  );
}
