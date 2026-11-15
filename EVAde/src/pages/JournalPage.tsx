import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import VoiceJournal from '../components/VoiceJournal';
import type { VoiceTurn } from '../hooks/useVoiceAgent';
import { useMission } from '../context/MissionContext';
import { MOOD_EMOJI, MOOD_LABELS } from '../data/health';
import { createMessage, getAssistantReply, loadJournal, saveVoiceSession, type JournalMessage } from '../services/journalAssistant';
import type { VoiceSessionCheckin } from '../services/healthApi';
import { ApiError } from '../services/api';
import type { VoiceCheckin } from '../services/voiceAgent';
import './css/JournalPage.css';

const PROMPTS = [
  'What was the best moment of today?',
  'Something is stressing me out…',
  'I slept badly last night',
  'I miss home today',
];


const VOICE_SAVE_ATTEMPTS = 3;
const MOBILE_JOURNAL = '(width < 768px)';

function subscribeToJournalWidth(onChange: () => void) {
  const query = window.matchMedia(MOBILE_JOURNAL);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isMobileJournal = () => window.matchMedia(MOBILE_JOURNAL).matches;

// One-line summary of what the voice agent recorded in a check-in.
function checkinSummary(checkin: VoiceCheckin) {
  const facts: string[] = [];
  if (checkin.sleep_hours != null) facts.push(`Sleep ${checkin.sleep_hours} h`);
  if (checkin.mood != null) facts.push(`Mood ${checkin.mood}/5`);
  if (checkin.systolic != null && checkin.diastolic != null) facts.push(`BP ${checkin.systolic}/${checkin.diastolic}`);
  if (checkin.temperature_c != null) facts.push(`Temp ${checkin.temperature_c} °C`);
  if (checkin.blood_sugar_mg_dl != null) facts.push(`Sugar ${checkin.blood_sugar_mg_dl} mg/dL`);
  if (checkin.symptoms?.length) facts.push(`Symptoms: ${checkin.symptoms.join(', ')}`);
  const level = checkin.level ? String(checkin.level).toUpperCase() : 'SAVED';
  return [`🎙️ Voice check-in: ${level}`, ...facts].join(' · ');
}

// The agent's reasons, actions and reminder as one advice message.
function checkinAdvice(checkin: VoiceCheckin) {
  return [
    ...(checkin.reasons ?? []).map(reason => `• ${reason}`),
    ...(checkin.actions ?? []).map(action => `→ ${action}`),
    ...(checkin.reminder ? [checkin.reminder] : []),
  ].join('\n');
}

// The fields of the agent's saved check-in that the API parses (no ids or crew labels).
function checkinFields(checkin: VoiceCheckin | null): VoiceSessionCheckin | null {
  if (!checkin) return null;
  const { sleep_hours, mood, symptoms, systolic, diastolic, temperature_c, blood_sugar_mg_dl, notes, level, reasons, actions } = checkin;
  return { sleep_hours, mood, symptoms, systolic, diastolic, temperature_c, blood_sugar_mg_dl, notes, level, reasons, actions };
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

// Private journal saved to D1, with mood check-in and the EVA companion (the text version of the voice agent).
export default function JournalPage() {
  const [messages, setMessages] = useState<JournalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [draft, setDraft] = useState('');
  const [isReplying, setIsReplying] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const failedRef = useRef<{ id: string; text: string } | null>(null);
  const checkinRef = useRef<VoiceCheckin | null>(null);
  const mobile = useSyncExternalStore(subscribeToJournalWidth, isMobileJournal);
  const mobileComposerRef = useRef<HTMLDivElement>(null);
  const { user, logMood: saveMood, refreshToday } = useMission();
  const showToast = useToast();
  const userId = user.user_id;

  // iOS can shrink the visual viewport for the keyboard while the shell's scroll area keeps its layout height.
  useEffect(() => {
    const composer = mobileComposerRef.current;
    const viewport = window.visualViewport;
    const journal = composer?.closest<HTMLElement>('.journal');
    const scroller = journal?.closest<HTMLElement>('.astryx-layout-content');
    if (!mobile || !composer || !viewport || !journal || !scroller) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = composer.contains(document.activeElement);
        const visibleBottom = viewport.height + viewport.offsetTop;
        const inset = focused && viewport.scale === 1 ? Math.max(0, scroller.getBoundingClientRect().bottom - visibleBottom) : 0;
        journal.style.setProperty('--journal-keyboard-inset', inset + 'px');
        if (inset > 0) {
          const hidden = composer.getBoundingClientRect().bottom - visibleBottom;
          if (hidden > 1) scroller.scrollTop += hidden;
        }
      });
    };

    const composerSize = new ResizeObserver(update);
    composerSize.observe(composer);
    composer.addEventListener('focusin', update);
    composer.addEventListener('focusout', update);
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      cancelAnimationFrame(frame);
      composerSize.disconnect();
      composer.removeEventListener('focusin', update);
      composer.removeEventListener('focusout', update);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      journal.style.removeProperty('--journal-keyboard-inset');
    };
  }, [mobile]);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    loadJournal(userId, controller.signal)
      .then(history => {
        if (!controller.signal.aborted) setMessages(previous => [...history, ...previous]);
      })
      .catch(() => { if (!controller.signal.aborted) setHistoryError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId]);

  // Sends the user's entry and appends the assistant reply.
  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading || abortRef.current) return;
    const retryId = failedRef.current?.text === trimmed ? failedRef.current.id : undefined;
    const entry = createMessage('user', trimmed, retryId);
    failedRef.current = null;
    setMessages(previous => [...previous, entry]);
    setDraft('');
    setIsReplying(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const reply = await getAssistantReply(entry, controller.signal);
      if (!controller.signal.aborted && reply) setMessages(current => [...current, reply]);
    } catch (error) {
      if (!controller.signal.aborted) {
        failedRef.current = { id: entry.id, text: trimmed };
        setMessages(current => current.filter(message => message.id !== entry.id));
        setDraft(current => current || trimmed);
        if (error instanceof ApiError && error.status === 429) {
          setMessages(current => [...current, createMessage('system', error.message)]);
        } else {
          showToast({ body: 'Your entry did not finish saving. Try sending it again.' });
        }
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

  // Saves today's mood to D1; the Worker completes the check-in task.
  async function logMood(score: number) {
    const previous = mood;
    setMood(score);
    try {
      await saveMood(score);
      setMessages(current => [...current, createMessage('system', `Mood logged: ${MOOD_EMOJI[score - 1]} ${MOOD_LABELS[score - 1]}`)]);
      showToast({ body: `🧠 Mood check-in saved · ${MOOD_LABELS[score - 1]}` });
    } catch {
      setMood(previous);
      showToast({ body: 'Your mood could not be saved. Try again.' });
    }
  }

  // Shows the agent's saved check-in; it is stored with the session's transcript when the session ends.
  function handleVoiceCheckin(checkin: VoiceCheckin) {
    checkinRef.current = checkin;
    const advice = checkinAdvice(checkin);
    setMessages(current => [...current, createMessage('system', checkinSummary(checkin)), ...(advice ? [createMessage('assistant', advice)] : [])]);
    const voiceMood = Number(checkin.mood);
    if (Number.isInteger(voiceMood) && voiceMood >= 1 && voiceMood <= 5) setMood(voiceMood);
  }

  // Saves a finished voice session once (turns + check-in). The Worker stores the transcript, parses mood, sleep and
  // readings into the health record, and replies. Retries reuse the session id, so nothing is counted twice.
  async function saveVoiceTurns({ sessionId, turns }: { sessionId: string; turns: VoiceTurn[] }) {
    await pause(800); // lets a check-in that arrived just before the end finish loading
    const checkin = checkinFields(checkinRef.current);
    checkinRef.current = null;
    const payload = turns.map(turn => ({
      sender: turn.role === 'agent' ? ('assistant' as const) : ('user' as const),
      content: turn.text.trim().slice(0, 4000),
      ts: new Date(turn.at).toISOString(),
    }));
    if (!payload.some(turn => turn.sender === 'user')) return;
    for (let attempt = 1; attempt <= VOICE_SAVE_ATTEMPTS; attempt++) {
      try {
        const saved = await saveVoiceSession(sessionId, payload, checkin);
        setMessages(current => [...current, ...saved.filter(message => !current.some(existing => existing.id === message.id))]);
        showToast({ body: '🎙️ Voice check-in saved to your journal' });
        void refreshToday().catch(() => undefined);
        return;
      } catch {
        if (attempt < VOICE_SAVE_ATTEMPTS) await pause(1500 * attempt);
      }
    }
    showToast({ body: 'Your voice check-in could not be saved to the journal.' });
  }

  const composer = (
    <ChatComposer
      ref={mobile ? mobileComposerRef : undefined}
      className="journal__composer"
      value={draft}
      onChange={value => setDraft(value.slice(0, 2000))}
      onSubmit={sendMessage}
      onStop={stopReply}
      isStopShown={isReplying}
      placeholder="Write about your day…"
    />
  );

  return (
    <VStack gap={4} padding={6} className="page journal">
      <PageHeader
        eyebrow="Private journal"
        title="How are you, really?"
        description="Entries are saved privately to your EVAde account. Chat with your companion by text or voice: it runs the same daily check-in as the voice agent."
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

      <VoiceJournal crew={`crew-${userId}`} onCheckinSaved={handleVoiceCheckin} onSessionEnded={saveVoiceTurns} />

      {mobile && composer}
      <StackItem size="fill" className="journal__chat">
        <ChatLayout
          composer={mobile ? null : composer}
          emptyState={
            <EmptyState
              icon={<BrandMark size="lg" />}
              title={`Hi ${(user.full_name ?? user.display_name).split(' ')[0]}, what’s on your mind?`}
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
                    <ChatMessageBubble className="journal__bubble">{message.text}</ChatMessageBubble>
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
