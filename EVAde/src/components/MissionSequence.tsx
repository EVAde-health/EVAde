import type { ComponentType, SVGProps } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { ArrowRightIcon, BookOpenIcon, ChartBarSquareIcon, PlayIcon, PlayCircleIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { CheckCircleIcon, HeartIcon, MoonIcon, SunIcon } from '@heroicons/react/24/solid';
import { useScrollProgress } from '../hooks/useScrollProgress';
import EcgLine from './EcgLine';
import './css/MissionSequence.css';

interface Chapter {
  id: string;
  kicker: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const CHAPTERS: Chapter[] = [
  { id: 'monitor', kicker: '01 · Monitor', title: 'Every heartbeat. Every night of sleep.', body: 'ECG, EEG and biosensor streams become one color-coded picture, with trend, range, zone and daily-rhythm views of each signal.', href: '/dashboard', cta: 'Open dashboard', icon: ChartBarSquareIcon },
  { id: 'learn', kicker: '02 · Learn', title: 'Clinical readings, self-taught.', body: 'Short guided videos let crew take blood pressure, glucose and ECG readings without a flight surgeon on board.', href: '/tutorials', cta: 'Browse tutorials', icon: PlayCircleIcon },
  { id: 'act', kicker: '03 · Act', title: 'Habits that level up.', body: 'Protocols, water and nutrition earn XP, streaks and ranks, so healthy routines last all 180 days of a mission.', href: '/tasks', cta: 'See missions', icon: TrophyIcon },
  { id: 'reflect', kicker: '04 · Reflect', title: 'A companion for the long quiet.', body: 'A private journal, mood check-ins and selfies build the behavioral-health picture that matters most far from home.', href: '/journal', cta: 'Open journal', icon: BookOpenIcon },
];

const TASK_ROWS = ['Morning blood pressure', 'Drink 2.5 L of water', 'Log breakfast macros'];

// Live vitals mock-up for the Monitor chapter.
function MonitorVisual() {
  return (
    <VStack gap={3} padding={5} className="sequence__panel glass">
      <HStack gap={2} vAlign="center">
        <Icon icon={HeartIcon} size="sm" color="pink" />
        <Text type="label">Heart rate</Text>
        <Text type="display-3" hasTabularNumbers className="sequence__push">68</Text>
      </HStack>
      <EcgLine speed="fast" />
      <HStack gap={2} vAlign="center">
        <Icon icon={MoonIcon} size="sm" color="purple" />
        <Text type="label">Sleep</Text>
        <Text type="large" weight="semibold" className="sequence__push">7.4 h</Text>
      </HStack>
      <HStack className="sequence__bars">
        {[62, 80, 45, 90, 72, 84, 66].map((height, i) => (
          <Stack key={i} className="sequence__bar" style={{ blockSize: `${height}%`, animationDelay: `${i * 90}ms` }} />
        ))}
      </HStack>
    </VStack>
  );
}

// Video-player mock-up for the Learn chapter.
function LearnVisual() {
  return (
    <VStack gap={3} padding={5} className="sequence__panel glass">
      <Stack className="sequence__video">
        <Stack className="sequence__play">
          <Icon icon={PlayIcon} size="lg" />
        </Stack>
      </Stack>
      <Text type="large" weight="semibold">Blood pressure with the cuff</Text>
      <HStack gap={1}>
        {[0, 1, 2, 3, 4].map(i => (
          <Stack key={i} className="sequence__step" style={{ animationDelay: `${i * 260}ms` }} />
        ))}
      </HStack>
    </VStack>
  );
}

// XP and checklist mock-up for the Act chapter.
function ActVisual() {
  return (
    <VStack gap={3} padding={5} className="sequence__panel glass">
      <HStack gap={2} vAlign="center">
        <Text type="label">Lv 4 · Specialist</Text>
        <Text type="label" color="accent" className="sequence__push sequence__xp-pop">+25 XP</Text>
      </HStack>
      <Stack className="sequence__xp">
        <Stack className="sequence__xp-fill" />
      </Stack>
      {TASK_ROWS.map((task, i) => (
        <HStack key={task} gap={2} vAlign="center" className="sequence__task" style={{ animationDelay: `${300 + i * 300}ms` }}>
          <Icon icon={CheckCircleIcon} size="sm" color="green" />
          <Text>{task}</Text>
        </HStack>
      ))}
    </VStack>
  );
}

// Chat and mood mock-up for the Reflect chapter.
function ReflectVisual() {
  return (
    <VStack gap={3} padding={5} className="sequence__panel glass">
      <HStack gap={2} hAlign="center" className="sequence__moods">
        {['😣', '😕', '😐', '🙂', '😄'].map((emoji, i) => (
          <Text key={emoji} type="display-3" className={i === 3 ? 'sequence__mood sequence__mood--picked' : 'sequence__mood'}>{emoji}</Text>
        ))}
      </HStack>
      <Text className="sequence__bubble sequence__bubble--me">I miss home today.</Text>
      <Text className="sequence__bubble">That makes sense on day 142. Want to look at Earth together?</Text>
      <HStack gap={2} vAlign="center">
        <Icon icon={SunIcon} size="sm" color="orange" />
        <Text type="supporting">Mood trend steady · 7-day avg 3.8</Text>
      </HStack>
    </VStack>
  );
}

const VISUALS = [MonitorVisual, LearnVisual, ActVisual, ReflectVisual];

// Sticky scroll story: four chapters cross-fade over a rising Earth.
export default function MissionSequence() {
  const [sectionRef, activeChapter] = useScrollProgress<HTMLElement>({ mode: 'sticky', steps: CHAPTERS.length });

  return (
    <Stack as="section" ref={sectionRef} className="sequence" aria-label="How EVAde supports a mission">
      <Stack className="sequence__stage">
        <Stack className="sequence__stars sequence__stars--far" aria-hidden="true" />
        <Stack className="sequence__stars sequence__stars--near" aria-hidden="true" />
        <Stack className="sequence__earth" aria-hidden="true">
          <Stack className="sequence__earth-surface" />
        </Stack>

        <VStack className="sequence__rail" aria-hidden="true">
          <Stack className="sequence__rail-fill" />
          {CHAPTERS.map((chapter, i) => (
            <Stack key={chapter.id} className={`sequence__rail-dot ${i <= activeChapter ? 'is-lit' : ''}`} />
          ))}
        </VStack>

        <Stack className="sequence__grid">
          <Stack className="sequence__copy">
            {CHAPTERS.map((chapter, i) => (
              <VStack key={chapter.id} gap={4} className={`sequence__chapter ${i === activeChapter ? 'is-active' : ''} ${i < activeChapter ? 'is-past' : ''}`} aria-hidden={i !== activeChapter}>
                <HStack gap={2} vAlign="center">
                  <Icon icon={chapter.icon} size="sm" color="accent" />
                  <Text type="label" color="accent">{chapter.kicker}</Text>
                </HStack>
                <Heading level={2} type="display-2" className="sequence__title">{chapter.title}</Heading>
                <Text type="large" color="secondary">{chapter.body}</Text>
                <HStack>
                  <Button label={chapter.cta} variant="secondary" href={chapter.href} endContent={<Icon icon={ArrowRightIcon} />} />
                </HStack>
              </VStack>
            ))}
          </Stack>
          <Stack className="sequence__visuals" aria-hidden="true">
            {VISUALS.map((Visual, i) => (
              <Stack key={CHAPTERS[i].id} className={`sequence__visual ${i === activeChapter ? 'is-active' : ''} ${i < activeChapter ? 'is-past' : ''}`}>
                <Visual />
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </Stack>
  );
}
