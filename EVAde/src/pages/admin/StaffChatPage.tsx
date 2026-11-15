import { useOutletContext, useParams } from 'react-router-dom';
import { Badge } from '@astryxdesign/core/Badge';
import { List, ListItem } from '@astryxdesign/core/List';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Grid } from '@astryxdesign/core/Grid';
import { VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import MessagePane from '../../components/MessagePane';
import PageHeader from '../../components/PageHeader';
import type { ChatThread } from '../../services/clinic';
import type { SessionUser } from '../../services/api';
import { useResource } from '../../services/useResource';

export default function StaffChatPage() {
  const { threadId } = useParams();
  const self = useOutletContext<SessionUser>();
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
          <List hasDividers>
            {data.map(thread => (
              <ListItem
                key={thread.id}
                label={thread.astronaut_name}
                description={thread.last_body || 'No messages yet'}
                href={`/admin/chat/${thread.id}`}
                endContent={thread.unread > 0 ? <Badge variant="purple" label={`${thread.unread} new`} /> : undefined}
              />
            ))}
          </List>
          <MessagePane threadId={Number.isInteger(selected) && selected > 0 ? selected : data[0]?.id ?? null} selfId={self.user_id} empty="Select a conversation." />
        </Grid>
      )}
    </VStack>
  );
}
