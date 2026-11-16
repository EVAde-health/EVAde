import type { CSSProperties } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';

// Placeholder shaped like a crew card (avatar, goal ring, three vitals, progress bars) with a wave shimmer.
export function CrewCardSkeleton({ index }: { index: number }) {
  const wave = index * 6;
  return (
    <StackItem className="crew-card crew-card--loading" style={{ '--i': index } as CSSProperties} aria-hidden="true">
      <Card padding={4} height="100%">
        <VStack gap={3}>
          <HStack gap={3} vAlign="center">
            <Skeleton width={40} height={40} radius="rounded" index={wave} />
            <StackItem size="fill">
              <VStack gap={1.5}>
                <Skeleton width="70%" height={14} radius={1} index={wave + 1} />
                <Skeleton width="45%" height={12} radius={1} index={wave + 2} />
              </VStack>
            </StackItem>
            <Skeleton width={52} height={52} radius="rounded" index={wave + 3} />
          </HStack>
          <Skeleton width={96} height={22} radius="rounded" index={wave + 2} />
          <Grid columns={3} gap={2}>
            {[0, 1, 2].map(tile => <Skeleton key={tile} height={52} radius={2} index={wave + 3 + tile} />)}
          </Grid>
          <VStack gap={2}>
            {[0, 1, 2].map(bar => <Skeleton key={bar} height={10} radius="rounded" index={wave + 4 + bar} />)}
          </VStack>
          <Skeleton width="80%" height={12} radius={1} index={wave + 5} />
        </VStack>
      </Card>
    </StackItem>
  );
}

// A grid of crew-card placeholders, announced once to screen readers.
export default function CrewGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <VStack gap={3} role="status" aria-label="Loading crew telemetry">
      <Grid columns={{ minWidth: 300, max: 4 }} gap={4}>
        {Array.from({ length: count }, (_, index) => <CrewCardSkeleton key={index} index={index} />)}
      </Grid>
    </VStack>
  );
}
