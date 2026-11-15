import { useRef, useState, type ComponentType, type CSSProperties, type PointerEvent, type SVGProps } from 'react';
import { Heading, Text } from '@astryxdesign/core/Text';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import {
  BeakerIcon,
  BoltIcon,
  CakeIcon,
  FaceSmileIcon,
  FireIcon,
  HeartIcon,
  MoonIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';
import './css/SignalConstellation.css';

interface Signal {
  name: string;
  source: string;
  why: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  tone: 'blue' | 'orange' | 'teal' | 'purple';
}

const SIGNALS: Signal[] = [
  { name: 'Heart rate', source: 'ECG patch', why: 'Microgravity shifts fluid toward the head and deconditions the heart.', icon: HeartIcon, tone: 'blue' },
  { name: 'Blood pressure', source: 'Cuff · self-measured', why: 'Orthostatic intolerance is a risk on return to gravity.', icon: BoltIcon, tone: 'orange' },
  { name: 'Blood glucose', source: 'Continuous monitor', why: 'Spaceflight can raise insulin resistance within weeks.', icon: BeakerIcon, tone: 'teal' },
  { name: 'Body temperature', source: 'Core-temp sensor', why: 'Core temperature runs higher in orbit, especially during exercise.', icon: FireIcon, tone: 'purple' },
  { name: 'Sleep hours', source: 'EEG headband', why: 'Sixteen sunrises a day disrupt circadian rhythm.', icon: MoonIcon, tone: 'blue' },
  { name: 'Mood', source: 'Daily check-in', why: 'Isolation and confinement wear on mood over long missions.', icon: FaceSmileIcon, tone: 'orange' },
  { name: 'Behavioral health', source: 'EEG + journal', why: 'Early signs of stress are easier to address than a crisis.', icon: SparklesIcon, tone: 'teal' },
  { name: 'Radiation dose', source: 'Dosimeter', why: 'Cumulative dose is tracked against career limits.', icon: SunIcon, tone: 'purple' },
  { name: 'Bone density', source: 'Ultrasound scan', why: 'Astronauts can lose 1–1.5% of hip bone mass per month.', icon: UserIcon, tone: 'blue' },
  { name: 'Immune markers', source: 'Blood panel', why: 'Latent viruses can reactivate when immunity dips.', icon: ShieldCheckIcon, tone: 'orange' },
  { name: 'Cardio events', source: 'ECG rhythm AI', why: 'Arrhythmias are flagged automatically for the flight surgeon.', icon: WrenchScrewdriverIcon, tone: 'teal' },
  { name: 'Nutrition', source: 'Meal log', why: 'Crews often under-eat; calories and protein protect muscle and bone.', icon: CakeIcon, tone: 'purple' },
];

// Places node i evenly around the orbit as CSS variables.
function nodePosition(index: number) {
  const angle = (index / SIGNALS.length) * Math.PI * 2 - Math.PI / 2;
  return { '--x': `${50 + Math.cos(angle) * 44}%`, '--y': `${50 + Math.sin(angle) * 44}%`, '--d': `${index * 70}ms` } as CSSProperties;
}

// Orbiting constellation of every monitored signal with hover details.
export default function SignalConstellation() {
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const active = SIGNALS[activeIndex];

  // Tilts the constellation toward the pointer via CSS variables.
  function handlePointerMove(event: PointerEvent) {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    root.style.setProperty('--px', ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3));
    root.style.setProperty('--py', ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3));
  }

  return (
    <Stack ref={rootRef} className="constellation" onPointerMove={handlePointerMove}>
      <Stack className="constellation__tilt">
        <Stack className="constellation__orbit">
          <svg className="constellation__lines" viewBox="0 0 100 100" aria-hidden="true">
            {SIGNALS.map((signal, i) => {
              const angle = (i / SIGNALS.length) * Math.PI * 2 - Math.PI / 2;
              return (
                <line
                  key={signal.name}
                  x1="50"
                  y1="50"
                  x2={50 + Math.cos(angle) * 44}
                  y2={50 + Math.sin(angle) * 44}
                  className={i === activeIndex ? 'is-active' : undefined}
                />
              );
            })}
            <circle cx="50" cy="50" r="44" className="constellation__ring" />
            <circle cx="50" cy="50" r="30" className="constellation__ring constellation__ring--inner" />
          </svg>
          {SIGNALS.map((signal, i) => (
            <Stack
              key={signal.name}
              as="button"
              className={`constellation__node constellation__node--${signal.tone} ${i === activeIndex ? 'is-active' : ''}`}
              style={nodePosition(i)}
              aria-label={signal.name}
              aria-pressed={i === activeIndex}
              onPointerEnter={() => setActiveIndex(i)}
              onFocus={() => setActiveIndex(i)}
              onClick={() => setActiveIndex(i)}>
              <Icon icon={signal.icon} size="sm" />
            </Stack>
          ))}
        </Stack>

        <VStack gap={2} hAlign="center" className="constellation__core glass" aria-live="polite" key={active.name}>
          <Text type="label" color="accent">{active.source}</Text>
          <Heading level={3} type="display-3" className="constellation__name">{active.name}</Heading>
          <Text type="supporting" className="constellation__why">{active.why}</Text>
          <HStack gap={1} aria-hidden="true">
            {SIGNALS.map((signal, i) => (
              <Stack key={signal.name} className={`constellation__pip ${i === activeIndex ? 'is-active' : ''}`} />
            ))}
          </HStack>
        </VStack>
      </Stack>
    </Stack>
  );
}
