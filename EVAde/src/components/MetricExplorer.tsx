import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Table } from '@astryxdesign/core/Table';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { ChartBarIcon, ClockIcon, PresentationChartLineIcon, Squares2X2Icon, TableCellsIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import {
  EXPLORER_VITALS,
  PAIR_COLOR,
  formatTick,
  getHistogram,
  getRhythm,
  getTrend,
  getZoneShare,
  normalRange,
  roundTo,
  windowReadings,
  type ExplorerVital,
  type Reading,
  type TimeWindow,
} from '../data/metrics';
import { ZONE_COLORS, type Range, type Zone } from '../data/status';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import './css/MetricExplorer.css';

type ExplorerView = 'trend' | 'range' | 'zones' | 'rhythm' | 'table';

const CHART_HEIGHT = 300;
const ZONE_LABELS: Record<Zone, string> = { low: 'Below range', normal: 'In range', high: 'Above range' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const RHYTHM_RAMP = ['var(--color-data-blue-1)', 'var(--color-data-blue-2)', 'var(--color-data-blue-3)', 'var(--color-data-blue-4)', 'var(--color-data-blue-5)'];
const NO_READINGS: Reading[] = [];
const WINDOW_LABELS: Record<TimeWindow, string> = { '24h': 'the last 24 hours', '7d': 'the last 7 days', '30d': 'the last 30 days' };

interface TableRow extends Record<string, unknown> {
  id: number;
  time: string;
  avg: number;
  low: number;
  high: number;
}

// Merges the paired metric (diastolic) into the trend rows by bucket time.
function buildTrendRows(readings: Reading[], pairReadings: Reading[] | null, timeWindow: TimeWindow, decimals: number) {
  const trend = getTrend(readings, timeWindow, decimals);
  if (!pairReadings) return trend.map(p => ({ ...p, secondary: undefined as number | undefined }));
  const pairByTime = new Map(getTrend(pairReadings, timeWindow, decimals).map(p => [p.t, p.value]));
  return trend.map(p => ({ ...p, secondary: pairByTime.get(p.t) }));
}

// Mean, min, max and time-in-range summary for a window.
function summarize(readings: Reading[], normal: Range | null, decimals: number) {
  const values = readings.map(r => r.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean: roundTo(mean, decimals).toFixed(decimals),
    min: Math.min(...values).toFixed(decimals),
    max: Math.max(...values).toFixed(decimals),
    inRange: normal ? getZoneShare(readings, normal) : null,
  };
}

// Maps a value to a five-step sequential ramp index.
function rampIndex(value: number, min: number, max: number) {
  return Math.min(4, Math.floor(((value - min) / (max - min || 1)) * 5));
}

// Time-in-range bar plus colored histogram of readings.
function ZonesView({ readings, normal, unit, decimals }: { readings: Reading[]; normal: Range; unit: string; decimals: number }) {
  const share = getZoneShare(readings, normal);
  const bins = getHistogram(readings, normal, decimals);

  return (
    <VStack gap={4}>
      <HStack className="explorer__zone-bar" aria-label="Time in range">
        {(Object.keys(share) as Zone[]).map(zone =>
          share[zone] > 0 ? (
            <HStack key={zone} className="explorer__zone-segment" style={{ flexGrow: share[zone], background: ZONE_COLORS[zone] }}>
              <Text type="supporting" className="explorer__zone-label">{ZONE_LABELS[zone]} · {share[zone]}%</Text>
            </HStack>
          ) : null,
        )}
      </HStack>
      <ResponsiveContainer width="100%" height={CHART_HEIGHT - 60}>
        <BarChart data={bins} margin={CHART_MARGIN} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <XAxis dataKey="center" tick={AXIS_TICK} axisLine={false} tickLine={false} unit={` ${unit}`} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} allowDecimals={false} />
          <Tooltip cursor={BAR_CURSOR} content={<ChartTooltip unit="readings" formatLabel={l => `${l} ${unit}`} />} />
          <Bar dataKey="count" name="Readings" radius={[4, 4, 0, 0]}>
            {bins.map(bin => (
              <Cell key={bin.center} fill={ZONE_COLORS[bin.zone]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </VStack>
  );
}

// Day × hour heatmap revealing circadian patterns over the last week.
function RhythmView({ readings, normal, label, unit }: { readings: Reading[]; normal: Range | null; label: string; unit: string }) {
  const cells = useMemo(() => getRhythm(readings, normal), [readings, normal]);
  const [hovered, setHovered] = useState<(typeof cells)[number] | null>(null);
  const days = [...new Set(cells.map(c => c.day))];
  const min = Math.min(...cells.map(c => c.value));
  const max = Math.max(...cells.map(c => c.value));

  if (!cells.length) return <NoReadings what={`${label} this week`} hint="The rhythm map fills in as readings arrive over the week." />;
  return (
    <VStack gap={3}>
      <Text type="supporting" className="explorer__rhythm-caption">
        {hovered
          ? `${hovered.day} ${String(hovered.hour).padStart(2, '0')}:00 — ${hovered.value} ${unit} (${ZONE_LABELS[hovered.zone].toLowerCase()})`
          : 'Hover a cell to see the reading. Dots mark readings outside the normal range.'}
      </Text>
      <svg viewBox={`0 0 ${24 * 10 + 30} ${days.length * 10 + 12}`} className="explorer__rhythm" role="img" aria-label={`${label} by hour of day over the last week`}>
        {days.map((day, row) => (
          <text key={day} x={0} y={row * 10 + 7} className="explorer__rhythm-axis">{day}</text>
        ))}
        {HOURS.filter(h => h % 6 === 0).map(h => (
          <text key={h} x={30 + h * 10} y={days.length * 10 + 9} className="explorer__rhythm-axis">{String(h).padStart(2, '0')}h</text>
        ))}
        {cells.map(cell => {
          const row = days.indexOf(cell.day);
          return (
            <g key={cell.t} onPointerEnter={() => setHovered(cell)} onPointerLeave={() => setHovered(null)}>
              <rect x={30 + cell.hour * 10} y={row * 10} width={9} height={9} rx={1.5} fill={RHYTHM_RAMP[rampIndex(cell.value, min, max)]} className="explorer__rhythm-cell" />
              {cell.zone !== 'normal' && <circle cx={30 + cell.hour * 10 + 4.5} cy={row * 10 + 4.5} r={1.4} className="explorer__rhythm-flag" />}
            </g>
          );
        })}
      </svg>
      <HStack gap={2} vAlign="center">
        <Text type="supporting" hasTabularNumbers>{min} {unit}</Text>
        <HStack className="explorer__ramp" aria-hidden="true" />
        <Text type="supporting" hasTabularNumbers>{max} {unit}</Text>
      </HStack>
    </VStack>
  );
}

// Interactive multi-view chart for exploring any vital's history from D1.
export default function MetricExplorer({ vital, onVitalChange }: { vital: string; onVitalChange: (id: string) => void }) {
  const [view, setView] = useState<ExplorerView>('trend');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  const { defs, readings } = useHealthData();
  const meta: ExplorerVital = EXPLORER_VITALS.find(v => v.id === vital) ?? EXPLORER_VITALS[0];
  const def = defs.get(meta.id);
  const pairDef = meta.pair ? defs.get(meta.pair) : undefined;
  const decimals = def?.decimals ?? 0;
  const unit = def?.unit ?? '';
  const label = meta.pair ? 'Blood pressure' : (def?.label ?? meta.shortLabel);
  const normal = normalRange(def);
  const allReadings = readings.get(meta.id) ?? NO_READINGS;
  const pairReadings = meta.pair ? (readings.get(meta.pair) ?? NO_READINGS) : null;
  const inWindow = windowReadings(allReadings, timeWindow);
  const rows = buildTrendRows(allReadings, pairReadings, timeWindow, decimals);
  const summary = inWindow.length ? summarize(inWindow, normal, decimals) : null;
  const tableRows: TableRow[] = rows.map((r, i) => ({ id: i, time: formatTick(r.t, timeWindow), avg: r.value, low: r.range[0], high: r.range[1] })).reverse();
  const views: { value: ExplorerView; label: string; icon: typeof ChartBarIcon }[] = [
    { value: 'trend', label: 'Trend', icon: PresentationChartLineIcon },
    { value: 'range', label: 'Range', icon: ChartBarIcon },
    ...(normal ? [{ value: 'zones' as const, label: 'Zones', icon: Squares2X2Icon }] : []),
    { value: 'rhythm', label: 'Rhythm', icon: ClockIcon },
    { value: 'table', label: 'Table', icon: TableCellsIcon },
  ];
  const activeView: ExplorerView = view === 'zones' && !normal ? 'trend' : view;
  const isPaired = Boolean(pairReadings?.length);

  // Formats tooltip timestamps at the active granularity.
  function formatTooltipLabel(t: string | number) {
    return new Date(Number(t)).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', month: 'short', day: 'numeric' });
  }

  // Renders the shared x/y axes, grid and normal band.
  function renderAxes() {
    return [
      <CartesianGrid key="grid" vertical={false} stroke={GRID_STROKE} />,
      <XAxis key="x" dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={t => formatTick(t, timeWindow)} tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} />,
      <YAxis key="y" tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} domain={['auto', 'auto']} />,
      normal && <ReferenceArea key="band" y1={normal[0]} y2={normal[1]} fill="var(--color-success)" fillOpacity={0.08} stroke="none" ifOverflow="hidden" />,
      <Tooltip key="tip" content={<ChartTooltip unit={unit} formatLabel={formatTooltipLabel} />} cursor={{ stroke: GRID_STROKE }} />,
    ];
  }

  // Draws the chart for the currently selected view.
  function renderView() {
    if (activeView === 'rhythm') return <RhythmView readings={allReadings} normal={normal} label={label} unit={unit} />;
    if (!inWindow.length) {
      return <NoReadings what={`${label} in ${WINDOW_LABELS[timeWindow]}`} hint={allReadings.length ? 'Try a longer time window.' : (def?.how_to_measure || undefined)} />;
    }
    if (activeView === 'zones' && normal) return <ZonesView readings={inWindow} normal={normal} unit={unit} decimals={decimals} />;
    if (activeView === 'table') {
      return (
        <VStack className="explorer__table" isScrollable>
          <Table<TableRow>
            data={tableRows}
            idKey="id"
            density="compact"
            isStriped
            columns={[
              { key: 'time', header: 'Time' },
              { key: 'avg', header: `Average (${unit})`, align: 'end' },
              { key: 'low', header: 'Low', align: 'end' },
              { key: 'high', header: 'High', align: 'end' },
            ]}
          />
        </VStack>
      );
    }
    return (
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ComposedChart data={rows} margin={CHART_MARGIN}>
          <defs>
            <linearGradient id={`fill-${meta.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={meta.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={meta.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {renderAxes()}
          {activeView === 'range' ? (
            <Area dataKey="range" name="Low–high" type="monotone" stroke="none" fill={meta.color} fillOpacity={0.22} isAnimationActive={false} />
          ) : (
            <Area dataKey="value" name={def?.label ?? label} type="monotone" stroke="none" fill={`url(#fill-${meta.id})`} isAnimationActive={false} legendType="none" tooltipType="none" />
          )}
          <Line dataKey="value" name={isPaired ? 'Systolic' : 'Average'} type="monotone" stroke={meta.color} strokeWidth={2} dot={rows.length < 3} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background-card)' }} animationDuration={700} />
          {isPaired && (
            <Line dataKey="secondary" name="Diastolic" type="monotone" stroke={PAIR_COLOR} strokeWidth={2} dot={rows.length < 3} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background-card)' }} animationDuration={700} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  return (
    <PanelCard title="Metric explorer" subtitle={`${label} · ${meta.source}`} icon={PresentationChartLineIcon} className="explorer">
      <TabList role="tablist" value={meta.id} onChange={v => onVitalChange(String(v))} hasDivider>
        {EXPLORER_VITALS.map(v => (
          <Tab key={v.id} value={v.id} label={v.pair ? 'Blood pressure' : (defs.get(v.id)?.label ?? v.shortLabel)} />
        ))}
      </TabList>

      <HStack gap={3} wrap="wrap" hAlign="between">
        <SegmentedControl label="Chart view" value={activeView} onChange={v => setView(v as ExplorerView)} size="sm">
          {views.map(v => (
            <SegmentedControlItem key={v.value} value={v.value} label={v.label} icon={<Icon icon={v.icon} size="sm" />} />
          ))}
        </SegmentedControl>
        <SegmentedControl
          label="Time window"
          value={activeView === 'rhythm' ? '7d' : timeWindow}
          onChange={v => setTimeWindow(v as TimeWindow)}
          size="sm"
          isDisabled={activeView === 'rhythm'}
          disabledMessage="Rhythm always shows the last 7 days">
          <SegmentedControlItem value="24h" label="24h" />
          <SegmentedControlItem value="7d" label="7 days" />
          <SegmentedControlItem value="30d" label="30 days" />
        </SegmentedControl>
      </HStack>

      {summary && (
        <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
          <VStack gap={0.5}>
            <Text type="supporting">Average</Text>
            <Text type="large" weight="semibold" hasTabularNumbers>{summary.mean} {unit}</Text>
          </VStack>
          <VStack gap={0.5}>
            <Text type="supporting">Lowest · highest</Text>
            <Text type="large" weight="semibold" hasTabularNumbers>{summary.min} – {summary.max}</Text>
          </VStack>
          {normal && (
            <VStack gap={0.5}>
              <Text type="supporting">Normal range</Text>
              <Text type="large" weight="semibold" hasTabularNumbers>{normal[0]}–{normal[1]} {unit}</Text>
            </VStack>
          )}
          {summary.inRange && (
            <VStack gap={1}>
              <Text type="supporting">Time in range · {summary.inRange.normal}%</Text>
              <ProgressBar label="Time in range" isLabelHidden value={summary.inRange.normal} variant={summary.inRange.normal >= 90 ? 'success' : 'warning'} />
            </VStack>
          )}
        </Grid>
      )}

      <StackItem key={`${meta.id}-${activeView}-${timeWindow}`} className="explorer__chart">
        {renderView()}
      </StackItem>

      {(activeView === 'trend' || activeView === 'range') && inWindow.length > 0 && (
        <HStack gap={5} wrap="wrap" vAlign="center">
          <HStack gap={2} vAlign="center">
            <HStack className="explorer__legend-line" style={{ background: meta.color }} aria-hidden="true" />
            <Text type="supporting">{isPaired ? (def?.label ?? 'Systolic') : activeView === 'range' ? 'Average with low–high band' : (def?.label ?? label)}</Text>
          </HStack>
          {isPaired && (
            <HStack gap={2} vAlign="center">
              <HStack className="explorer__legend-line" style={{ background: PAIR_COLOR }} aria-hidden="true" />
              <Text type="supporting">{pairDef?.label ?? 'Diastolic'}</Text>
            </HStack>
          )}
          {normal && (
            <HStack gap={2} vAlign="center">
              <HStack className="explorer__legend-band" aria-hidden="true" />
              <Text type="supporting">Normal range</Text>
            </HStack>
          )}
        </HStack>
      )}
    </PanelCard>
  );
}
