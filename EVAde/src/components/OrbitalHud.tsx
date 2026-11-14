import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { HStack, Stack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Icon } from '@astryxdesign/core/Icon';
import { HeartIcon, MoonIcon, ShieldCheckIcon, FaceSmileIcon } from '@heroicons/react/24/solid';
import issUrl from '../assets/iss.svg';
import { RADIATION, RADIATION_LIMIT_MSV, weeklySleepAverage } from '../data/mission';
import EcgLine from './EcgLine';
import './css/OrbitalHud.css';

const HEART_INTERVAL_MS = 1100;

// Next simulated heart rate, drifting gently around 68 bpm.
function nextHeartRate(previous: number) {
  return Math.round(Math.min(78, Math.max(62, previous + (Math.random() - 0.5) * 4)));
}

// Live-updating heart-rate card with an ECG trace.
function HeartCard() {
  const [bpm, setBpm] = useState(68);

  useEffect(() => {
    const id = setInterval(() => setBpm(nextHeartRate), HEART_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <Card padding={4} className="glass orbital__card orbital__card--heart">
      <VStack gap={1}>
        <HStack gap={2} vAlign="center">
          <Icon icon={HeartIcon} size="sm" color="pink" />
          <Text type="label" color="secondary">Heart rate</Text>
          <StatusDot variant="success" label="Live" isPulsing />
        </HStack>
        <HStack gap={1} vAlign="end">
          <Text type="display-3" hasTabularNumbers>{bpm}</Text>
          <Text type="supporting">bpm</Text>
        </HStack>
        <EcgLine />
      </VStack>
    </Card>
  );
}

// Planet, orbit rings, ISS and floating telemetry cards with pointer parallax.
export default function OrbitalHud() {
  const rootRef = useRef<HTMLElement>(null);
  const doseShare = Math.round((RADIATION.total / RADIATION_LIMIT_MSV) * 100);

  // Writes pointer offset to CSS variables (no React re-render).
  function handlePointerMove(event: PointerEvent) {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    root.style.setProperty('--px', ((event.clientX - rect.left) / rect.width - 0.5).toFixed(3));
    root.style.setProperty('--py', ((event.clientY - rect.top) / rect.height - 0.5).toFixed(3));
  }

  // Eases the scene back to center when the pointer leaves.
  function handlePointerLeave() {
    rootRef.current?.style.setProperty('--px', '0');
    rootRef.current?.style.setProperty('--py', '0');
  }

  return (
    <Stack ref={rootRef} className="orbital" onPointerMove={handlePointerMove} onPointerLeave={handlePointerLeave} aria-hidden="true">
      <Stack className="orbital__scene">
        <svg className="orbital__planet" viewBox="0 0 200 200">
          <defs>
            <radialGradient id="planet-fill" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="var(--color-data-categorical-cyan)" />
              <stop offset="45%" stopColor="var(--color-data-categorical-blue)" />
              <stop offset="100%" stopColor="var(--color-data-categorical-indigo)" stopOpacity="0.15" />
            </radialGradient>
            <radialGradient id="planet-glow" r="50%">
              <stop offset="70%" stopColor="var(--color-accent)" stopOpacity="0.45" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="98" fill="url(#planet-glow)" />
          <circle cx="100" cy="100" r="70" fill="url(#planet-fill)" />
          <g className="orbital__latitudes">
            <ellipse cx="100" cy="100" rx="70" ry="22" />
            <ellipse cx="100" cy="100" rx="70" ry="48" />
            <ellipse cx="100" cy="100" rx="22" ry="70" />
            <ellipse cx="100" cy="100" rx="48" ry="70" />
          </g>
        </svg>
        <Stack className="orbital__orbit orbital__orbit--outer">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="orbital__ring">
            <ellipse cx="50" cy="50" rx="48" ry="18" />
          </svg>
          <img src={issUrl} alt="" className="orbital__iss" />
        </Stack>
        <Stack className="orbital__orbit orbital__orbit--inner">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="orbital__ring">
            <ellipse cx="50" cy="50" rx="40" ry="14" />
          </svg>
          <Stack className="orbital__moon" />
        </Stack>
      </Stack>

      <HeartCard />

      <Card padding={4} className="glass orbital__card orbital__card--sleep">
        <HStack gap={3} vAlign="center">
          <Icon icon={MoonIcon} size="md" color="purple" />
          <VStack gap={0.5}>
            <Text type="supporting">Sleep · 7-night avg</Text>
            <Text type="large" weight="semibold" hasTabularNumbers>{weeklySleepAverage()} h</Text>
          </VStack>
        </HStack>
      </Card>

      <Card padding={4} className="glass orbital__card orbital__card--dose">
        <HStack gap={3} vAlign="center">
          <Icon icon={ShieldCheckIcon} size="md" color="yellow" />
          <VStack gap={0.5}>
            <Text type="supporting">Mission dose</Text>
            <Text type="large" weight="semibold" hasTabularNumbers>{doseShare}% of limit</Text>
          </VStack>
        </HStack>
      </Card>

      <Card padding={3} className="glass orbital__card orbital__card--mood">
        <HStack gap={2} vAlign="center">
          <Icon icon={FaceSmileIcon} size="md" color="green" />
          <Text type="label">Mood: Good</Text>
        </HStack>
      </Card>
    </Stack>
  );
}
