import { useEffect, useRef } from 'react';
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
} from '@astryxdesign/core/Chat';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack, VStack } from '@astryxdesign/core/Stack';
import { Icon } from '@astryxdesign/core/Icon';
import { ProgressBar } from '@astryxdesign/core/ProgressBar';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { MicrophoneIcon, StopIcon } from '@heroicons/react/24/outline';
import { useVoiceAgent, type VoiceStatus, type VoiceTurn } from '../hooks/useVoiceAgent';
import type { VoiceCheckin } from '../services/voiceAgent';
import './css/VoiceJournal.css';

interface VoiceJournalProps {
  /** Crew ID the voice agent saves check-ins under. */
  crew: string;
  /** Called when the agent saves a check-in during the call. */
  onCheckinSaved?: (checkin: VoiceCheckin) => void;
  /** Called once when a voice session ends, with a fresh session id and the session's transcript turns. */
  onSessionEnded?: (session: { sessionId: string; turns: VoiceTurn[] }) => void;
}

const STATUS_TOKEN: Record<VoiceStatus, { label: string; color: 'default' | 'green' | 'yellow' | 'red' | 'blue' | 'purple' | 'gray' }> = {
  idle: { label: 'Voice off', color: 'gray' },
  starting: { label: 'Starting', color: 'yellow' },
  connecting: { label: 'Connecting', color: 'yellow' },
  listening: { label: 'Live', color: 'green' },
  hearing: { label: 'Live', color: 'green' },
  thinking: { label: 'Live', color: 'blue' },
  speaking: { label: 'Live', color: 'purple' },
  ended: { label: 'Ended', color: 'gray' },
  error: { label: 'Problem', color: 'red' },
};

// Voice check-in with the EVAde agent, embedded in the journal.
export default function VoiceJournal({ crew, onCheckinSaved, onSessionEnded }: VoiceJournalProps) {
  const { status, statusText, isActive, level, turns, start, stop, clearTurns } = useVoiceAgent({ crew, onCheckinSaved });
  const sessionRef = useRef<{ id: string; firstTurn: number } | null>(null);
  const token = STATUS_TOKEN[status];
  const isLive = isActive && status !== 'starting' && status !== 'connecting';

  // One journal save per voice session: the session's turns go to the journal when it ends.
  useEffect(() => {
    if (isActive && !sessionRef.current) {
      sessionRef.current = { id: crypto.randomUUID(), firstTurn: turns.length };
    } else if (!isActive && sessionRef.current) {
      const session = sessionRef.current;
      sessionRef.current = null;
      const spoken = turns
        .slice(session.firstTurn)
        .filter(turn => turn.role !== 'system' && turn.text.trim() && (turn.final || turn.role === 'agent'));
      if (spoken.length) onSessionEnded?.({ sessionId: session.id, turns: spoken });
    }
  }, [isActive, turns, onSessionEnded]);

  return (
    <Card padding={4} className="voice-journal rise-in">
      <VStack gap={3}>
        <HStack gap={3} wrap="wrap" vAlign="center" hAlign="between">
          <VStack gap={0.5}>
            <HStack gap={2} vAlign="center">
              <Text type="label">Talk it through with EVAde</Text>
              <Token label={token.label} color={token.color} size="sm" />
            </HStack>
            <Text type="supporting" role="status" aria-live="polite">
              {statusText}
            </Text>
          </VStack>
          <HStack gap={2} wrap="wrap" vAlign="center">
            {!isActive && turns.length > 0 && <Button label="Clear" variant="ghost" size="sm" onClick={clearTurns} />}
            <Button
              label={isActive ? 'End voice check-in' : 'Talk to EVAde'}
              variant={isActive ? 'destructive' : 'primary'}
              icon={<Icon icon={isActive ? StopIcon : MicrophoneIcon} />}
              isLoading={status === 'starting'}
              isInterruptible
              onClick={() => (isActive ? stop() : void start())}
              className={isLive ? 'voice-journal__talk voice-journal__talk--live' : 'voice-journal__talk'}
            />
          </HStack>
        </HStack>

        {isLive && <ProgressBar label="Microphone level" isLabelHidden value={Math.round(level * 100)} max={100} variant="success" />}

        {turns.length > 0 && (
          <VStack className="voice-journal__transcript" isScrollable>
            <ChatMessageList density="compact" align="top" isStreaming={status === 'speaking'}>
              {turns.map(turn =>
                turn.role === 'system' ? (
                  <ChatSystemMessage key={turn.id}>{turn.text}</ChatSystemMessage>
                ) : (
                  <ChatMessage
                    key={turn.id}
                    sender={turn.role === 'agent' ? 'assistant' : 'user'}
                    avatar={turn.role === 'agent' ? <Avatar name="EVAde" size="sm" /> : undefined}>
                    <ChatMessageBubble>
                      <Text className={turn.final ? undefined : 'voice-journal__partial'}>{turn.text || '…'}</Text>
                    </ChatMessageBubble>
                  </ChatMessage>
                ),
              )}
            </ChatMessageList>
          </VStack>
        )}
      </VStack>
    </Card>
  );
}
