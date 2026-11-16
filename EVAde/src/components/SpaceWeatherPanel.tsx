import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { SunIcon } from '@heroicons/react/24/outline';
import { usePoll } from '../hooks/usePoll';
import { useResource } from '../services/useResource';
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

interface EvaWindowPayload {
  rule: {
    note: string;
    proton_10mev_pfu: number | null;
    best: { start: string; end: string; status: string; max_kp: number } | null;
  };
  spe_model: { model_id: string; ok: boolean; status: number; latency_ms: number; model_sha256: string | null; output: unknown };
}

// Live NOAA space weather: storm level, proton flux, Kp, the Kp-rule EVA window, and EVA-12 when the gateway runs it.
export default function SpaceWeatherPanel() {
  const latest = usePoll<SpaceWeatherRow | null>(SPACE_WEATHER_LATEST, REFRESH_MS);
  const history = usePoll<SpaceWeatherRow[]>(spaceWeatherHistoryPath(HISTORY_HOURS), REFRESH_MS);
  const eva = useResource<EvaWindowPayload>('/eva/window');
  const row = latest.data ?? null;
  const storm = row ? stormLevelFor(row.storm_level, row.proton_flux_10mev) : null;
  const evaState = row?.eva_status ? EVA_STATUS[row.eva_status] : null;
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
            {evaState && <StatusBadge status={evaState.status} label={evaState.label} />}
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
      <VStack gap={1}>
        <Text type="label">Next safe EVA window</Text>
        {eva.loading && <Text type="supporting">Checking the NOAA forecast and EVA-12…</Text>}
        {eva.error && <Text role="alert">{eva.error}</Text>}
        {eva.data && (
          <VStack gap={1}>
            <Text type="supporting">{eva.data.rule.note}</Text>
            {eva.data.rule.best ? (
              <Text>
                {eva.data.rule.best.status === 'go' ? 'Go' : 'Caution'} {eva.data.rule.best.start} to {eva.data.rule.best.end}, max Kp {eva.data.rule.best.max_kp}.
              </Text>
            ) : (
              <Text>No 6-hour window with forecast Kp under 5{eva.data.rule.proton_10mev_pfu != null && eva.data.rule.proton_10mev_pfu >= 10 ? ' because protons are already at radiation-storm levels' : ''}.</Text>
            )}
            <Text type="supporting">
              {eva.data.spe_model.model_id} {eva.data.spe_model.ok ? `ran in ${eva.data.spe_model.latency_ms} ms` : `did not run (HTTP ${eva.data.spe_model.status})`}.
              {eva.data.spe_model.model_sha256 ? ` Weight sha256 ${eva.data.spe_model.model_sha256}.` : ' No weight hash was returned.'}
            </Text>
            <Text type="supporting">{speMessage(eva.data.spe_model.output)}</Text>
          </VStack>
        )}
      </VStack>
    </PanelCard>
  );
}

function speMessage(output: unknown) {
  if (!output || typeof output !== 'object') return 'EVA-12 returned no probability.';
  const row = output as { error?: string; data?: { p_onset_24h?: number; forecast?: { p_onset_24h?: number } } };
  const p = row.data?.forecast?.p_onset_24h ?? row.data?.p_onset_24h;
  if (typeof p === 'number') return `EVA-12 P(solar particle event within 24 h) = ${(p * 100).toFixed(1)}%.`;
  if (row.error) return String(row.error);
  return 'EVA-12 did not return P(onset). The number above is the NOAA Kp rule only.';
}
