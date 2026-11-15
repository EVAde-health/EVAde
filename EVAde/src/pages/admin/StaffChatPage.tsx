import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge } from '@astryxdesign/core/Badge';
import { ClickableCard } from '@astryxdesign/core/ClickableCard';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import MessagePane from '../../components/MessagePane';
import PageHeader from '../../components/PageHeader';
import type { ChatThread } from '../../services/clinic';
import { api, type SessionUser } from '../../services/api';
import { useResource } from '../../services/useResource';

function useSelf() {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ user: SessionUser }>('/auth/me', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setUser(result.user); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return user;
}

export default function StaffChatPage() {
  const { threadId } = useParams();
  const self = useSelf();
  const { data, error, loading } = useResource<ChatThread[]>('/chat/threads');
  const selected = Number(threadId);
  return (
    <VStack gap={6} padding={6}>
      <PageHeader eyebrow="Flight surgeon console" title="Messages" description="Conversations astronauts opened with you. Another clinician cannot read them." />
      {loading && !data && <Text role="status">Loading conversations…</Text>}
      {error && <Text role="alert">{error}</Text>}
      {data && !data.length && <EmptyState title="No conversations yet" description="When an astronaut messages you, the thread appears here." />}
      {data && !!data.length && (
        <Grid columns={{ minWidth: 280, max: 2 }} gap={4}>
          <VStack gap={2}>
            {data.map(thread => (
              <ClickableCard key={thread.id} label={`Conversation with ${thread.astronaut_name}`} href={`/admin/chat/${thread.id}`} padding={4}>
                <VStack gap={1}>
                  <Text type="label">{thread.astronaut_name}</Text>
                  <Text type="supporting">{thread.last_body || 'No messages yet'}</Text>
                  {thread.unread > 0 && <Badge variant="purple" label={`${thread.unread} new`} />}
                </VStack>
              </ClickableCard>
            ))}
          </VStack>
          {self && <MessagePane threadId={Number.isInteger(selected) && selected > 0 ? selected : data[0]?.id ?? null} selfId={self.user_id} empty="Select a conversation." />}
        </Grid>
      )}
    </VStack>
  );
}
