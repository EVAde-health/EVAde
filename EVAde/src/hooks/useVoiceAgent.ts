import { useCallback, useEffect, useRef, useState } from 'react';
import { addMicWorklet, MIC_WORKLET_NAME } from '../services/micWorklet';
import {
  base64FromBuffer,
  fetchLatestCheckin,
  friendlyLimitMessage,
  pcm16ToAudioBuffer,
  startVoiceSession,
  voiceSocketUrl,
  type VoiceCheckin,
  type VoiceServerMessage,
} from '../services/voiceAgent';

export type VoiceStatus =
  | 'idle'
  | 'starting'
  | 'connecting'
  | 'listening'
  | 'hearing'
  | 'thinking'
  | 'speaking'
  | 'ended'
  | 'error';

export interface VoiceTurn {
  id: string;
  role: 'agent' | 'user' | 'system';
  text: string;
  final: boolean;
  at: number;
}

export interface UseVoiceAgentOptions {
  /** Crew ID sent to the Worker; check-ins are saved under it. */
  crew?: string;
  /** Called after the agent saves a check-in (save_checkin tool), with the full saved record when available. */
  onCheckinSaved?: (checkin: VoiceCheckin) => void;
}

interface Session {
  ws: WebSocket | null;
  ctx: AudioContext | null;
  stream: MediaStream | null;
  mic: AudioWorkletNode | null;
  playing: Set<AudioBufferSourceNode>;
  nextPlayTime: number;
  timers: Set<ReturnType<typeof setTimeout>>;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pingTimer: ReturnType<typeof setInterval> | null;
  abort: AbortController;
  ready: boolean;
  errored: boolean;
  closed: boolean;
  lastLevel: number;
}

const ACTIVE: VoiceStatus[] = ['starting', 'connecting', 'listening', 'hearing', 'thinking', 'speaking'];
const PING_MS = 20_000;

function newSession(): Session {
  return {
    ws: null,
    ctx: null,
    stream: null,
    mic: null,
    playing: new Set(),
    nextPlayTime: 0,
    timers: new Set(),
    idleTimer: null,
    pingTimer: null,
    abort: new AbortController(),
    ready: false,
    errored: false,
    closed: false,
    lastLevel: 0,
  };
}

// Frees mic/audio acquired after the session was already stopped (e.g. stop pressed mid-permission prompt).
function releaseLate(session: Session) {
  session.stream?.getTracks().forEach(track => track.stop());
  session.ctx?.close().catch(() => undefined);
}

