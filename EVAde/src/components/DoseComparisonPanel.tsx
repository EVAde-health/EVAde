import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { Link } from '@astryxdesign/core/Link';
import { Slider } from '@astryxdesign/core/Slider';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { ChartBarIcon, ChartBarSquareIcon, PresentationChartLineIcon, ShieldExclamationIcon } from '@heroicons/react/24/outline';
import {
  CAREER_LIMIT_MSV,
  DESTINATIONS,
  LIMITS_SOURCE,
  MARS_REFERENCE_MISSION,
  careerLimitShare,
  cumulativeDoseMsv,
  doseCurves,
  doseStatus,
  type DestinationId,
} from '../data/research';
import { AXIS_TICK, BAR_CURSOR, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import EvidenceToken from './EvidenceToken';
import PanelCard from './PanelCard';
import StatusBadge from './StatusBadge';
import './css/DoseComparisonPanel.css';

type DoseView = 'daily' | 'total' | 'curve';

const VIEWS = [
  { value: 'daily', label: 'Per day', icon: ChartBarIcon },
  { value: 'total', label: 'Mission total', icon: ChartBarSquareIcon },
  { value: 'curve', label: 'Over time', icon: PresentationChartLineIcon },
] as const;

const CURVE_LINES: { id: DestinationId; color: string }[] = [
  { id: 'iss', color: SERIES.primary },
  { id: 'marsSurface', color: SERIES.tertiary },
  { id: 'artemis', color: SERIES.quaternary },
  { id: 'marsTransit', color: SERIES.secondary },
];

const LIMIT_LINE = { stroke: 'var(--color-error)', strokeDasharray: '5 4' };
const LIMIT_LABEL = { value: `${CAREER_LIMIT_MSV} mSv career limit`, position: 'insideTopRight' as const, fill: 'var(--color-text-secondary)', fontSize: 11 };

// Display name of one destination.
function destinationLabel(id: DestinationId) {
  return DESTINATIONS.find(d => d.id === id)?.label ?? id;
}

// Research radiation by destination: daily rate, mission total and dose curves.
export default function DoseComparisonPanel() {
  const [view, setView] = useState<DoseView>('total');
  const [days, setDays] = useState(180);
  const totals = DESTINATIONS.map(d => ({ id: d.id, label: d.label, dose: cumulativeDoseMsv(d.id, days) }));
  const transitDose = cumulativeDoseMsv('marsTransit', days);
  const curves = doseCurves(days, Math.max(5, Math.round(days / 30)));

  return (
    <PanelCard
      title="Radiation by destination"
      subtitle="Published dose rates · millisieverts (mSv)"
      icon={ShieldExclamationIcon}
      status={doseStatus(transitDose)}
      className="dose-panel">
      <HStack gap={3} wrap="wrap" vAlign="center">
        <SegmentedControl label="Radiation view" value={view} onChange={v => setView(v as DoseView)} size="sm">
          {VIEWS.map(v => (
            <SegmentedControlItem key={v.value} value={v.value} label={v.label} icon={<Icon icon={v.icon} size="sm" />} />
          ))}
        </SegmentedControl>
      </HStack>

      {view !== 'daily' && (
        <Slider
          label="Mission length"
          value={days}
          onChange={(value: number) => setDays(value)}
          min={30}
          max={900}
          step={10}
          valueDisplay="text"
          formatValue={value => `${value} days`}
          marks={[{ value: 180, label: '6 months' }, { value: 520, label: 'Mars-500' }, { value: 860, label: 'Mars mission' }]}
        />
      )}

      {view === 'daily' && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={DESTINATIONS.map(d => ({ label: d.label, rate: d.mSvPerDay }))} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={116} />
            <Tooltip content={<ChartTooltip unit="mSv/day" />} cursor={BAR_CURSOR} />
            <Bar dataKey="rate" name="Dose per day" fill={SERIES.primary} radius={[0, 6, 6, 0]} animationDuration={700} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {view === 'total' && (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={totals} layout="vertical" margin={CHART_MARGIN}>
            <CartesianGrid horizontal={false} stroke={GRID_STROKE} />
            <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} domain={[0, (max: number) => Math.max(max, CAREER_LIMIT_MSV * 1.1)]} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={116} />
            <Tooltip content={<ChartTooltip unit="mSv" />} cursor={BAR_CURSOR} />
            <ReferenceLine x={CAREER_LIMIT_MSV} {...LIMIT_LINE} label={LIMIT_LABEL} />
            <Bar dataKey="dose" name={`After ${days} days`} fill={SERIES.secondary} radius={[0, 6, 6, 0]} animationDuration={700} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {view === 'curve' && (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={curves} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={24} unit=" d" />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} />
              <Tooltip content={<ChartTooltip unit="mSv" formatLabel={label => `Day ${label}`} />} cursor={{ stroke: GRID_STROKE }} />
              <ReferenceLine y={CAREER_LIMIT_MSV} {...LIMIT_LINE} label={LIMIT_LABEL} />
              {CURVE_LINES.map(line => (
                <Line key={line.id} type="linear" dataKey={line.id} name={destinationLabel(line.id)} stroke={line.color} strokeWidth={2} dot={false} animationDuration={800} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <HStack gap={4} wrap="wrap">
            {CURVE_LINES.map(line => (
              <HStack key={line.id} gap={2} vAlign="center">
                <HStack className="dose-panel__key" style={{ background: line.color }} aria-hidden="true" />
                <Text type="supporting">{destinationLabel(line.id)}</Text>
              </HStack>
            ))}
          </HStack>
        </>
      )}

      {view === 'daily' ? (
        <List hasDividers edge="flush">
          {DESTINATIONS.map(d => (
            <ListItem
              key={d.id}
              label={d.label}
              description={<Link href={d.source} isExternalLink>{d.range ? `${d.range[0]}–${d.range[1]} mSv/day measured` : 'Source'}</Link>}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Text weight="semibold" hasTabularNumbers>{d.mSvPerDay} mSv/day</Text>
                  <EvidenceToken evidence={d.evidence} />
                </HStack>
              }
            />
          ))}
        </List>
      ) : (
        <List hasDividers edge="flush">
          {totals.filter(t => t.id !== 'earth').map(t => (
            <ListItem
              key={t.id}
              label={t.label}
              description={`${careerLimitShare(t.dose)}% of NASA’s career limit`}
              endContent={
                <HStack gap={2} vAlign="center">
                  <Text weight="semibold" hasTabularNumbers>{t.dose} mSv</Text>
                  <StatusBadge status={doseStatus(t.dose)} />
                </HStack>
              }
            />
          ))}
        </List>
      )}

      <VStack gap={1}>
        <Text type="supporting">
          A full Mars mission ({MARS_REFERENCE_MISSION.profile}) comes to about {MARS_REFERENCE_MISSION.totalMsv.toLocaleString()} mSv,{' '}
          {Math.round((MARS_REFERENCE_MISSION.totalMsv / CAREER_LIMIT_MSV) * 10) / 10}× NASA’s limit.
        </Text>
        <Text type="supporting">
          <Link href={LIMITS_SOURCE} isExternalLink>NASA radiation limits</Link> · <Link href={MARS_REFERENCE_MISSION.source} isExternalLink>Mars mission estimate</Link>
        </Text>
      </VStack>
    </PanelCard>
  );
}
