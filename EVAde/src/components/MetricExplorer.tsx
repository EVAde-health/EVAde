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
import {
  EXPLORER_VITALS,
  VITALS,
  formatTick,
  getHistogram,
  getRhythm,
  getTrend,
  getZoneShare,
  windowReadings,
  type TimeWindow,
  type VitalId,
} from '../data/vitals';
import { ZONE_COLORS, type Zone } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import PanelCard from './PanelCard';
import './css/MetricExplorer.css';

type ExplorerView = 'trend' | 'range' | 'zones' | 'rhythm' | 'table';

const CHART_HEIGHT = 300;
const ZONE_LABELS: Record<Zone, string> = { low: 'Below range', normal: 'In range', high: 'Above range' };
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const RHYTHM_RAMP = ['var(--color-data-blue-1)', 'var(--color-data-blue-2)', 'var(--color-data-blue-3)', 'var(--color-data-blue-4)', 'var(--color-data-blue-5)'];

interface TableRow extends Record<string, unknown> {
  id: number;
  time: string;
  avg: number;
  low: number;
  high: number;
}

// Merges diastolic into systolic trend rows so BP shows both lines.
function buildTrendRows(vital: VitalId, timeWindow: TimeWindow) {
  const trend = getTrend(vital, timeWindow);
  if (vital !== 'systolic') return trend.map(p => ({ ...p, secondary: undefined as number | undefined }));
  const diastolic = getTrend('diastolic', timeWindow);
  return trend.map((p, i) => ({ ...p, secondary: diastolic[i]?.value }));
}

// Mean, min, max and time-in-range summary for a window.
function summarize(vital: VitalId, timeWindow: TimeWindow) {
  const values = windowReadings(vital, timeWindow).map(r => r.value);
  const decimals = VITALS[vital].decimals;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean: mean.toFixed(decimals),
    min: Math.min(...values).toFixed(decimals),
    max: Math.max(...values).toFixed(decimals),
    inRange: getZoneShare(vital, timeWindow),
  };
}

// Maps a value to a five-step sequential ramp index.
function rampIndex(value: number, min: number, max: number) {
  return Math.min(4, Math.floor(((value - min) / (max - min || 1)) * 5));
}

// Time-in-range bar plus colored histogram of readings.
function ZonesView({ vital, timeWindow }: { vital: VitalId; timeWindow: TimeWindow }) {
  const def = VITALS[vital];
  const share = getZoneShare(vital, timeWindow);
  const bins = getHistogram(vital, timeWindow);

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
          <XAxis dataKey="center" tick={AXIS_TICK} axisLine={false} tickLine={false} unit={` ${def.unit}`} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'var(--color-tint-hover)' }} content={<ChartTooltip unit="readings" formatLabel={l => `${l} ${def.unit}`} />} />
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

// Day × hour heatmap revealing circadian patterns.
function RhythmView({ vital }: { vital: VitalId }) {
  const def = VITALS[vital];
  const cells = useMemo(() => getRhythm(vital), [vital]);
  const [hovered, setHovered] = useState<(typeof cells)[number] | null>(null);
  const days = [...new Set(cells.map(c => c.day))];
  const min = Math.min(...cells.map(c => c.value));
  const max = Math.max(...cells.map(c => c.value));

  return (
    <VStack gap={3}>
      <Text type="supporting" className="explorer__rhythm-caption">
        {hovered
          ? `${hovered.day} ${String(hovered.hour).padStart(2, '0')}:00 — ${hovered.value} ${def.unit} (${ZONE_LABELS[hovered.zone].toLowerCase()})`
          : 'Hover a cell to see the reading. Dots mark readings outside the normal range.'}
      </Text>
      <svg viewBox={`0 0 ${24 * 10 + 30} ${days.length * 10 + 12}`} className="explorer__rhythm" role="img" aria-label={`${def.label} by hour of day over the last week`}>
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
        <Text type="supporting" hasTabularNumbers>{min} {def.unit}</Text>
        <HStack className="explorer__ramp" />
        <Text type="supporting" hasTabularNumbers>{max} {def.unit}</Text>
      </HStack>
    </VStack>
  );
}