// Talk to the EVAde voice agent from the browser: mic capture (24 kHz PCM16 via AudioWorklet),
// gapless playback with barge-in, live transcript and check-in callbacks.
export function useVoiceAgent({ crew = 'browser-demo', onCheckinSaved }: UseVoiceAgentOptions = {}) {
  const [status, setStatusState] = useState<VoiceStatus>('idle');
  const [statusText, setStatusText] = useState('Tap talk to start a voice check-in');
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  const onCheckinRef = useRef(onCheckinSaved);

  useEffect(() => {
    onCheckinRef.current = onCheckinSaved;
  }, [onCheckinSaved]);

  const setStatus = useCallback((next: VoiceStatus, text: string) => {
    setStatusState(next);
    setStatusText(text);
  }, []);

  const addSystem = useCallback((text: string) => {
    setTurns(current => [...current, { id: `sys:${crypto.randomUUID()}`, role: 'system', text, final: true, at: Date.now() }]);
  }, []);

  const upsertTurn = useCallback((role: 'agent' | 'user', id: string, update: (turn: VoiceTurn) => VoiceTurn) => {
    const key = `${role}:${id}`;
    setTurns(current => {
      const index = current.findIndex(turn => turn.id === key);
      if (index === -1) {
        return [...current, update({ id: key, role, text: '', final: false, at: Date.now() })];
      }
      const next = current.slice();
      next[index] = update(current[index]);
      return next;
    });
  }, []);

  // Error state the session can't recover from; keeps the message visible.
  const fail = useCallback(
    (session: Session, text: string, note = true) => {
      session.errored = true;
      setStatus('error', text);
      if (note) addSystem(text);
    },
    [addSystem, setStatus],
  );

  const stopPlayback = useCallback((session: Session) => {
    for (const src of session.playing) {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    }
    session.playing.clear();
    session.nextPlayTime = 0;
  }, []);

  const send = useCallback((session: Session, msg: object) => {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify(msg));
  }, []);

  // Releases the mic, audio graph, socket and timers. Idempotent.
  const teardown = useCallback(
    (session: Session, sendStop: boolean) => {
      if (session.closed) return;
      session.closed = true;
      if (sendStop) send(session, { type: 'stop' });
      session.abort.abort();
      if (session.ws) {
        session.ws.onmessage = null;
        session.ws.onclose = null;
        session.ws.onerror = null;
        try {
          session.ws.close(1000);
        } catch {
          // Socket already closed.
        }
      }
      stopPlayback(session);
      session.timers.forEach(clearTimeout);
      session.timers.clear();
      if (session.idleTimer) clearTimeout(session.idleTimer);
      if (session.pingTimer) clearInterval(session.pingTimer);
      if (session.mic) {
        session.mic.port.onmessage = null;
        session.mic.disconnect();
      }
      session.stream?.getTracks().forEach(track => track.stop());
      session.ctx?.close().catch(() => undefined);
      if (sessionRef.current === session) sessionRef.current = null;
      setLevel(0);
    },
    [send, stopPlayback],
  );

  const later = useCallback((session: Session, fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      session.timers.delete(timer);
      if (!session.closed) fn();
    }, ms);
    session.timers.add(timer);
  }, []);

  const handleCheckin = useCallback(
    async (result: Record<string, unknown>) => {
      const saved = result as VoiceCheckin;
      let checkin: VoiceCheckin = saved;
      try {
        const latest = await fetchLatestCheckin(crew);
        if (latest && (saved.checkin_id === undefined || latest.id === saved.checkin_id)) {
          checkin = { ...latest, ...saved };
        }
      } catch {
        // Fall back to the tool result alone.
      }
      onCheckinRef.current?.(checkin);
    },
    [crew],
  );

  const onServer = useCallback(
    (session: Session, msg: VoiceServerMessage) => {
      const ctx = session.ctx;
      const playbackLeft = () => (ctx ? Math.max(0, session.nextPlayTime - ctx.currentTime) : 0);
      switch (msg.type) {
        case 'status':
          if (msg.state === 'connecting') setStatus('connecting', 'Connecting to EVAde…');
          else if (msg.state === 'ready') {
            session.ready = true;
            setStatus('listening', 'Listening. Just talk.');
          } else if (msg.state === 'ended') {
            const friendly = friendlyLimitMessage(msg.reason || msg.message);
            if (friendly) fail(session, friendly);
          }
          break;
        case 'notice': {
          const friendly = friendlyLimitMessage(msg.message) || msg.message;
          if (friendly && !session.errored) fail(session, friendly);
          break;
        }
        case 'audio': {
          if (!ctx || !msg.audio) break;
          const buffer = pcm16ToAudioBuffer(ctx, msg.audio);
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          const startAt = Math.max(session.nextPlayTime, ctx.currentTime + 0.05);
          src.start(startAt);
          session.nextPlayTime = startAt + buffer.duration;
          session.playing.add(src);
          src.onended = () => session.playing.delete(src);
          break;
        }
        case 'clear': // Barge-in: drop everything queued.
          stopPlayback(session);
          break;
        case 'mark':
          later(session, () => send(session, { type: 'mark', name: msg.name }), playbackLeft() * 1000);
          break;
        case 'speech_started':
          if (session.idleTimer) clearTimeout(session.idleTimer);
          stopPlayback(session);
          setStatus('hearing', 'Hearing you…');
          break;
        case 'speech_stopped':
          setStatus('thinking', 'Thinking…');
          break;
        case 'transcript':
          if (msg.role === 'agent') {
            upsertTurn('agent', msg.id, turn => ({ ...turn, text: turn.text + (msg.delta || '') }));
            if (session.idleTimer) clearTimeout(session.idleTimer);
            setStatus('speaking', 'EVAde is speaking…');
          } else {
            upsertTurn('user', msg.id, turn => ({ ...turn, text: msg.text || '', final: Boolean(msg.final) }));
          }
          break;
        case 'transcript_done':
          upsertTurn('agent', msg.id, turn => ({ ...turn, final: true }));
          if (session.idleTimer) clearTimeout(session.idleTimer);
          session.idleTimer = setTimeout(() => {
            if (!session.closed && !session.errored) setStatus('listening', 'Listening. Just talk.');
          }, playbackLeft() * 1000);
          break;
        case 'tool_result': {
          const result = msg.result || {};
          if (msg.name === 'save_checkin' && typeof result.level === 'string') {
            addSystem(`Check-in saved: ${result.level.toUpperCase()}`);
            void handleCheckin(result);
          } else if (msg.name === 'queue_flight_surgeon_message') {
            const summary = (result.summary || result.status || 'message queued') as string;
            addSystem(`Flight surgeon: ${summary}`);
          }
          break;
        }
        case 'error': {
          const friendly = friendlyLimitMessage(msg.message) || msg.message || 'Voice error';
          fail(session, friendly);
          break;
        }
        default:
          break;
      }
    },
    [addSystem, fail, handleCheckin, later, send, setStatus, stopPlayback, upsertTurn],
  );

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    const session = newSession();
    sessionRef.current = session;
    setStatus('starting', 'Asking for the microphone…');
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Voice needs HTTPS (or localhost) and a browser with microphone support.');
      }
      // Create and resume the AudioContext inside the tap, before any await: iOS Safari and the iOS app's
      // WebView keep a context created later (after the microphone prompt) suspended, so nothing would play.
      const ctx = new AudioContext();
      session.ctx = ctx;
      const resumed = ctx.resume();
      session.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (session.closed) {
        releaseLate(session);
        return;
      }

      await resumed;
      await addMicWorklet(ctx);
      if (session.closed) {
        releaseLate(session);
        return;
      }
      const source = ctx.createMediaStreamSource(session.stream);
      const mic = new AudioWorkletNode(ctx, MIC_WORKLET_NAME);
      session.mic = mic;
      const mute = ctx.createGain();
      mute.gain.value = 0; // Keep the worklet pulled without echoing the mic.
      source.connect(mic).connect(mute).connect(ctx.destination);
      mic.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
        const lvl = Math.round(Math.min(1, e.data.level * 4) * 20) / 20;
        if (lvl !== session.lastLevel) {
          session.lastLevel = lvl;
          setLevel(lvl);
        }
        if (session.ready) send(session, { type: 'audio', audio: base64FromBuffer(e.data.pcm) });
      };

      setStatus('connecting', 'Connecting…');
      const { ticket, crew_id: crewId } = await startVoiceSession(crew, session.abort.signal);
      if (session.closed) return;

      const ws = new WebSocket(voiceSocketUrl(ticket, crewId || crew));
      session.ws = ws;
      ws.onmessage = e => {
        try {
          onServer(session, JSON.parse(e.data as string) as VoiceServerMessage);
        } catch {
          // Ignore malformed frames.
        }
      };
      ws.onerror = () => {
        if (!session.errored) fail(session, 'Connection error. Please try again.', false);
      };
      ws.onclose = e => {
        const friendly = friendlyLimitMessage(e.reason);
        if (friendly && !session.errored) fail(session, friendly);
        else if (e.code !== 1000 && !session.errored) fail(session, 'Connection error. Please try again.');
        if (!session.errored) setStatus('ended', 'Voice session ended');
        teardown(session, false);
      };
      session.pingTimer = setInterval(() => send(session, { type: 'ping' }), PING_MS);
      addSystem('Voice session started');
    } catch (err) {
      if (session.closed) {
        releaseLate(session);
        return;
      }
      const error = err as { name?: string; message?: string };
      const text =
        error?.name === 'NotAllowedError'
          ? 'Microphone blocked. Allow microphone access for EVAde (browser site settings, or the app in your phone settings) and try again.'
          : `Could not start voice: ${error?.message || String(err)}`;
      fail(session, text, false);
      teardown(session, false);
    }
  }, [addSystem, crew, fail, onServer, send, setStatus, teardown]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const wasLive = Boolean(session.ws);
    teardown(session, true);
    if (!session.errored) setStatus('ended', 'Voice session ended');
    if (wasLive) addSystem('Voice session ended');
  }, [addSystem, setStatus, teardown]);

  const clearTurns = useCallback(() => setTurns([]), []);

  // End the session if the page unmounts mid-call.
  useEffect(
    () => () => {
      if (sessionRef.current) teardown(sessionRef.current, true);
    },
    [teardown],
  );

  return {
    status,
    statusText,
    isActive: ACTIVE.includes(status),
    level,
    turns,
    start,
    stop,
    clearTurns,
  };
}
