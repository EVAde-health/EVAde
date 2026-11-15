// Client for the EVAde voice Worker (same origin). Protocol: worker/API.md on
// feature/twilio-grok-voice-agent. POST /api/voice/start -> one-time ticket -> WS /api/voice/ws.

export const VOICE_SAMPLE_RATE = 24000;
const ACCESS_KEY_STORE = 'evade_access_key';

export interface VoiceCheckin {
  id?: number;
  checkin_id?: number;
  created_at?: string;
  crew_id?: string;
  sleep_hours?: number | null;
  mood?: number | null;
  symptoms?: string[];
  systolic?: number | null;
  diastolic?: number | null;
  temperature_c?: number | null;
  blood_sugar_mg_dl?: number | null;
  notes?: string | null;
  level?: 'green' | 'yellow' | 'red' | string;
  reasons?: string[];
  actions?: string[];
  reminder?: string;
}

export type VoiceServerMessage =
  | { type: 'status'; state: 'connecting' | 'ready' | 'ended'; reason?: string; message?: string }
  | { type: 'notice'; message: string }
  | { type: 'audio'; audio: string }
  | { type: 'clear' }
  | { type: 'mark'; name: string }
  | { type: 'transcript'; role: 'agent'; id: string; delta?: string }
  | { type: 'transcript'; role: 'user'; id: string; text?: string; final?: boolean }
  | { type: 'transcript_done'; role: 'agent'; id: string }
  | { type: 'tool_result'; name: string; result?: Record<string, unknown> }
  | { type: 'speech_started' | 'speech_stopped' | 'pong' }
  | { type: 'error'; message?: string };

interface StartResponse {
  ticket: string;
  crew_id: string;
}

// Optional access key, shared with the /voice page. Not needed while DEMO_OPEN=true.
export function getAccessKey(): string {
  try {
    return localStorage.getItem(ACCESS_KEY_STORE) || '';
  } catch {
    return '';
  }
}

function authHeaders(): Record<string, string> {
  const key = getAccessKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// Turns server limit phrases into something a person can act on.
export function friendlyLimitMessage(text: string | undefined | null): string | null {
  const t = String(text || '').toLowerCase();
  if (t.includes('too many people talking')) {
    return 'Too many people are talking to EVAde right now. Please try again in a minute.';
  }
  if (t.includes('session limit reached') || t.includes('time-up')) {
    return 'This voice session reached its time limit. Start a new one whenever you are ready.';
  }
  return null;
}

// Requests a single-use ticket for the voice socket.
export async function startVoiceSession(crew: string, signal?: AbortSignal): Promise<StartResponse> {
  const res = await fetch('/api/voice/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ crew }),
    signal,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { detail?: string }).detail || '';
    } catch {
      // Non-JSON error body.
    }
    throw new Error(friendlyLimitMessage(detail) || detail || `Voice service unavailable (${res.status})`);
  }
  return (await res.json()) as StartResponse;
}

// Same-origin WebSocket URL for a ticket (works through the Vite dev proxy too).
export function voiceSocketUrl(ticket: string, crew: string): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const qs = new URLSearchParams({ ticket, crew });
  return `${proto}://${location.host}/api/voice/ws?${qs}`;
}

// Latest saved check-in for a crew member, or null.
export async function fetchLatestCheckin(crew: string, signal?: AbortSignal): Promise<VoiceCheckin | null> {
  const res = await fetch(`/api/checkins/latest?${new URLSearchParams({ crew_id: crew })}`, {
    headers: authHeaders(),
    signal,
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { checkin?: VoiceCheckin | null };
  return body.checkin ?? null;
}

// Base64-encodes an ArrayBuffer of PCM16 audio.
export function base64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// Decodes base64 PCM16 LE mono into an AudioBuffer at 24 kHz.
export function pcm16ToAudioBuffer(ctx: AudioContext, b64: string): AudioBuffer {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const audio = ctx.createBuffer(1, Math.max(1, n), VOICE_SAMPLE_RATE);
  const ch = audio.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    ch[i] = v / 0x8000;
  }
  return audio;
}
