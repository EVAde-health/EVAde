import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { BoltIcon } from '@heroicons/react/24/outline';
import { useHealthData } from '../context/HealthDataContext';
import { useMission } from '../context/MissionContext';
import { boneSeries, type BonePoint } from '../data/health';
import { classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import NoReadings from './NoReadings';
import PanelCard from './PanelCard';
import './css/BonePanel.css';

const CAUTION_LOSS = -4;
const LINES = [
  { key: 'hip', label: 'Hip', color: SERIES.primary },
  { key: 'spine', label: 'Spine', color: SERIES.tertiary },
  { key: 'overall', label: 'Whole body', color: SERIES.secondary },
] as const;

type LineKey = (typeof LINES)[number]['key'];

// Most recent measured value of one series.
function latestOf(points: BonePoint[], key: LineKey) {
  return [...points].reverse().find(p => p[key] !== null)?.[key] ?? null;
}

// Bone mineral density change from preflight baseline with projection.
export default function BonePanel() {
  const { readings } = useHealthData();
  const { user } = useMission();
  const { points, lead, projectedAtEnd } = boneSeries(readings, user);
  const lines = LINES.filter(line => points.some(p => p[line.key] !== null));
  const leadValue = lead ? latestOf(points, lead) : null;
  const status = leadValue === null ? undefined : classify(leadValue, [-3, 100], [-6, 100]);

  return (
    <PanelCard logMetric="bone_density_change_pct" title="Bone density" subtitle="Ultrasound scans · % change from preflight" icon={BoltIcon} status={status}>
      {!lead ? (
        <NoReadings what="Bone density scans" hint="Your weekly heel and hip ultrasound results will chart here." />
      ) : (
        <>
          <HStack gap={6} wrap="wrap">
            {lines.map((line, i) => (
              <VStack key={line.key} gap={0.5}>
                <Text type="supporting">{line.label}</Text>
                {i === 0
                  ? <Text type="display-3" hasTabularNumbers>{latestOf(points, line.key)}%</Text>
                  : <Text type="large" weight="semibold" hasTabularNumbers>{latestOf(points, line.key)}%</Text>}
              </VStack>
            ))}
            {projectedAtEnd !== null && (
              <VStack gap={0.5}>
                <Text type="supporting">Projected at landing</Text>
                <Text type="large" weight="semibold" hasTabularNumbers>{projectedAtEnd}%</Text>
              </VStack>
            )}
          </HStack>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={points} margin={CHART_MARGIN}>
              <CartesianGrid vertical={false} stroke={GRID_STROKE} />
              <ReferenceArea y1={CAUTION_LOSS} y2={-10} fill="var(--color-warning)" fillOpacity={0.08} ifOverflow="hidden" />
              <XAxis dataKey="week" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} unit="%" domain={['auto', 1]} />
              <Tooltip content={<ChartTooltip unit="%" />} cursor={{ stroke: GRID_STROKE }} />
              {lines.map(line => (
                <Line key={line.key} type="monotone" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2} dot={{ r: 4 }} connectNulls animationDuration={800} />
              ))}
              {projectedAtEnd !== null && (
                <Line type="linear" dataKey="projected" name="Projection" stroke={SERIES.baseline} strokeWidth={2} strokeDasharray="5 4" dot={false} animationDuration={800} />
              )}
            </LineChart>
          </ResponsiveContainer>
          <HStack gap={4} wrap="wrap">
            {lines.map(line => (
              <HStack key={line.key} gap={2} vAlign="center">
                <HStack className="bone-panel__key" style={{ background: line.color }} aria-hidden="true" />
                <Text type="supporting">{line.label}</Text>
              </HStack>
            ))}
            {projectedAtEnd !== null && (
              <HStack gap={2} vAlign="center">
                <HStack className="bone-panel__key bone-panel__key--dashed" aria-hidden="true" />
                <Text type="supporting">Projection</Text>
              </HStack>
            )}
            <HStack gap={2} vAlign="center">
              <HStack className="bone-panel__band" aria-hidden="true" />
              <Text type="supporting">Loss beyond 4%</Text>
            </HStack>
          </HStack>
        </>
      )}
    </PanelCard>
  );
}
