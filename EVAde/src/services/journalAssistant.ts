import { api } from './api';

export interface JournalMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  sentAt: number;
}

export function formatAnalysis(summary: string, mood: string | null) {
  return mood ? `${summary}\n\nMood: ${mood}` : summary;
}

export async function getAssistantReply(userId: string, entry: JournalMessage, signal: AbortSignal): Promise<string> {
  const { analysis } = await api<{ analysis?: { summary: string; mood_label: string | null } }>('/journal?analyze=sync', {
    method: 'POST', body: { user_id: userId, client_id: entry.id, content: entry.text, source: 'text' }, signal,
  });
  return analysis?.summary ? formatAnalysis(analysis.summary, analysis.mood_label) : 'Entry saved. No analysis was returned.';
}

// Creates a message with a fresh id and timestamp.
export function createMessage(sender: JournalMessage['sender'], text: string): JournalMessage {
  return { id: crypto.randomUUID(), sender, text, sentAt: Date.now() };
}
