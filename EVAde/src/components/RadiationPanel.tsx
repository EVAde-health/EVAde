import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { ShieldExclamationIcon } from '@heroicons/react/24/outline';
import { CREW, RADIATION, RADIATION_LIMIT_MSV } from '../data/mission';
import { classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import PanelCard from './PanelCard';

const SERIES_COLOR = 'var(--color-data-categorical-orange)';

// Biggest daily dose in the window, i.e. the solar particle event.
function peakDay() {
  return RADIATION.recent.reduce((peak, day) => (day.dose > peak.dose ? day : peak));
}

// Cumulative mission dose vs career limit plus 30-day daily dose.
export default function RadiationPanel() {
  const share = Math.round((RADIATION.total / RADIATION_LIMIT_MSV) * 100);
  const projected = Math.round((RADIATION.total / CREW.missionDay) * CREW.missionLength);
  const status = classify(RADIATION.today, [0, 1], [0, 2]);
  const peak = peakDay();

  return (
    <PanelCard title="Radiation exposure" subtitle="Personal dosimeter · millisieverts (mSv)" icon={ShieldExclamationIcon} status={status}>
      <HStack gap={6} wrap="wrap">
        <VStack gap={0.5}>
          <Text type="supporting">Today</Text>
          <Text type="display-3" hasTabularNumbers>{RADIATION.today} mSv</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Mission total</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{RADIATION.total} mSv</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Projected at day {CREW.missionLength}</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{projected} mSv</Text>
        </VStack>
      </HStack>
      <VStack gap={1}>
        <ProgressBar
          label={`${share}% of the ${RADIATION_LIMIT_MSV} mSv career limit`}
          value={RADIATION.total}
          max={RADIATION_LIMIT_MSV}
          variant={share > 50 ? 'warning' : 'accent'}
          marks={[{ value: projected, label: 'Projected' }]}
          hasValueLabel
        />
      </VStack>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={RADIATION.recent} margin={CHART_MARGIN}>
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
          <ReferenceDot x={peak.label} y={peak.dose} r={5} fill="var(--color-error)" stroke="var(--color-background-card)" strokeWidth={2} label={{ value: 'Solar event', position: 'top', fill: 'var(--color-text-secondary)', fontSize: 11 }} />
        </AreaChart>
      </ResponsiveContainer>
    </PanelCard>
  );
}
