import { useEffect, useState } from 'react';
import { ChatMessage, ChatMessageBubble, ChatMessageMetadata } from '@astryxdesign/core/Chat';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Button } from '@astryxdesign/core/Button';
import { VStack } from '@astryxdesign/core/Stack';
import { useToast } from '@astryxdesign/core/Toast';
import { api } from '../services/api';
import type { ChatMessageRow } from '../services/clinic';
import { useResource } from '../services/useResource';
import './css/Clinic.css';

export default function MessagePane({ threadId, selfId, empty }: { threadId: number | null; selfId: string; empty: string }) {
  const { data, error, loading, reload } = useResource<{ messages: ChatMessageRow[] }>(threadId ? `/chat/threads/${threadId}/messages` : null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const showToast = useToast();

  useEffect(() => {
    if (!threadId) return;
    const timer = window.setInterval(reload, 8000);
    return () => window.clearInterval(timer);
  }, [threadId, reload]);

  async function send() {
    if (!threadId || !draft.trim()) return;
    setSending(true);
    try {
      await api(`/chat/threads/${threadId}/messages`, { method: 'POST', body: { body: draft.trim() } });
      setDraft('');
      reload();
    } catch (reason) {
      showToast({ body: reason instanceof Error ? reason.message : 'The message could not be sent.' });
    } finally {
      setSending(false);
    }
  }

  if (!threadId) return <Text type="supporting">{empty}</Text>;
  return (
    <VStack gap={3}>
      {loading && !data && <Text role="status">Loading messages…</Text>}
      {error && <Text role="alert">{error}</Text>}
      <VStack gap={3} className="clinic-chat-log">
        {data?.messages.length ? data.messages.map(message => (
          <ChatMessage key={message.id} sender={message.sender_id === selfId ? 'user' : 'assistant'} name={message.sender_name}>
            <ChatMessageBubble name={message.sender_name}>
              {message.body}
              <ChatMessageMetadata timestamp={new Date(message.created_at).toLocaleString()} />
            </ChatMessageBubble>
          </ChatMessage>
        )) : <Text type="supporting">{empty}</Text>}
      </VStack>
      <TextArea label="Message" isLabelHidden value={draft} onChange={setDraft} placeholder="Write a message" />
      <Button label="Send" variant="primary" onClick={send} isLoading={sending} isDisabled={!draft.trim()} />
    </VStack>
  );
}
