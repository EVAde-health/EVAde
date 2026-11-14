import { useEffect, useRef, useState } from 'react';
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
} from '@astryxdesign/core/Chat';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack, StackItem, VStack } from '@astryxdesign/core/Stack';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { Timestamp } from '@astryxdesign/core/Timestamp';
import { ToggleButton } from '@astryxdesign/core/ToggleButton';
import { Icon } from '@astryxdesign/core/Icon';
import { useToast } from '@astryxdesign/core/Toast';
import { SparklesIcon } from '@heroicons/react/24/outline';
import BrandMark from '../components/BrandMark';
import PageHeader from '../components/PageHeader';
import { usePersistentState } from '../hooks/usePersistentState';
import { useMission } from '../context/MissionContext';
import { CREW, MOOD_LABELS } from '../data/mission';
import { createMessage, getAssistantReply, type JournalMessage } from '../services/journalAssistant';
import './css/JournalPage.css';

const PROMPTS = [
  'What was the best moment of today?',
  'Something is stressing me out…',
  'I slept badly last night',
  'I miss home today',
];

const MOOD_EMOJI = ['😣', '😕', '😐', '🙂', '😄'];
const MOOD_TASK = { id: 'p-mood', xp: 25 };

// Animated three-dot "typing" indicator.
function TypingDots() {
  return (
    <HStack gap={1} className="journal__typing" role="status" aria-label="Assistant is typing">
      <HStack className="journal__dot" aria-hidden="true" />
      <HStack className="journal__dot" aria-hidden="true" />
      <HStack className="journal__dot" aria-hidden="true" />
    </HStack>
  );
}

// Private journal with mood check-in and an AI companion chat.
export default function JournalPage() {
  const [messages, setMessages] = usePersistentState<JournalMessage[]>('evade:journal', []);
  const [draft, setDraft] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { completed, toggleTask } = useMission();
  const showToast = useToast();

  useEffect(() => () => abortRef.current?.abort(), []);

  // Sends the user's entry and appends the assistant reply.
  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isReplying) return;
    const history = [...messages, createMessage('user', trimmed)];
    setMessages(history);
    setDraft('');
    setIsReplying(true);
    abortRef.current = new AbortController();
    try {
      const reply = await getAssistantReply(history, abortRef.current.signal);
      setMessages(current => [...current, createMessage('assistant', reply)]);
    } catch {
      // Aborted on unmount or stop.
    } finally {
      setIsReplying(false);
    }
  }

  // Cancels an in-flight assistant reply.
  function stopReply() {
    abortRef.current?.abort();
    setIsReplying(false);
  }

  // Logs today's mood and completes the check-in protocol once.
  function logMood(score: number) {
    setMood(score);
    setMessages(current => [...current, createMessage('system', `Mood logged: ${MOOD_EMOJI[score - 1]} ${MOOD_LABELS[score - 1]}`)]);
    if (!completed.includes(MOOD_TASK.id) && toggleTask(MOOD_TASK.id, MOOD_TASK.xp)) {
      showToast({ body: `🧠 Behavioral check-in complete · +${MOOD_TASK.xp} XP` });
    }
  }

  return (
    <VStack gap={4} padding={6} className="page journal">
      <PageHeader
        eyebrow="Private journal"
        title="How are you, really?"
        description="Only you can read this. Your companion will learn to spot patterns in how you’re feeling."
        actions={<Token label="AI companion · preview" color="purple" icon={<Icon icon={SparklesIcon} size="sm" />} />}
      />

      <Card padding={4} className="journal__mood rise-in">
        <HStack gap={4} wrap="wrap" vAlign="center" hAlign="between">
          <VStack gap={0.5}>
            <Text type="label">Today’s mood check-in</Text>
            <Text type="supporting">{mood ? `Logged: ${MOOD_LABELS[mood - 1]}` : 'Tap the face that fits best'}</Text>
          </VStack>
          <HStack gap={2} wrap="wrap">
            {MOOD_EMOJI.map((emoji, i) => (
              <ToggleButton
                key={emoji}
                label={MOOD_LABELS[i]}
                isPressed={mood === i + 1}
                onPressedChange={() => logMood(i + 1)}
                className="journal__mood-button">
                {emoji}
              </ToggleButton>
            ))}
          </HStack>
        </HStack>
      </Card>

      <StackItem size="fill" className="journal__chat">
        <ChatLayout
          composer={
            <ChatComposer
              value={draft}
              onChange={setDraft}
              onSubmit={sendMessage}
              onStop={stopReply}
              isStopShown={isReplying}
              placeholder="Write about your day…"
            />
          }
          emptyState={
            <EmptyState
              icon={<BrandMark size="lg" />}
              title={`Hi ${CREW.name.split(' ')[0]}, what’s on your mind?`}
              description="Pick a prompt or start writing."
              actions={
                <HStack gap={2} wrap="wrap" hAlign="center">
                  {PROMPTS.map(prompt => (
                    <Token key={prompt} label={prompt} onClick={() => sendMessage(prompt)} />
                  ))}
                </HStack>
              }
            />
          }>
          {messages.length > 0 && (
            <ChatMessageList isStreaming={isReplying}>
              {messages.map(message =>
                message.sender === 'system' ? (
                  <ChatSystemMessage key={message.id}>{message.text}</ChatSystemMessage>
                ) : (
                  <ChatMessage
                    key={message.id}
                    sender={message.sender}
                    avatar={message.sender === 'assistant' ? <Avatar name="EVA companion" size="sm" /> : undefined}
                    metadata={<Timestamp value={message.sentAt} />}>
                    <ChatMessageBubble>{message.text}</ChatMessageBubble>
                  </ChatMessage>
                ),
              )}
              {isReplying && (
                <ChatMessage sender="assistant" avatar={<Avatar name="EVA companion" size="sm" />}>
                  <ChatMessageBubble>
                    <TypingDots />
                  </ChatMessageBubble>
                </ChatMessage>
              )}
            </ChatMessageList>
          )}
        </ChatLayout>
      </StackItem>
    </VStack>
  );
}
