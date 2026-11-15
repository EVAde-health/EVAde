import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Icon } from '@astryxdesign/core/Icon';
import { Popover } from '@astryxdesign/core/Popover';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { BellAlertIcon } from '@heroicons/react/24/outline';
import { api } from '../services/api';
import type { Emergency } from '../services/clinic';
import { useToast } from '@astryxdesign/core/Toast';
import './css/Clinic.css';

export interface Notifications {
  emergencies: Emergency[];
  open_count: number;
  acknowledged_count: number;
  unread_messages: number;
}

export default function NotificationBell({ data, reload }: { data?: Notifications; reload: () => void }) {
  const showToast = useToast();
  const count = (data?.open_count ?? 0) + (data?.unread_messages ?? 0);
  async function acknowledge(id: number) {
    try {
      await api(`/admin/emergencies/${id}/acknowledge`, { method: 'POST', body: {} });
      reload();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'Could not acknowledge.' });
    }
  }

  return (
    <Popover
      content={
        <VStack gap={3} padding={3} className="clinic-note">
          <HStack hAlign="between" vAlign="center">
            <Text type="label">Console alerts</Text>
            <Button label="Queue" size="sm" variant="ghost" href="/admin/emergencies" />
          </HStack>
          {data?.emergencies.length ? data.emergencies.map(item => (
            <VStack key={item.id} gap={1}>
              <HStack hAlign="between" vAlign="center">
                <Text weight="semibold">{item.display_name}</Text>
                <Badge variant={item.status === 'open' ? 'error' : 'warning'} label={item.status === 'open' ? 'Open' : 'Acknowledged'} />
              </HStack>
              <Text type="supporting">{item.message || 'Emergency control pressed.'}</Text>
              <Timestamp value={item.created_at} />
              {item.status === 'open' && <Button label="Acknowledge" size="sm" variant="secondary" onClick={() => acknowledge(item.id)} />}
            </VStack>
          )) : <Text type="supporting">No open emergencies.</Text>}
          {(data?.unread_messages ?? 0) > 0 && (
            <Button label={`${data?.unread_messages} unread messages`} variant="ghost" href="/admin/chat" />
          )}
        </VStack>
      }
    >
      <Button
        label={count ? `Notifications, ${count} waiting` : 'Notifications'}
        isIconOnly
        variant="ghost"
        icon={<Icon icon={BellAlertIcon} />}
        endContent={count > 0 ? <Badge variant="error" label={String(count)} /> : undefined}
      />
    </Popover>
  );
}
