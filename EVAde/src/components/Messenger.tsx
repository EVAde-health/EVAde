import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { ChatMessage, ChatMessageBubble, ChatMessageMetadata } from '@astryxdesign/core/Chat';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Heading, Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { useToast } from '@astryxdesign/core/Toast';
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { Icon } from '@astryxdesign/core/Icon';
import { usePoll } from '../hooks/usePoll';
import { ago, markThreadRead, personName, sendMessage, type Contact, type Thread } from '../services/surgeon';
import './surgeon/surgeon.css';

// 1:1 messages for both roles. Astronauts see flight surgeons; surgeons see astronauts.
// Contacts poll every 5 s and the open thread every 3 s; opening a thread marks it read.
export default function Messenger({ selfId, basePath, otherId, readOnly = false, onRead }: {
  selfId: string; basePath: string; otherId?: string; readOnly?: boolean; onRead?: () => void;
}) {
  const navigate = useNavigate();
  const contacts = usePoll<Contact[]>('/messages/contacts', 5000);
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (contacts.data ?? []).filter(c => !q || [c.display_name, c.full_name, c.crew_role].some(v => v?.toLowerCase().includes(q)));
  }, [contacts.data, query]);
  const active = contacts.data?.find(c => c.user_id === otherId);

  return (
    <div className="messenger">
      <Card padding={3}>
        <VStack gap={3}>
          <TextInput label="Search people" isLabelHidden placeholder="Search by name" startIcon={MagnifyingGlassIcon} value={query} onChange={setQuery} hasClear />
          {contacts.error && <Text role="alert">{contacts.error}</Text>}
          {contacts.data && !contacts.data.length && <Text type="supporting">Nobody to message yet.</Text>}
          {contacts.data && !!contacts.data.length && !visible.length && <Text type="supporting">No one matches “{query}”.</Text>}
          <nav className="messenger__contacts" aria-label="Conversations">
            {visible.map((contact, index) => (
              <button
                key={contact.user_id}
                type="button"
                className="messenger__contact"
                aria-current={contact.user_id === otherId}
                style={{ '--i': index } as CSSProperties}
                onClick={() => navigate(`${basePath}/${contact.user_id}`)}
              >
                <Avatar name={personName(contact)} />
                <StackItem size="fill">
                  <VStack gap={0.5}>
                    <HStack gap={2} hAlign="between" vAlign="center">
                      <Text weight={contact.unread ? 'bold' : 'semibold'} maxLines={1}>{personName(contact)}</Text>
                      {contact.last_at && <Text type="supporting">{ago(contact.last_at)}</Text>}
                    </HStack>
                    <HStack gap={2} hAlign="between" vAlign="center">
                      <Text type="supporting" maxLines={1}>
                        {contact.last_body ? `${contact.last_from_me ? 'You: ' : ''}${contact.last_body}` : contact.crew_role ?? (contact.role === 'astronaut' ? 'Astronaut' : 'Flight surgeon')}
                      </Text>
                      {contact.unread > 0 && <span className="unread-dot" aria-label={`${contact.unread} unread`}>{contact.unread}</span>}
                    </HStack>
                  </VStack>
                </StackItem>
              </button>
            ))}
          </nav>
        </VStack>
      </Card>
      <Card padding={4}>
        {otherId
          ? <ThreadView key={otherId} otherId={otherId} selfId={selfId} fallbackName={active ? personName(active) : undefined}
              readOnly={readOnly} onRead={() => { contacts.reload(); onRead?.(); }} />
          : <EmptyState icon={<Icon icon={ChatBubbleLeftRightIcon} />} title="Pick a conversation" description="Choose someone on the left to read or start a 1:1 thread." />}
      </Card>
    </div>
  );
}

function ThreadView({ otherId, selfId, fallbackName, readOnly, onRead }: {
  otherId: string; selfId: string; fallbackName?: string; readOnly: boolean; onRead: () => void;
}) {
  const thread = usePoll<Thread>(`/messages/with/${encodeURIComponent(otherId)}`, 3000);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const showToast = useToast();
  const bottom = useRef<HTMLDivElement>(null);
  const messages = thread.data?.messages ?? [];
  const lastId = messages.at(-1)?.id;
  const unreadFromOther = messages.filter(m => m.sender_id !== selfId && !m.read_at).length;

  // Mark read on open and whenever new messages arrive while the thread is open.
  useEffect(() => {
    if (!unreadFromOther || readOnly) return;
    markThreadRead(otherId).then(onRead, () => { /* the badge just stays until the next poll */ });
  }, [otherId, unreadFromOther, lastId, readOnly, onRead]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [lastId]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await sendMessage(otherId, body);
      setDraft('');
      thread.reload();
      onRead();
    } catch (error) {
      showToast({ body: error instanceof Error ? error.message : 'The message was not sent.' });
    } finally {
      setSending(false);
    }
  }

  const name = thread.data ? personName(thread.data.contact) : fallbackName ?? '…';
  return (
    <div className="messenger__thread">
      <HStack gap={3} vAlign="center">
        <Avatar name={name} />
        <VStack gap={0.5}>
          <Heading level={2}>{name}</Heading>
          {thread.data && <Text type="supporting">{thread.data.contact.crew_role ?? (thread.data.contact.role === 'astronaut' ? 'Astronaut' : 'Flight surgeon')}</Text>}
        </VStack>
      </HStack>
      {thread.error && <Text role="alert">{thread.error}</Text>}
      <div style={{ flex: 1, minBlockSize: '18rem', maxBlockSize: 'min(56vh, 34rem)', overflowY: 'auto', paddingInline: 4 }} aria-live="polite" aria-label="Message history">
        <VStack gap={3}>
          {thread.data && !messages.length && <Text type="supporting">No messages yet. Say hello.</Text>}
          {messages.map(message => {
            const mine = message.sender_id === selfId;
            return (
              <div key={message.id} className="messenger__bubble-in">
                <ChatMessage sender={mine ? 'user' : 'assistant'} name={mine ? 'You' : name}>
                  <ChatMessageBubble name={mine ? 'You' : name}>
                    {message.body}
                    <ChatMessageMetadata timestamp={`${new Date(message.created_at).toLocaleString()}${mine ? (message.read_at ? ' · Read' : ' · Sent') : ''}`} />
                  </ChatMessageBubble>
                </ChatMessage>
              </div>
            );
          })}
          <div ref={bottom} />
        </VStack>
      </div>
      {readOnly ? <Text type="supporting">The demo is read-only. Sign in with your own account to send messages.</Text> : (
        <div onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(); } }}>
          <VStack gap={2}>
            <TextArea label="Message" isLabelHidden value={draft} onChange={setDraft} placeholder={`Message ${name} (Ctrl+Enter to send)`} maxLength={2000} rows={3} />
            <HStack hAlign="end"><Button label="Send" variant="primary" onClick={send} isLoading={sending} isDisabled={!draft.trim()} /></HStack>
          </VStack>
        </div>
      )}
    </div>
  );
}