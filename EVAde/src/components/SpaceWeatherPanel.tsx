import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { SunIcon } from '@heroicons/react/24/outline';
import { usePoll } from '../hooks/usePoll';
import { stormLevelFor } from '../data/research';
import type { HealthStatus } from '../data/status';
import { SPACE_WEATHER_LATEST, spaceWeatherHistoryPath, type SpaceWeatherRow } from '../services/healthApi';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';

const REFRESH_MS = 5 * 60 * 1000;
const HISTORY_HOURS = 72;
const S1_PFU = 10;

const EVA_STATUS: Record<NonNullable<SpaceWeatherRow['eva_status']>, { status: HealthStatus; label: string }> = {
  go: { status: 'nominal', label: 'EVA go' },
  caution: { status: 'caution', label: 'EVA caution' },
  no_go: { status: 'critical', label: 'EVA no-go' },
};

// Short day + hour label for the flux chart axis.
function hourLabel(ts: string) {
  return new Date(ts).toLocaleString([], { weekday: 'short', hour: 'numeric' });
}

// Proton flux points with a floor so the log axis stays valid.
function fluxPoints(rows: SpaceWeatherRow[] | undefined) {
  return (rows ?? [])
    .filter(r => r.proton_flux_10mev !== null)
    .map(r => ({ label: hourLabel(r.ts), flux: Math.max(r.proton_flux_10mev ?? 0, 0.01) }));
}

// Live NOAA space weather: storm level, proton flux, Kp and EVA go/no-go.
export default function SpaceWeatherPanel() {
  const latest = usePoll<SpaceWeatherRow | null>(SPACE_WEATHER_LATEST, REFRESH_MS);
  const history = usePoll<SpaceWeatherRow[]>(spaceWeatherHistoryPath(HISTORY_HOURS), REFRESH_MS);
  const row = latest.data ?? null;
  const storm = row ? stormLevelFor(row.storm_level, row.proton_flux_10mev) : null;
  const eva = row?.eva_status ? EVA_STATUS[row.eva_status] : null;
  const points = fluxPoints(history.data);

  return (
    <PanelCard title="Space weather" subtitle="NOAA GOES satellites · live, refreshed every few minutes" icon={SunIcon} status={storm?.status}>
      {!row || !storm ? (
        <NoReadings what="Space weather" hint={latest.loading ? 'Checking NOAA…' : 'NOAA readings appear after the next 15-minute pull.'} hasTutorialLink={false} />
      ) : (
        <>
          <HStack gap={6} wrap="wrap" vAlign="end">
            <VStack gap={0.5}>
              <Text type="supporting">Solar radiation storm</Text>
              <Text type="display-3" hasTabularNumbers>{storm.level} · {storm.name}</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Protons ≥10 MeV</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{row.proton_flux_10mev?.toFixed(2) ?? '—'} pfu</Text>
            </VStack>
            <VStack gap={0.5}>
              <Text type="supporting">Kp index</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{row.kp_index ?? '—'}</Text>
            </VStack>
            {eva && <StatusBadge status={eva.status} label={eva.label} />}
          </HStack>
          {points.length > 1 && (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={points} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={40} />
                <YAxis scale="log" domain={[0.01, 'auto']} allowDataOverflow tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
                <Tooltip content={<ChartTooltip unit="pfu" />} cursor={{ stroke: GRID_STROKE }} />
                <ReferenceLine y={S1_PFU} stroke="var(--color-warning)" strokeDasharray="5 4" label={{ value: 'S1 storm', position: 'insideTopRight', fill: 'var(--color-text-secondary)', fontSize: 11 }} />
                <Line type="monotone" dataKey="flux" name="Proton flux" stroke={SERIES.primary} strokeWidth={2} dot={false} animationDuration={800} />
              </LineChart>
            </ResponsiveContainer>
          )}
          <Text type="supporting">Updated <Timestamp value={row.ts} /> · {row.source}</Text>
        </>
      )}
    </PanelCard>
  );
}
