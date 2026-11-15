import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { CpuChipIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { behaviorAxes, behaviorIndex, type BehaviorAxis } from '../data/health';
import { classify } from '../data/status';
import { GRID_STROKE, SERIES } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import ScoreRing from './ScoreRing';
import './css/BehaviorPanel.css';

// Largest drop versus baseline, surfaced as a coaching insight.
function biggestDip(axes: BehaviorAxis[]) {
  const compared = axes.filter((a): a is BehaviorAxis & { baseline: number } => a.baseline !== null);
  if (!compared.length) return null;
  return compared.reduce((worst, axis) => (axis.today - axis.baseline < worst.today - worst.baseline ? axis : worst));
}

// Coaching line for the biggest dip, or praise when nothing dipped.
function insightText(dip: ReturnType<typeof biggestDip>) {
  if (dip && dip.baseline > dip.today) {
    return `${dip.axis} is ${dip.baseline - dip.today} points below your baseline. Try a call home or a shared crew meal today.`;
  }
  return 'Every dimension is at or above your baseline. Keep up the routine.';
}

// Behavioral health radar comparing today against the personal baseline.
export default function BehaviorPanel() {
  const { readings } = useHealthData();
  const axes = behaviorAxes(readings);
  const score = behaviorIndex(readings, axes);
  const status = score === null ? undefined : classify(score, [65, 100], [50, 100]);
  const hasBaseline = axes.some(a => a.baseline !== null);
  const hasRadar = axes.length >= 3;

  return (
    <PanelCard title="Behavioral health" subtitle="EEG + survey model · today vs your baseline" icon={CpuChipIcon} status={status}>
      {score === null || !status ? (
        <NoReadings what="Your behavioral health index" hint="Focus, energy, calm and social scores appear after your first EEG session or evening survey." />
      ) : (
        <>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <ScoreRing value={score} label="Behavioral health index" tone={status} />
            <VStack gap={1} className="behavior-panel__insight">
              <Text type="label">Insight</Text>
              <Text type="supporting">{insightText(biggestDip(axes))}</Text>
            </VStack>
          </HStack>
          {hasRadar && (
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart data={axes} outerRadius="75%">
                <PolarGrid stroke={GRID_STROKE} />
                <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                {hasBaseline && <Radar name="Baseline" dataKey="baseline" stroke={SERIES.baseline} fill={SERIES.baseline} fillOpacity={0.12} strokeDasharray="4 3" />}
                <Radar name="Today" dataKey="today" stroke={SERIES.quaternary} fill={SERIES.quaternary} fillOpacity={0.3} strokeWidth={2} animationDuration={900} />
              </RadarChart>
            </ResponsiveContainer>
          )}
          {hasRadar && (
            <HStack gap={4}>
              <HStack gap={2} vAlign="center">
                <HStack className="behavior-panel__key" style={{ background: SERIES.quaternary }} aria-hidden="true" />
                <Text type="supporting">Today</Text>
              </HStack>
              {hasBaseline && (
                <HStack gap={2} vAlign="center">
                  <HStack className="behavior-panel__key behavior-panel__key--dashed" aria-hidden="true" />
                  <Text type="supporting">30-day baseline</Text>
                </HStack>
              )}
            </HStack>
          )}
        </>
      )}
    </PanelCard>
  );
}
