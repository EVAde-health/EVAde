import type { ComponentType, ReactNode, SVGProps } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import StatusBadge from './StatusBadge';
import type { HealthStatus } from '../data/status';
import './css/PanelCard.css';

interface PanelCardProps {
  title: string;
  subtitle?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  status?: HealthStatus;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

// Dashboard widget shell: icon, title, status and content.
export default function PanelCard({ title, subtitle, icon, status, actions, className = '', children }: PanelCardProps) {
  return (
    <Card padding={5} className={`panel-card reveal-on-scroll ${status ? `panel-card--${status}` : ''} ${className}`}>
      <VStack gap={4}>
        <HStack gap={3} vAlign="start">
          {icon && (
            <HStack className="panel-card__icon" hAlign="center" vAlign="center">
              <Icon icon={icon} size="sm" />
            </HStack>
          )}
          <StackItem size="fill">
            <VStack gap={0.5}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Heading level={3}>{title}</Heading>
                {status && <StatusBadge status={status} />}
              </HStack>
              {subtitle && <Text type="supporting">{subtitle}</Text>}
            </VStack>
          </StackItem>
        </HStack>
        {actions && <HStack className="panel-card__actions">{actions}</HStack>}
        {children}
      </VStack>
    </Card>
  );
}
