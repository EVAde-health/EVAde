import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { MoonIcon } from '@heroicons/react/24/outline';
import { SLEEP, SLEEP_TARGET, weeklySleepAverage } from '../data/mission';
import { STATUS_STYLES, classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import PanelCard from './PanelCard';
import './css/SleepPanel.css';

type SleepView = 'nights' | 'stages';

const STAGES = [
  { key: 'deep', label: 'Deep', color: SERIES.quaternary },
  { key: 'rem', label: 'REM', color: SERIES.primary },
  { key: 'light', label: 'Light', color: SERIES.tertiary },
  { key: 'awake', label: 'Awake', color: SERIES.secondary },
] as const;

// Sleep duration per night or stage composition, color-coded by target.
export default function SleepPanel() {
  const [view, setView] = useState<SleepView>('nights');
  const average = weeklySleepAverage();
  const lastNight = SLEEP[SLEEP.length - 1];
  const status = classify(average, [7, 10], [6, 10]);

  return (
    <PanelCard
      title="Sleep"
      subtitle={`7-night average ${average} h · target ${SLEEP_TARGET} h`}
      icon={MoonIcon}
      status={status}
      actions={
        <SegmentedControl label="Sleep view" value={view} onChange={v => setView(v as SleepView)} size="sm">
          <SegmentedControlItem value="nights" label="Hours" />
          <SegmentedControlItem value="stages" label="Stages" />
        </SegmentedControl>
      }>
      <HStack gap={6} wrap="wrap">
        <VStack gap={0.5}>
          <Text type="supporting">Last night</Text>
          <Text type="display-3" hasTabularNumbers>{lastNight.hours} h</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Deep sleep</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{lastNight.deep} h</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Nights on target</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{SLEEP.filter(n => n.hours >= 7).length}/{SLEEP.length}</Text>
        </VStack>
      </HStack>

      <ResponsiveContainer width="100%" height={220} key={view}>
        <BarChart data={SLEEP} margin={CHART_MARGIN} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={1} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} unit="h" domain={[0, 10]} />
          <Tooltip cursor={{ fill: 'var(--color-tint-hover)' }} content={<ChartTooltip unit="h" />} />
          {view === 'nights' ? (
            <Bar dataKey="hours" name="Sleep" radius={[4, 4, 0, 0]} animationDuration={700}>
              {SLEEP.map(night => (
                <Cell key={night.t} fill={STATUS_STYLES[night.status].color} />
              ))}
            </Bar>
          ) : (
            STAGES.map((stage, i) => (
              <Bar key={stage.key} dataKey={stage.key} name={stage.label} stackId="stages" fill={stage.color} radius={i === STAGES.length - 1 ? [4, 4, 0, 0] : 0} animationDuration={700} />
            ))
          )}
          <ReferenceLine y={SLEEP_TARGET} stroke="var(--color-text-secondary)" strokeDasharray="4 4" label={{ value: 'Target', position: 'insideTopRight', fill: 'var(--color-text-secondary)', fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>

      <HStack gap={4} wrap="wrap">
        {view === 'nights'
          ? (['nominal', 'caution', 'critical'] as const).map(s => (
              <HStack key={s} gap={2} vAlign="center">
                <HStack className="sleep-panel__swatch" style={{ background: STATUS_STYLES[s].color }} />
                <Text type="supporting">{s === 'nominal' ? '≥ 7 h' : s === 'caution' ? '6–7 h' : '< 6 h'}</Text>
              </HStack>
            ))
          : STAGES.map(stage => (
              <HStack key={stage.key} gap={2} vAlign="center">
                <HStack className="sleep-panel__swatch" style={{ background: stage.color }} />
                <Text type="supporting">{stage.label}</Text>
              </HStack>
            ))}
      </HStack>
    </PanelCard>
  );
}
