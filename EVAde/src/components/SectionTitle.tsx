import type { ReactNode } from 'react';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';

// Section heading with optional caption and trailing content.
export default function SectionTitle({ title, caption, end }: { title: string; caption?: string; end?: ReactNode }) {
  return (
    <HStack gap={3} vAlign="end" wrap="wrap" className="reveal-on-scroll">
      <StackItem size="fill">
        <VStack gap={0.5}>
          <Heading level={2}>{title}</Heading>
          {caption && <Text type="supporting">{caption}</Text>}
        </VStack>
      </StackItem>
      {end}
    </HStack>
  );
}
