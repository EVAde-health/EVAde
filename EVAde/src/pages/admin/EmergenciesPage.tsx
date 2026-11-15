import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { useToast } from '@astryxdesign/core/Toast';
import PageHeader from '../../components/PageHeader';
import { api } from '../../services/api';
import type { Emergency } from '../../services/clinic';
import { useResource } from '../../services/useResource';

function EmergencyCard({ item, onChange }: { item: Emergency; onChange: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useToast();

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      await api(path, { method: 'POST', body: body ?? {} });
      onChange();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The update failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card padding={5}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" wrap="wrap">
          <VStack gap={0.5}>
            <Text type="label">{item.display_name}</Text>
            <Timestamp value={item.created_at} />
          </VStack>
          <Badge variant={item.status === 'open' ? 'error' : item.status === 'acknowledged' ? 'warning' : 'success'} label={item.status} />
        </HStack>
        <Text>{item.message || 'Emergency control pressed, with no note.'}</Text>
        {item.status !== 'resolved' && (
          <VStack gap={2}>
            <TextArea label="Resolution note" isOptional value={note} onChange={setNote} />
            <HStack gap={2}>
              {item.status === 'open' && <Button label="Acknowledge" variant="secondary" isDisabled={busy} onClick={() => act(`/admin/emergencies/${item.id}/acknowledge`)} />}
              <Button label="Resolve" variant="primary" isLoading={busy} onClick={() => act(`/admin/emergencies/${item.id}/resolve`, { note: note.trim() || undefined })} />
              <Button label="Open record" variant="ghost" href={`/admin/astronauts/${item.user_id}`} />
            </HStack>
          </VStack>
        )}
        {item.resolution_note && <Text type="supporting">Resolution: {item.resolution_note}</Text>}
      </VStack>
    </Card>
  );
}

export default function EmergenciesPage() {
  const { data, error, loading, reload } = useResource<Emergency[]>('/admin/emergencies');
  const open = data?.filter(item => item.status !== 'resolved') ?? [];
  const resolved = data?.filter(item => item.status === 'resolved') ?? [];
  return (
    <VStack gap={6} padding={6}>
      <PageHeader eyebrow="Flight surgeon console" title="Emergencies" description="Raised from the astronaut emergency control. Acknowledge, then resolve when the crew member is safe." />
      {loading && !data && <Text role="status">Loading emergencies…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && !open.length && <EmptyState title="No open emergencies" description="New emergencies appear here and in the notification bell." />}
      {open.map(item => <EmergencyCard key={item.id} item={item} onChange={reload} />)}
      {!!resolved.length && (
        <VStack gap={3}>
          <Text type="label" color="secondary">Resolved</Text>
          {resolved.slice(0, 8).map(item => <EmergencyCard key={item.id} item={item} onChange={reload} />)}
        </VStack>
      )}
    </VStack>
  );
}
