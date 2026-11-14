import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import './css/ChartTooltip.css';

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntry>;
  label?: string | number;
  unit?: string;
  formatLabel?: (label: string | number) => string;
}

// Formats a value or [min, max] range for display.
function formatValue(value: unknown, unit?: string) {
  const suffix = unit ? ` ${unit}` : '';
  if (Array.isArray(value)) return `${value[0]}–${value[1]}${suffix}`;
  return `${typeof value === 'number' ? value.toLocaleString() : String(value)}${suffix}`;
}

// Frosted Recharts tooltip with a colored key per series.
export default function ChartTooltip({ active, payload, label, unit, formatLabel }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <VStack gap={1.5} padding={3} className="chart-tooltip glass">
      {label !== undefined && <Text type="supporting">{formatLabel ? formatLabel(label) : label}</Text>}
      {payload.map(entry => (
        <HStack key={String(entry.dataKey ?? entry.name)} gap={2} vAlign="center">
          <HStack className="chart-tooltip__key" style={{ background: entry.color }} />
          <Text type="supporting">{entry.name}</Text>
          <Text type="label" hasTabularNumbers>{formatValue(entry.value, unit)}</Text>
        </HStack>
      ))}
    </VStack>
  );
}