// Interactive multi-view chart for exploring any vital's history.
export default function MetricExplorer({ vital, onVitalChange }: { vital: VitalId; onVitalChange: (id: VitalId) => void }) {
  const [view, setView] = useState<ExplorerView>('trend');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  const def = VITALS[vital];
  const isBloodPressure = vital === 'systolic';
  const rows = useMemo(() => buildTrendRows(vital, timeWindow), [vital, timeWindow]);
  const summary = useMemo(() => summarize(vital, timeWindow), [vital, timeWindow]);
  const tableRows = useMemo<TableRow[]>(
    () => rows.map((r, i) => ({ id: i, time: formatTick(r.t, timeWindow), avg: r.value, low: r.range[0], high: r.range[1] })).reverse(),
    [rows, timeWindow],
  );

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
      <ReferenceArea key="band" y1={def.normal[0]} y2={def.normal[1]} fill="var(--color-success)" fillOpacity={0.08} stroke="none" ifOverflow="hidden" />,
      <Tooltip key="tip" content={<ChartTooltip unit={def.unit} formatLabel={formatTooltipLabel} />} cursor={{ stroke: GRID_STROKE }} />,
    ];
  }

  // Draws the chart for the currently selected view.
  function renderView() {
    if (view === 'zones') return <ZonesView vital={vital} timeWindow={timeWindow} />;
    if (view === 'rhythm') return <RhythmView vital={vital} />;
    if (view === 'table') {
      return (
        <VStack className="explorer__table" isScrollable>
          <Table<TableRow>
            data={tableRows}
            idKey="id"
            density="compact"
            isStriped
            columns={[
              { key: 'time', header: 'Time' },
              { key: 'avg', header: `Average (${def.unit})`, align: 'end' },
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
            <linearGradient id={`fill-${vital}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={def.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={def.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {renderAxes()}
          {view === 'range' ? (
            <Area dataKey="range" name="Low–high" type="monotone" stroke="none" fill={def.color} fillOpacity={0.22} isAnimationActive={false} />
          ) : (
            <Area dataKey="value" name={isBloodPressure ? 'Systolic' : def.label} type="monotone" stroke="none" fill={`url(#fill-${vital})`} isAnimationActive={false} legendType="none" tooltipType="none" />
          )}
          <Line dataKey="value" name={isBloodPressure ? 'Systolic' : 'Average'} type="monotone" stroke={def.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background-card)' }} animationDuration={700} />
          {isBloodPressure && (
            <Line dataKey="secondary" name="Diastolic" type="monotone" stroke={VITALS.diastolic.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--color-background-card)' }} animationDuration={700} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  return (
    <PanelCard title="Metric explorer" subtitle={`${def.label} · ${def.source}`} icon={PresentationChartLineIcon} className="explorer">
      <TabList role="tablist" value={vital} onChange={v => onVitalChange(v as VitalId)} hasDivider>
        {EXPLORER_VITALS.map(id => (
          <Tab key={id} value={id} label={id === 'systolic' ? 'Blood pressure' : VITALS[id].label} />
        ))}
      </TabList>

      <HStack gap={3} wrap="wrap" hAlign="between">
        <SegmentedControl label="Chart view" value={view} onChange={v => setView(v as ExplorerView)} size="sm">
          <SegmentedControlItem value="trend" label="Trend" icon={<Icon icon={PresentationChartLineIcon} size="sm" />} />
          <SegmentedControlItem value="range" label="Range" icon={<Icon icon={ChartBarIcon} size="sm" />} />
          <SegmentedControlItem value="zones" label="Zones" icon={<Icon icon={Squares2X2Icon} size="sm" />} />
          <SegmentedControlItem value="rhythm" label="Rhythm" icon={<Icon icon={ClockIcon} size="sm" />} />
          <SegmentedControlItem value="table" label="Table" icon={<Icon icon={TableCellsIcon} size="sm" />} />
        </SegmentedControl>
        <SegmentedControl
          label="Time timeWindow"
          value={view === 'rhythm' ? '7d' : timeWindow}
          onChange={v => setTimeWindow(v as TimeWindow)}
          size="sm"
          isDisabled={view === 'rhythm'}
          disabledMessage="Rhythm always shows the last 7 days">
          <SegmentedControlItem value="24h" label="24h" />
          <SegmentedControlItem value="7d" label="7 days" />
          <SegmentedControlItem value="30d" label="30 days" />
        </SegmentedControl>
      </HStack>

      <Grid columns={{ minWidth: 220, max: 4 }} gap={4}>
        <VStack gap={0.5}>
          <Text type="supporting">Average</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{summary.mean} {def.unit}</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Lowest · highest</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{summary.min} – {summary.max}</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Normal range</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{def.normal[0]}–{def.normal[1]} {def.unit}</Text>
        </VStack>
        <VStack gap={1}>
          <Text type="supporting">Time in range · {summary.inRange.normal}%</Text>
          <ProgressBar label="Time in range" isLabelHidden value={summary.inRange.normal} variant={summary.inRange.normal >= 90 ? 'success' : 'warning'} />
        </VStack>
      </Grid>

      <StackItem key={`${vital}-${view}-${timeWindow}`} className="explorer__chart">
        {renderView()}
      </StackItem>

      {(view === 'trend' || view === 'range') && (
        <HStack gap={5} wrap="wrap" vAlign="center">
          <HStack gap={2} vAlign="center">
            <HStack className="explorer__legend-line" style={{ background: def.color }} />
            <Text type="supporting">{isBloodPressure ? 'Systolic' : view === 'range' ? 'Average with low–high band' : def.label}</Text>
          </HStack>
          {isBloodPressure && (
            <HStack gap={2} vAlign="center">
              <HStack className="explorer__legend-line" style={{ background: VITALS.diastolic.color }} />
              <Text type="supporting">Diastolic</Text>
            </HStack>
          )}
          <HStack gap={2} vAlign="center">
            <HStack className="explorer__legend-band" />
            <Text type="supporting">Normal range</Text>
          </HStack>
        </HStack>
      )}
    </PanelCard>
  );
}
