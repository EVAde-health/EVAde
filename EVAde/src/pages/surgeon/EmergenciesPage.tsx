import { useState } from 'react';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Dialog } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { useToast } from '@astryxdesign/core/Toast';
import { Avatar } from '@astryxdesign/core/Avatar';
import PageHeader from '../../components/PageHeader';
import { useSurgeon } from '../../context/SurgeonContext';
import { usePoll } from '../../hooks/usePoll';
import { acknowledgeEmergency, hasTimestamp, personName, resolveEmergency, responseRows, type Emergency } from '../../services/surgeon';

type Filter = 'active' | 'resolved' | 'all';

function minutesBetween(a: string | null, b: string | null) {
  if (!hasTimestamp(a) || !hasTimestamp(b)) return null;
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
}

export default function EmergenciesPage() {
  const { refreshNotifications } = useSurgeon();
  const [filter, setFilter] = useState<Filter>('active');
  const { data, error, loading, reload } = usePoll<Emergency[]>('/admin/emergencies', 5000);
  const [resolving, setResolving] = useState<Emergency | null>(null);
  const showToast = useToast();
  const rows = responseRows(data).filter(row => Number.isInteger(row.id) && (filter === 'all' || (filter === 'active' ? row.status !== 'resolved' : row.status === 'resolved')));

  async function acknowledge(row: Emergency) {
    try {
      const result = await acknowledgeEmergency(row.id);
      showToast({ body: result.claimed ? 'You are responding.' : result.emergency?.acknowledged_by_name
        ? `${result.emergency.acknowledged_by_name} is already on it.` : 'Emergency updated. Check the queue for the current status.' });
      reload();
      refreshNotifications();
    } catch (reason) {
      showToast({ body: reason instanceof Error ? reason.message : 'Could not acknowledge.' });
    }
  }

  return (
    <VStack gap={5} padding={6} className="surgeon-page">
      <PageHeader eyebrow="Flight surgeon console" title="Emergencies"
        description="Open → acknowledged → resolved. Every surgeon sees the same queue, updated every few seconds." />
      <SegmentedControl label="Show" value={filter} onChange={value => setFilter(value as Filter)} size="sm">
        <SegmentedControlItem value="active" label="Active" />
        <SegmentedControlItem value="resolved" label="History" />
        <SegmentedControlItem value="all" label="All" />
      </SegmentedControl>
      {error && <Text role="alert">{error}</Text>}
      {loading && !data && <Text role="status">Loading…</Text>}
      {data && !rows.length && (
        <EmptyState title={filter === 'active' ? 'No active emergencies' : 'Nothing here yet'}
          description={filter === 'active' ? 'When an astronaut holds the emergency button, it appears here and as a red banner on every page.' : 'Resolved emergencies are kept as history.'} />
      )}
      {!!rows.length && (
        <Card padding={2}>
          <List hasDividers>
            {rows.map((row, index) => {
              const ackMin = minutesBetween(row.created_at, row.acknowledged_at);
              const totalMin = minutesBetween(row.created_at, row.resolved_at);
              return (
                <div key={row.id} className="rise-in" style={{ ['--i' as string]: Math.min(index, 10) }}>
                  <ListItem
                    align="start"
                    startContent={<Avatar name={personName({ display_name: row.display_name ?? '?', full_name: row.full_name })} />}
                    label={
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text weight="semibold">{personName({ display_name: row.display_name ?? 'Astronaut', full_name: row.full_name })}</Text>
                        {row.status === 'open' ? <Badge variant="error" label="Open" /> : row.status === 'acknowledged'
                          ? <Badge variant="warning" label="Acknowledged" /> : row.status === 'resolved'
                            ? <Badge variant="success" label="Resolved" /> : <Text type="supporting">Status unavailable</Text>}
                      </HStack>
                    }
                    description={
                      <VStack gap={0.5}>
                        <Text>{row.message || 'Emergency button pressed (no note).'}</Text>
                        <Text type="supporting">
                          {hasTimestamp(row.created_at) ? `Raised ${new Date(row.created_at).toLocaleString()}` : 'Time unavailable'}
                          {row.acknowledged_by_name ? ` · ${row.acknowledged_by_name} acknowledged${ackMin != null ? ` after ${ackMin} min` : ''}` : ''}
                          {row.resolved_by_name ? ` · resolved by ${row.resolved_by_name}${totalMin != null ? ` (${totalMin} min total)` : ''}` : ''}
                        </Text>
                        {row.resolution_note && <Text type="supporting">Note: {row.resolution_note}</Text>}
                      </VStack>
                    }
                    endContent={
                      <HStack gap={2} wrap="wrap">
                        {row.user_id && <Button label="Record" size="sm" variant="ghost" href={`/admin/astronauts/${encodeURIComponent(row.user_id)}/vitals`} />}
                        {row.status === 'open' && <Button label="Acknowledge" size="sm" variant="primary" onClick={() => acknowledge(row)} />}
                        {(row.status === 'open' || row.status === 'acknowledged') && <Button label="Resolve" size="sm" variant="secondary" onClick={() => setResolving(row)} />}
                      </HStack>
                    }
                  />
                </div>
              );
            })}
          </List>
        </Card>
      )}
      {resolving && <ResolveDialog row={resolving} onClose={() => setResolving(null)} onDone={() => { reload(); refreshNotifications(); }} />}
    </VStack>
  );
}

function ResolveDialog({ row, onClose, onDone }: { row: Emergency; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const showToast = useToast();
  async function save() {
    setSaving(true);
    try {
      await resolveEmergency(row.id, note);
      showToast({ body: 'Emergency resolved. The astronaut has been told.' });
      onDone();
      onClose();
    } catch (reason) {
      showToast({ body: reason instanceof Error ? reason.message : 'Could not resolve.' });
      setSaving(false);
    }
  }
  return (
    <Dialog isOpen onOpenChange={open => { if (!open) onClose(); }} purpose="form" width={460}>
      <VStack gap={4} padding={2}>
        <Heading level={2}>Resolve emergency</Heading>
        <Text color="secondary">{row.message || 'Emergency button pressed.'}</Text>
        <TextArea label="Resolution note" isOptional value={note} onChange={setNote} maxLength={500} placeholder="What happened and what was done." />
        <HStack gap={2} hAlign="end">
          <Button label="Cancel" variant="secondary" onClick={onClose} isDisabled={saving} />
          <Button label="Resolve" variant="primary" onClick={save} isLoading={saving} />
        </HStack>
      </VStack>
    </Dialog>
  );
}
