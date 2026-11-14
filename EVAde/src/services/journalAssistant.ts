export interface JournalMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  sentAt: number;
}

const FAKE_LATENCY_MS = 900;

// Placeholder assistant; replace with the LLM worker call later.
export async function getAssistantReply(_history: JournalMessage[], signal?: AbortSignal): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, FAKE_LATENCY_MS);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  return 'testing';
}

// Creates a message with a fresh id and timestamp.
export function createMessage(sender: JournalMessage['sender'], text: string): JournalMessage {
  return { id: crypto.randomUUID(), sender, text, sentAt: Date.now() };
}
