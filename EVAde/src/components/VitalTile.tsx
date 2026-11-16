import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Badge } from '@astryxdesign/core/Badge';
import { SparklesIcon } from '@heroicons/react/20/solid';
import { ArrowDownRightIcon, ArrowUpRightIcon } from '@heroicons/react/20/solid';
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts';
import { STATUS_STYLES, type HealthStatus } from '../data/status';
import { stagger } from '../utils/style';
import './css/VitalTile.css';

interface VitalTileProps {
  label: string;
  value: string;
  unit: string;
  status: HealthStatus | null;
  delta?: number;
  spark?: number[];
  source?: string;
  index?: number;
  isSelected?: boolean;
  /** Shows the "AI insight" badge. Only these tiles get onSelect on the dashboard. */
  hasAiInsight?: boolean;
  onSelect?: () => void;
}

// Converts a number list into Recharts rows.
function toRows(values: number[]) {
  return values.map((v, i) => ({ i, v }));
}

// Color-coded latest reading with sparkline; neutral when nothing is recorded.
export default function VitalTile({ label, value, unit, status, delta, spark, source, index = 0, isSelected, hasAiInsight, onSelect }: VitalTileProps) {
  const style = status ? STATUS_STYLES[status] : null;
  const hasReading = value !== '';

  return (
    <Card
      padding={4}
      className={`vital-tile vital-tile--${status ?? 'empty'} rise-in ${onSelect ? 'hover-lift vital-tile--clickable' : ''} ${isSelected ? 'vital-tile--selected' : ''}`}
      style={stagger(index)}
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? isSelected : undefined}
      aria-label={onSelect ? `${label}: open AI insight` : undefined}
      onKeyDown={event => (event.key === 'Enter' || event.key === ' ') && onSelect?.()}>
      <VStack gap={2}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <HStack gap={2} vAlign="center">
            {style && <StatusDot variant={style.dot} label={style.label} tooltip={style.label} isPulsing={status === 'critical'} />}
            <Text type="label" color="secondary">{label}</Text>
          </HStack>
          <Text type="supporting">{style ? style.label : hasReading ? 'No range set' : 'No readings yet'}</Text>
        </HStack>
        <HStack gap={1.5} vAlign="end">
          <Text type="display-3" hasTabularNumbers>{hasReading ? value : '—'}</Text>
          {hasReading && <Text type="supporting">{unit}</Text>}
          {delta !== undefined && delta !== 0 && (
            <HStack gap={0.5} vAlign="center" className="vital-tile__delta">
              <Icon icon={delta > 0 ? ArrowUpRightIcon : ArrowDownRightIcon} size="xsm" color="secondary" />
              <Text type="supporting" hasTabularNumbers>{Math.abs(delta)} vs previous</Text>
            </HStack>
          )}
        </HStack>
        {spark && spark.length > 1 && (
          <ResponsiveContainer width="100%" height={40}>
            <LineChart data={toRows(spark)} margin={{ top: 4, right: 0, left: 0, bottom: 4 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line type="monotone" dataKey="v" stroke={style?.color ?? 'var(--color-text-secondary)'} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
        {source && <Text type="supporting">{source}</Text>}
        {hasAiInsight && (
          <HStack gap={1} vAlign="center">
            <Badge variant="purple" label="AI insight" icon={<Icon icon={SparklesIcon} size="xsm" />} />
            <Text type="supporting">Tap to see the model</Text>
          </HStack>
        )}
      </VStack>
    </Card>
  );
}
