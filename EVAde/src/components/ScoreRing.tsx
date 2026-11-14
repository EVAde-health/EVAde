import { Center } from '@astryxdesign/core/Center';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { STATUS_STYLES, type HealthStatus } from '../data/status';
import { useCountUp } from '../hooks/useCountUp';
import './css/ScoreRing.css';

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Animated circular gauge for a 0–max score, colored by status.
export default function ScoreRing({ value, max = 100, label, tone, caption, suffix = '', size = 'md' }: { value: number; max?: number; label: string; tone: HealthStatus; caption?: string; suffix?: string; size?: 'md' | 'lg' }) {
  const animated = useCountUp(value, 1200);
  const fraction = Math.min(1, animated / max);

  return (
    <Center className={`score-ring score-ring--${size}`}>
      <svg viewBox="0 0 100 100" className="score-ring__svg" role="img" aria-label={`${label}: ${value}${suffix} of ${max}`}>
        <circle cx="50" cy="50" r={RADIUS} className="score-ring__track" />
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          className="score-ring__value"
          stroke={STATUS_STYLES[tone].color}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        />
      </svg>
      <VStack gap={0} hAlign="center" className="score-ring__label">
        <Text type={size === 'lg' ? 'display-2' : 'display-3'} hasTabularNumbers>
          {Math.round(animated)}
          {suffix}
        </Text>
        <Text type="supporting">{caption ?? STATUS_STYLES[tone].label}</Text>
      </VStack>
    </Center>
  );
}
