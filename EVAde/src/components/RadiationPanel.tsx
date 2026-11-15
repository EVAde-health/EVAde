import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { useMission } from '../context/MissionContext';
import { radiationSummary } from '../data/health';
import { classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';

const SERIES_COLOR = 'var(--color-data-categorical-orange)';

// Cumulative mission dose vs career limit plus 30-day daily dose.
export default function RadiationPanel() {
  const { radiation } = useHealthData();
  const { user } = useMission();
  const summary = radiationSummary(radiation, user);
  const status = summary ? classify(summary.today, [0, 1], [0, 2]) : undefined;
  const share = summary ? Math.round((summary.total / summary.limit) * 100) : 0;

  return (
    <PanelCard title="Radiation exposure" subtitle="Personal dosimeter · millisieverts (mSv)" icon={ShieldExclamationIcon} status={status}>
      {!summary ? (
        <NoReadings what="Dosimeter readings" hint="Dock your dosimeter to log today's dose and start your mission total." />
      ) : (
        <>
          <HStack gap={6} wrap="wrap">
            <VStack gap={0.5}>
              <Text type="supporting">Latest day</Text>
              <Text type="display-3" hasTabularNumbers>{summary.today} mSv</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Mission total</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{summary.total} mSv</Text>
            </VStack>
            {summary.projected !== null && (
              <VStack gap={0.5}>
                <Text type="supporting">Projected at day {summary.missionLength}</Text>
                <Text type="large" weight="semibold" hasTabularNumbers>{summary.projected} mSv</Text>
              </VStack>
            )}
          </HStack>
          <ProgressBar
            label={`${share}% of the ${summary.limit} mSv career limit`}
            value={Math.min(summary.total, summary.limit)}
            max={summary.limit}
            variant={share > 50 ? 'warning' : 'accent'}
            marks={summary.projected !== null ? [{ value: Math.min(summary.projected, summary.limit), label: 'Projected' }] : undefined}
            hasValueLabel
          />
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={summary.days} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="dose-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES_COLOR} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={SERIES_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={32} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
              <Tooltip content={<ChartTooltip unit="mSv" />} cursor={{ stroke: GRID_STROKE }} />
              <Area type="monotone" dataKey="dose" name="Daily dose" stroke={SERIES_COLOR} strokeWidth={2} fill="url(#dose-fill)" animationDuration={700} />
              {summary.peak && summary.days.some(d => d.t === summary.peak!.t) && (
                <ReferenceDot x={summary.peak.label} y={summary.peak.dose} r={5} fill="var(--color-error)" stroke="var(--color-background-card)" strokeWidth={2} label={{ value: summary.peak.spe ? 'Solar event' : 'Peak', position: 'top', fill: 'var(--color-text-secondary)', fontSize: 11 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </>
      )}
    </PanelCard>
  );
}
