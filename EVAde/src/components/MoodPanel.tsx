import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden';
import { Tooltip as HoverTip } from '@astryxdesign/core/Tooltip';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Button } from '@astryxdesign/core/Button';
import { FaceSmileIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { MOOD_EMOJI, MOOD_LABELS, moodDays, type MoodDay } from '../data/health';
import { classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, MOOD_RAMP, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import { stagger } from '../utils/style';
import './css/MoodPanel.css';

type MoodView = 'calendar' | 'trend';

// Rolling seven-day mean of mood scores.
function rollingMood(days: MoodDay[]) {
  return days.map((day, i) => {
    const window = days.slice(Math.max(0, i - 6), i + 1);
    return { ...day, rolling: Math.round((window.reduce((s, d) => s + d.score, 0) / window.length) * 10) / 10 };
  });
}

// Mood calendar heatmap or rolling trend from daily check-ins.
export default function MoodPanel() {
  const [view, setView] = useState<MoodView>('calendar');
  const { readings } = useHealthData();
  const days = moodDays(readings);
  const rolling = rollingMood(days);
  const latest = days[days.length - 1];
  const weekAverage = rolling.length ? rolling[rolling.length - 1].rolling : null;
  const status = weekAverage === null ? undefined : classify(weekAverage, [3, 5], [2.3, 5]);

  return (
    <PanelCard
      logMetric="mood"
      title="Mood"
      subtitle="Daily check-in · 1 (rough) to 5 (great)"
      icon={FaceSmileIcon}
      status={status}
      actions={
        days.length > 0 && (
          <SegmentedControl label="Mood view" value={view} onChange={v => setView(v as MoodView)} size="sm">
            <SegmentedControlItem value="calendar" label="Calendar" />
            <SegmentedControlItem value="trend" label="Trend" />
          </SegmentedControl>
        )
      }>
      {!latest ? (
        <NoReadings what="Mood check-ins" hint="Rate your mood on the Journal page to start your mood calendar." hasTutorialLink={false} />
      ) : (
        <>
          <HStack gap={4} vAlign="center" wrap="wrap">
            <Text type="display-2" className="mood-panel__emoji" aria-hidden="true">{MOOD_EMOJI[latest.score - 1]}</Text>
            <VStack gap={0.5}>
              <Text type="large" weight="semibold">{latest.label}: {MOOD_LABELS[latest.score - 1]}</Text>
              <Text type="supporting">7-day average {weekAverage} / 5</Text>
            </VStack>
            <Button label="Check in" size="sm" variant="ghost" href="/journal" />
          </HStack>

          {view === 'calendar' ? (
            <VStack gap={3}>
              <VisuallyHidden>{`Last ${days.length} days of mood check-ins; seven-day average ${weekAverage} of 5.`}</VisuallyHidden>
              <Grid columns={7} gap={1} className="mood-panel__calendar" aria-hidden="true">
                {days.map((day, i) => (
                  <HoverTip key={day.t} content={`${day.label}: ${MOOD_LABELS[day.score - 1]} (${day.score}/5)`}>
                    <HStack className="mood-panel__cell rise-in" style={{ ...stagger(i * 0.3), background: MOOD_RAMP[day.score - 1] }} aria-hidden="true" />
                  </HoverTip>
                ))}
              </Grid>
              <HStack gap={2} vAlign="center" aria-hidden="true">
                <Text type="supporting">Rough</Text>
                {MOOD_RAMP.map(color => (
                  <HStack key={color} className="mood-panel__key" style={{ background: color }} />
                ))}
                <Text type="supporting">Great</Text>
              </HStack>
            </VStack>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={rolling} margin={CHART_MARGIN}>
                <defs>
                  <linearGradient id="mood-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES.quaternary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SERIES.quaternary} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={28} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: GRID_STROKE }} />
                <Area type="monotone" dataKey="rolling" name="7-day average" stroke={SERIES.quaternary} strokeWidth={2} fill="url(#mood-fill)" animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </>
      )}
    </PanelCard>
  );
}
