import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { ArrowDownRightIcon, ArrowUpRightIcon } from '@heroicons/react/20/solid';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { STATUS_STYLES, type HealthStatus } from '../data/status';
import { stagger } from '../utils/style';
import './css/VitalTile.css';

interface VitalTileProps {
  label: string;
  value: string;
  unit: string;
  status: HealthStatus;
  delta?: number;
  spark?: number[];
  source?: string;
  index?: number;
  isSelected?: boolean;
  onSelect?: () => void;
}

// Converts a number list into Recharts rows.
function toRows(values: number[]) {
  return values.map((v, i) => ({ i, v }));
}

// Color-coded vital reading with 48h sparkline; click to explore.
export default function VitalTile({ label, value, unit, status, delta, spark, source, index = 0, isSelected, onSelect }: VitalTileProps) {
  const style = STATUS_STYLES[status];

  return (
    <Card
      padding={4}
      className={`vital-tile vital-tile--${status} rise-in hover-lift ${isSelected ? 'vital-tile--selected' : ''}`}
      style={stagger(index)}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? isSelected : undefined}
      onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && onSelect?.()}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <HStack gap={2} vAlign="center">
            <StatusDot variant={style.dot} label={style.label} tooltip={style.label} isPulsing={status === 'critical'} />
            <Text type="label" color="secondary">{label}</Text>
          </HStack>
          <Text type="supporting">{style.label}</Text>
        </HStack>
        <HStack gap={1.5} vAlign="end">
          <Text type="display-3" hasTabularNumbers>{value}</Text>
          <Text type="supporting">{unit}</Text>
          {delta !== undefined && delta !== 0 && (
            <HStack gap={0.5} vAlign="center" className="vital-tile__delta">
              <Icon icon={delta > 0 ? ArrowUpRightIcon : ArrowDownRightIcon} size="xsm" color="secondary" />
              <Text type="supporting" hasTabularNumbers>{Math.abs(delta)} vs 24h</Text>
            </HStack>
          )}
        </HStack>
        {spark && (
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={toRows(spark)} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line type="monotone" dataKey="v" stroke={style.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {source && <Text type="supporting">{source}</Text>}
      </VStack>
    </Card>
  );
}
