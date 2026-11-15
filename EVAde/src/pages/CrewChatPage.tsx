import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@astryxdesign/core/Badge';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import MessagePane from '../components/MessagePane';
import PageHeader from '../components/PageHeader';
import { useMission } from '../context/MissionContext';
import { api } from '../services/api';
import { roleLabel, type ChatThread, type StaffMember } from '../services/clinic';
import { useResource } from '../services/useResource';

export default function CrewChatPage() {
  const { staffId } = useParams();
  const { user } = useMission();
  const staff = useResource<StaffMember[]>('/staff');
  const threads = useResource<ChatThread[]>('/chat/threads');
  const [created, setCreated] = useState<{ staffId: string; id?: number; error?: string }>();
  const existing = threads.data?.find(thread => thread.staff_id === staffId);
  const started = created?.staffId === staffId ? created : undefined;
  const threadId = existing?.id ?? started?.id ?? null;
  const canStart = staff.data?.some(person => person.user_id === staffId) && !!threads.data;

  useEffect(() => {
    if (!staffId || !canStart || threadId) return;
    const controller = new AbortController();
    api<{ thread: { id: number } }>('/chat/threads', { method: 'POST', body: { staff_id: staffId }, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setCreated({ staffId, id: result.thread.id }); })
      .catch(() => { if (!controller.signal.aborted) setCreated({ staffId, error: 'The conversation could not be opened.' }); });
    return () => controller.abort();
  }, [staffId, canStart, threadId]);

  return (
    <VStack gap={6} padding={6}>
      <PageHeader eyebrow="Private line" title="Message the team" description="Choose a flight surgeon, therapist, or admin. Only that person can read the conversation." />
      {(staff.error || threads.error || started?.error) && <Text role="alert">{staff.error || threads.error || started?.error}</Text>}
      <Grid columns={{ minWidth: 280, max: 2 }} gap={4}>
        <VStack gap={2}>
          {(staff.data ?? []).map(person => {
            const thread = threads.data?.find(item => item.staff_id === person.user_id);
            return (
              <ClickableCard key={person.user_id} label={`Message ${person.display_name}`} href={`/chat/${person.user_id}`} padding={4}>
                <VStack gap={1}>
                  <Text type="label">{person.full_name || person.display_name}</Text>
                  <Text type="supporting">{roleLabel(person.role)}{person.display_name && person.full_name ? ` · ${person.display_name}` : ''}</Text>
                  {thread && thread.unread > 0 && <Badge variant="purple" label={`${thread.unread} new`} />}
                </VStack>
              </ClickableCard>
            );
          })}
          {staff.data && !staff.data.length && <Text type="supporting">No staff accounts are in the directory yet.</Text>}
        </VStack>
        <MessagePane threadId={threadId} selfId={user.user_id} empty="Choose someone on the team to start a conversation." />
      </Grid>
    </VStack>
  );
}
