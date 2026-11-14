import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { useCountUp } from '../hooks/useCountUp';

// Big animated number with a caption, for hero stats.
export default function StatCounter({ value, suffix = '', label }: { value: number; suffix?: string; label: string }) {
  const current = useCountUp(value);

  return (
    <VStack gap={1}>
      <Text type="display-2" hasTabularNumbers className="text-gradient">
        {Math.round(current).toLocaleString()}
        {suffix}
      </Text>
      <Text type="supporting">{label}</Text>
    </VStack>
  );
}
