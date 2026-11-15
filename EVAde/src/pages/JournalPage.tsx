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
import { useMission } from '../context/MissionContext';
import { MOOD_LABELS } from '../data/mission';
import { api, userPath } from '../services/api';
import { createMessage, formatAnalysis, getAssistantReply, type JournalMessage } from '../services/journalAssistant';
import './css/JournalPage.css';

const PROMPTS = [
  'What was the best moment of today?',
  'Something is stressing me out…',
  'I slept badly last night',
  'I miss home today',
];

const MOOD_EMOJI = ['😣', '😕', '😐', '🙂', '😄'];
type JournalEntry = { id: number; ts: string; content: string; ai_summary: string | null; mood_label: string | null };

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
  const [messages, setMessages] = useState<JournalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [draft, setDraft] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { user, tasks, completed, toggleTask } = useMission();
  const showToast = useToast();
  const userId = user.user_id;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    api<JournalEntry[]>(userPath(userId, 'journal'), { signal: controller.signal })
      .then(entries => {
        if (controller.signal.aborted) return;
        const history = [...entries].reverse().flatMap<JournalMessage>(entry => {
          const sentAt = Date.parse(entry.ts);
          const message: JournalMessage = { id: `entry-${entry.id}`, sender: 'user', text: entry.content, sentAt };
          return entry.ai_summary ? [message, {
            id: `analysis-${entry.id}`, sender: 'assistant', text: formatAnalysis(entry.ai_summary, entry.mood_label), sentAt,
          }] : [message];
        });
        setMessages(previous => [...history, ...previous]);
      })
      .catch(() => { if (!controller.signal.aborted) setHistoryError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId]);

  // Sends the user's entry and appends the assistant reply.
  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || abortRef.current) return;
    const entry = createMessage('user', trimmed);
    setMessages(previous => [...previous, entry]);
    setDraft('');
    setIsReplying(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await getAssistantReply(userId, entry, controller.signal);
      if (!controller.signal.aborted) setMessages(current => [...current, createMessage('assistant', reply)]);
    } catch {
      if (!controller.signal.aborted) {
        setMessages(current => current.filter(message => message.id !== entry.id));
        setDraft(current => current || trimmed);
        showToast({ body: 'The journal request did not finish. Check your history before resubmitting.' });
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        if (!controller.signal.aborted) setIsReplying(false);
      }
    }
  }

  // Cancels an in-flight assistant reply.
  function stopReply() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsReplying(false);
  }

  // Logs today's mood and completes the check-in protocol once.
  async function logMood(score: number) {
    setMood(score);
    setMessages(current => [...current, createMessage('system', `Mood logged: ${MOOD_EMOJI[score - 1]} ${MOOD_LABELS[score - 1]}`)]);
    const task = tasks.find(item => item.metric === 'mood');
    if (!task || completed.includes(task.id)) return;
    try {
      if (await toggleTask(task.id)) showToast({ body: `🧠 Behavioral check-in complete · +${task.xp} XP` });
    } catch {
      showToast({ body: 'The check-in task could not be updated.' });
    }
  }

  return (
    <VStack gap={4} padding={6} className="page journal">
      <PageHeader
        eyebrow="Private journal"
        title="How are you, really?"
        description="Save a journal entry to your EVAde account and get an AI-generated summary and mood label."
        actions={<Token label="AI companion · preview" color="purple" icon={<Icon icon={SparklesIcon} size="sm" />} />}
      />
      {historyError && <Text role="alert">Journal history could not load.</Text>}

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
              title={`Hi ${user.display_name.split(' ')[0]}, what’s on your mind?`}
              description={loading ? 'Loading your journal…' : 'Pick a prompt or start writing.'}
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
