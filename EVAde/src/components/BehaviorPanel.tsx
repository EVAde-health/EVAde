import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { CpuChipIcon } from '@heroicons/react/24/outline';
import { BEHAVIOR, behaviorScore } from '../data/mission';
import { classify } from '../data/status';
import { GRID_STROKE, SERIES } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import PanelCard from './PanelCard';
import ScoreRing from './ScoreRing';
import './css/BehaviorPanel.css';

// Largest drop versus baseline, surfaced as a coaching insight.
function biggestDip() {
  return BEHAVIOR.reduce((worst, axis) => (axis.today - axis.baseline < worst.today - worst.baseline ? axis : worst));
}

// Behavioral health radar comparing today against the personal baseline.
export default function BehaviorPanel() {
  const score = behaviorScore();
  const status = classify(score, [65, 100], [50, 100]);
  const dip = biggestDip();

  return (
    <PanelCard title="Behavioral health" subtitle="EEG + survey model · today vs your baseline" icon={CpuChipIcon} status={status}>
      <HStack gap={4} vAlign="center" wrap="wrap">
        <ScoreRing value={score} label="Behavioral health index" tone={status} />
        <VStack gap={1} className="behavior-panel__insight">
          <Text type="label">Insight</Text>
          <Text type="supporting">
            {dip.axis} is {dip.baseline - dip.today} points below your baseline. Try a call home or a shared crew meal today.
          </Text>
        </VStack>
      </HStack>
      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={BEHAVIOR} outerRadius="75%">
          <PolarGrid stroke={GRID_STROKE} />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Tooltip content={<ChartTooltip />} />
          <Radar name="Baseline" dataKey="baseline" stroke={SERIES.baseline} fill={SERIES.baseline} fillOpacity={0.12} strokeDasharray="4 3" />
          <Radar name="Today" dataKey="today" stroke={SERIES.quaternary} fill={SERIES.quaternary} fillOpacity={0.3} strokeWidth={2} animationDuration={900} />
        </RadarChart>
      </ResponsiveContainer>
      <HStack gap={4}>
        <HStack gap={2} vAlign="center">
          <HStack className="behavior-panel__key" style={{ background: SERIES.quaternary }} aria-hidden="true" />
          <Text type="supporting">Today</Text>
        </HStack>
        <HStack gap={2} vAlign="center">
          <HStack className="behavior-panel__key behavior-panel__key--dashed" aria-hidden="true" />
          <Text type="supporting">Baseline</Text>
        </HStack>
      </HStack>
    </PanelCard>
  );
}
