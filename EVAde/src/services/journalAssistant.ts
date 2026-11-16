import {
  fetchJournalMessages,
  postJournalMessage,
  postVoiceSession,
  type ApiJournalMessage,
  type VoiceSessionCheckin,
  type VoiceSessionTurn,
} from './healthApi';

export interface JournalMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  sentAt: number;
}

// Maps a stored journal row onto the chat message shape.
export function toJournalMessage(row: ApiJournalMessage): JournalMessage {
  return { id: row.id, sender: row.sender, text: row.content, sentAt: Date.parse(row.ts) };
}

// Loads the user's saved journal conversation, oldest first.
export async function loadJournal(userId: string, signal: AbortSignal) {
  return (await fetchJournalMessages(userId, { signal })).map(toJournalMessage);
}

// Saves a private message and returns the EVAde companion's reply, written by Grok (POST /journal/messages).
// The same call stores a journal entry, so the AI summary, mood and health-data parser run on it for the surgeon.
// When Grok is unavailable the stored reply is a fixed fallback line, recorded with model "rules".
export async function getAssistantReply(entry: JournalMessage, signal: AbortSignal): Promise<JournalMessage | null> {
  const { reply } = await postJournalMessage(entry.id, entry.text, { signal });
  return reply ? toJournalMessage(reply) : null;
}

// Saves a finished voice session once; returns its turns and the saved acknowledgement as chat messages.
export async function saveVoiceSession(
  sessionId: string,
  turns: VoiceSessionTurn[],
  checkin: VoiceSessionCheckin | null,
  signal?: AbortSignal,
): Promise<JournalMessage[]> {
  const result = await postVoiceSession({ session_id: sessionId, turns, checkin }, { signal });
  return [...result.messages, ...(result.reply ? [result.reply] : [])].map(toJournalMessage);
}

// Creates a message with a fresh id and timestamp.
export function createMessage(sender: JournalMessage['sender'], text: string, id: string = crypto.randomUUID()): JournalMessage {
  return { id, sender, text, sentAt: Date.now() };
}
