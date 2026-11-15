import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { BoltIcon } from '@heroicons/react/24/outline';
import { BONE_DENSITY } from '../data/mission';
import { classify } from '../data/status';
import { AXIS_TICK, CHART_MARGIN, GRID_STROKE, SERIES, Y_AXIS_WIDTH } from './chartConfig';
import ChartTooltip from './ChartTooltip';
import PanelCard from './PanelCard';
import './css/BonePanel.css';

const CAUTION_LOSS = -4;

// Most recent measured hip and spine values.
function latestScan() {
  const measured = BONE_DENSITY.filter(w => w.hip !== null);
  return measured[measured.length - 1];
}

// Bone mineral density change from preflight baseline with projection.
export default function BonePanel() {
  const latest = latestScan();
  const final = BONE_DENSITY[BONE_DENSITY.length - 1];
  const status = classify(latest.hip ?? 0, [-3, 1], [-6, 1]);

  return (
    <PanelCard title="Bone density" subtitle="Ultrasound scans · % change from preflight" icon={BoltIcon} status={status}>
      <HStack gap={6} wrap="wrap">
        <VStack gap={0.5}>
          <Text type="supporting">Hip</Text>
          <Text type="display-3" hasTabularNumbers>{latest.hip}%</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Spine</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{latest.spine}%</Text>
        </VStack>
        <VStack gap={0.5}>
          <Text type="supporting">Projected at landing</Text>
          <Text type="large" weight="semibold" hasTabularNumbers>{final.projected}%</Text>
        </VStack>
      </HStack>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={BONE_DENSITY} margin={CHART_MARGIN}>
          <CartesianGrid vertical={false} stroke={GRID_STROKE} />
          <ReferenceArea y1={CAUTION_LOSS} y2={-10} fill="var(--color-warning)" fillOpacity={0.08} ifOverflow="hidden" />
          <XAxis dataKey="week" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={3} />
          <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={Y_AXIS_WIDTH} unit="%" domain={[-8, 1]} />
          <Tooltip content={<ChartTooltip unit="%" />} cursor={{ stroke: GRID_STROKE }} />
          <Line type="monotone" dataKey="hip" name="Hip" stroke={SERIES.primary} strokeWidth={2} dot={false} connectNulls={false} animationDuration={800} />
          <Line type="monotone" dataKey="spine" name="Spine" stroke={SERIES.tertiary} strokeWidth={2} dot={false} connectNulls={false} animationDuration={800} />
          <Line type="linear" dataKey="projected" name="Projection" stroke={SERIES.baseline} strokeWidth={2} strokeDasharray="5 4" dot={false} animationDuration={800} />
        </LineChart>
      </ResponsiveContainer>
      <HStack gap={4} wrap="wrap">
        <HStack gap={2} vAlign="center"><HStack className="bone-panel__key" style={{ background: SERIES.primary }} aria-hidden="true" /><Text type="supporting">Hip</Text></HStack>
        <HStack gap={2} vAlign="center"><HStack className="bone-panel__key" style={{ background: SERIES.tertiary }} aria-hidden="true" /><Text type="supporting">Spine</Text></HStack>
        <HStack gap={2} vAlign="center"><HStack className="bone-panel__key bone-panel__key--dashed" aria-hidden="true" /><Text type="supporting">Projection</Text></HStack>
        <HStack gap={2} vAlign="center"><HStack className="bone-panel__band" aria-hidden="true" /><Text type="supporting">Loss beyond 4%</Text></HStack>
      </HStack>
    </PanelCard>
  );
}
