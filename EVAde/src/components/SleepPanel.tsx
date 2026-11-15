import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { MoonIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { useMission } from '../context/MissionContext';
import { sleepNights, weeklySleepAverage } from '../data/health';
import { STATUS_STYLES, classify } from '../data/status';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import './css/SleepPanel.css';

type SleepView = 'nights' | 'stages';

const STAGES = [
  { key: 'deep', label: 'Deep', color: SERIES.quaternary },
  { key: 'rem', label: 'REM', color: SERIES.primary },
  { key: 'light', label: 'Light', color: SERIES.tertiary },
  { key: 'awake', label: 'Awake', color: SERIES.secondary },
] as const;

// Sleep duration per night or stage composition, colour-coded by target.
export default function SleepPanel() {
  const [view, setView] = useState<SleepView>('nights');
  const { readings } = useHealthData();
  const { settings } = useMission();
  const nights = sleepNights(readings);
  const target = settings?.sleep_target_h ?? 8;
  const average = weeklySleepAverage(nights);
  const lastNight = nights[nights.length - 1];
  const hasStages = nights.some(n => n.deep !== null || n.rem !== null);
  const activeView = hasStages ? view : 'nights';
  const status = average === null ? undefined : classify(average, [7, 10], [6, 10]);

  return (
    <PanelCard
      logMetric="sleep_hours"
      title="Sleep"
      subtitle={average === null ? `Target ${target} h` : `7-night average ${average} h · target ${target} h`}
      icon={MoonIcon}
      status={status}
      actions={
        hasStages && (
          <SegmentedControl label="Sleep view" value={activeView} onChange={v => setView(v as SleepView)} size="sm">
            <SegmentedControlItem value="nights" label="Hours" />
            <SegmentedControlItem value="stages" label="Stages" />
          </SegmentedControl>
        )
      }>
      {!lastNight ? (
        <NoReadings what="Sleep sessions" hint="Start a sleep session with the EEG headband and your nights will chart here." />
      ) : (
        <>
          <HStack gap={6} wrap="wrap">
            <VStack gap={0.5}>
              <Text type="supporting">Last night</Text>
              <Text type="display-3" hasTabularNumbers>{lastNight.hours} h</Text>
            </VStack>
            {lastNight.deep !== null && (
              <VStack gap={0.5}>
                <Text type="supporting">Deep sleep</Text>
                <Text type="large" weight="semibold" hasTabularNumbers>{lastNight.deep} h</Text>
              </VStack>
            )}
            <VStack gap={0.5}>
              <Text type="supporting">Nights on target</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{nights.filter(n => n.hours >= 7).length}/{nights.length}</Text>
            </VStack>
          </HStack>

          <ResponsiveContainer width="100%" height={220} key={activeView}>
            <BarChart data={nights} margin={CHART_MARGIN} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={12} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} unit="h" domain={[0, 10]} />
              <Tooltip cursor={BAR_CURSOR} content={<ChartTooltip unit="h" />} />
              {activeView === 'nights' ? (
                <Bar dataKey="hours" name="Sleep" radius={[4, 4, 0, 0]} animationDuration={700}>
                  {nights.map(night => (
                    <Cell key={night.t} fill={STATUS_STYLES[night.status].color} />
                  ))}
                </Bar>
              ) : (
                STAGES.map((stage, i) => (
                  <Bar key={stage.key} dataKey={stage.key} name={stage.label} stackId="stages" fill={stage.color} radius={i === STAGES.length - 1 ? [4, 4, 0, 0] : 0} animationDuration={700} />
                ))
              )}
              <ReferenceLine y={target} stroke="var(--color-text-secondary)" strokeDasharray="4 4" label={{ value: 'Target', position: 'insideTopRight', fill: 'var(--color-text-secondary)', fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>

          <HStack gap={4} wrap="wrap">
            {activeView === 'nights'
              ? (['nominal', 'caution', 'critical'] as const).map(s => (
                  <HStack key={s} gap={2} vAlign="center">
                    <HStack className="sleep-panel__swatch" style={{ background: STATUS_STYLES[s].color }} aria-hidden="true" />
                    <Text type="supporting">{STATUS_STYLES[s].label}</Text>
                  </HStack>
                ))
              : STAGES.map(stage => (
                  <HStack key={stage.key} gap={2} vAlign="center">
                    <HStack className="sleep-panel__swatch" style={{ background: stage.color }} aria-hidden="true" />
                    <Text type="supporting">{stage.label}</Text>
                  </HStack>
                ))}
          </HStack>
        </>
      )}
    </PanelCard>
  );
}
