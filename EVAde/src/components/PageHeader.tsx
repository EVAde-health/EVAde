import type { ReactNode } from 'react';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import './css/PageHeader.css';

interface PageHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: string;
  actions?: ReactNode;
}

// Page title block with eyebrow, description and right-side actions.
export default function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <HStack as="header" gap={4} wrap="wrap" vAlign="end" className="page-header">
      <StackItem size="fill">
        <VStack gap={1.5}>
          {eyebrow && <Text type="label" color="accent" className="page-header__eyebrow">{eyebrow}</Text>}
          <Heading level={1} className="page-header__title">{title}</Heading>
          {description && <Text color="secondary">{description}</Text>}
        </VStack>
      </StackItem>
      {actions && <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack>}
    </HStack>
  );
}
