/**
 * Shared EVAde voice-agent core: one implementation for phone and browser/app.
 * Port of api/voice_agent.py: persona/instructions, xAI session config, the xAI
 * connection and AgentSession (session setup, greeting, tool calls, continuing
 * after tools without talking over playback, barge-in).
 *
 * xAI docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
 */
import { envStr, type EnvLike } from "./config";
import { runTool, TOOLS, type ToolContext } from "./tools";

export const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
export const DEFAULT_MODEL = "grok-voice-latest";
export const DEFAULT_VOICE = "eve";

export type AudioFormat = { type: string; rate?: number };
export const PHONE_AUDIO: AudioFormat = { type: "audio/pcmu" }; // G.711 mu-law, fixed 8000 Hz
export const BROWSER_AUDIO: AudioFormat = { type: "audio/pcm", rate: 24000 }; // PCM16 LE, 24 kHz

export const INSTRUCTIONS = `# Role
You are EVAde, a calm onboard health co-pilot for astronauts, speaking on a voice call.
You run a short daily health check-in. Do not assume the crew member knows how to assess
their own health: explain things simply.

# Style
- Short spoken turns: one or two sentences, then let them talk. Ask one question at a time.
- Plain language, no jargon, no markdown, no lists read aloud. Say numbers naturally.
- Warm, steady, never alarmist.

# Check-in
1. Greet them as EVAde and say this is the daily check-in, about two minutes.
2. Ask how many hours they slept.
3. Ask for their mood from 1 (very low) to 5 (very good).
4. Ask whether they have any symptoms (for example headache, nausea, congestion, pain, rash).
5. Offer, optionally, to log blood pressure, temperature and blood sugar if they have readings.
   Skip anything they don't have.
6. Call save_checkin with what they told you. Before calling it, say something brief like
   "One moment while I check that."
7. Read the result: say the colour (green, yellow or red), WHY it was flagged in one or two
   plain sentences, then the top one to three concrete actions.
8. If the result is red, or they ask, offer to send it to the flight surgeon and call
   queue_flight_surgeon_message with a one-line summary (priority "urgent" for red).
   Tell them what happened to the message using the tool's summary (sent, in transit, or
   queued for when comms return). Don't claim the flight surgeon has replied or is on the line.
9. Close: remind them once that EVAde is decision support, not a medical device, and that
   the flight surgeon makes medical decisions.

# Safety
- If they describe chest pain, trouble breathing, fainting, confusion, slurred speech, or
  anything that sounds like an emergency, tell them to alert their crewmates and follow
  the emergency procedure now, and queue an urgent message to the flight surgeon.
- Never diagnose or prescribe medication. Never make up readings they did not give you.
`;

export const GREETING_PROMPT =
  "The call just connected. Greet the crew member as EVAde and start the daily check-in.";

export function xaiUrl(env: EnvLike): string {
  return `${XAI_REALTIME_URL}?model=${envStr(env, "XAI_MODEL", DEFAULT_MODEL)}`;
}

/** session.update payload. Same instructions, voice, VAD and tools for every transport. */
export function sessionUpdate(env: EnvLike, audioFormat?: AudioFormat, opts: { transcribe?: boolean } = {}) {
  const fmt = { ...(audioFormat ?? PHONE_AUDIO) };
  const input: Record<string, unknown> = { format: fmt };
  if (opts.transcribe) input.transcription = { model: "grok-transcribe" };
  return {
    type: "session.update",
    session: {
      instructions: INSTRUCTIONS,
      voice: envStr(env, "XAI_VOICE", DEFAULT_VOICE),
      turn_detection: { type: "server_vad" },
      audio: { input, output: { format: { ...fmt } } },
      tools: TOOLS,
    },
  };
}

/** Minimal socket surface the bridge needs (a Workers WebSocket satisfies it). */
export interface XaiSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", fn: (ev: MessageEvent) => void): void;
  addEventListener(type: "close" | "error", fn: (ev: Event) => void): void;
}

/**
 * Open the xAI realtime WebSocket (Authorization: Bearer <XAI_API_KEY>).
 * Workers open outbound WebSockets with fetch() + Upgrade: websocket over https://.
 */
export async function connectXai(env: EnvLike): Promise<WebSocket> {
  const key = envStr(env, "XAI_API_KEY");
  if (!key) throw new Error("XAI_API_KEY is not set");
  const url = xaiUrl(env).replace(/^wss:/, "https:");
  const resp = await fetch(url, { headers: { Upgrade: "websocket", Authorization: `Bearer ${key}` } });
  const ws = resp.webSocket;
  if (!ws) throw new Error(`xAI did not accept the WebSocket (HTTP ${resp.status})`);
  ws.accept();
  return ws;
}

export type Msg = Record<string, any>;
export type SendFn = (msg: Msg) => void | Promise<void>;

export function log(level: "info" | "warn" | "error", message: string, extra: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, message, ...extra });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * xAI-side logic shared by every transport. Subclasses implement playAudio,
 * clearAudio, sendMark and optionally notify / canMark.
 */
export abstract class AgentSession {
  audioFormat: AudioFormat = PHONE_AUDIO;
  transcribe = false;

  sessionConfigured = false;
  sessionReady = false;
  greeted = false;
  responseActive = false;
  audioInResponse = false;
  toolOutputsPending = false;
  pendingMark: string | null = null;
  handledCallIds = new Set<string>();
  protected markSeq = 0;
  label: string;

  constructor(public sendXai: SendFn, protected tools: ToolContext, public crewId = "unknown") {
    this.label = crewId;
  }

  // ---- transport hooks
  abstract playAudio(b64: string): Promise<void> | void;
  abstract clearAudio(): Promise<void> | void;
  abstract sendMark(name: string): Promise<void> | void;
  canMark(): boolean { return true; }
  /** UI side-channel (transcripts, tool results). Phone ignores it. */
  async notify(_event: Msg): Promise<void> {}

  // ---- listener -> xAI
  async userAudio(b64: string): Promise<void> {
    if (this.sessionReady && b64) await this.sendXai({ type: "input_audio_buffer.append", audio: b64 });
  }

  async playbackReached(name: string | null | undefined): Promise<void> {
    if (name && name === this.pendingMark) {
      // Listener has heard everything before the tool call; continue now.
      this.pendingMark = null;
      await this.sendXai({ type: "response.create" });
    }
  }

  // ---- xAI -> listener
  async onXai(ev: Msg): Promise<void> {
    const etype: string = ev.type ?? "";
    switch (etype) {
      case "conversation.created":
      case "session.created":
        if (!this.sessionConfigured) {
          this.sessionConfigured = true;
          await this.sendXai(sessionUpdate(this.tools.env, this.audioFormat, { transcribe: this.transcribe }));
        }
        break;
      case "session.updated":
        this.sessionReady = true;
        await this.notify({ type: "status", state: "ready" });
        if (!this.greeted) {
          this.greeted = true;
          await this.sendXai({ type: "conversation.item.create", item: {
            type: "message", role: "user", content: [{ type: "input_text", text: GREETING_PROMPT }] } });
          await this.sendXai({ type: "response.create" });
        }
        break;
      case "response.created":
        this.responseActive = true;
        this.audioInResponse = false;
        break;
      case "response.output_audio.delta":
        if (ev.delta) {
          this.audioInResponse = true;
          await this.playAudio(ev.delta);
        }
        break;
      case "input_audio_buffer.speech_started":
        // Barge-in: drop whatever agent audio is still buffered at the listener.
        this.pendingMark = null;
        await this.clearAudio();
        await this.notify({ type: "speech_started" });
        break;
      case "input_audio_buffer.speech_stopped":
        await this.notify({ type: "speech_stopped" });
        break;
      case "response.output_audio_transcript.delta":
        await this.notify({ type: "transcript", role: "agent", id: ev.response_id || ev.item_id || null,
                            delta: ev.delta ?? "" });
        break;
      case "response.output_audio_transcript.done":
        await this.notify({ type: "transcript_done", role: "agent", id: ev.response_id || ev.item_id || null });
        break;
      case "conversation.item.input_audio_transcription.updated":
      case "conversation.item.input_audio_transcription.completed": {
        const text = ev.transcript ?? "";
        const final = etype.endsWith("completed");
        if (final) log("info", "user transcript", { session: this.label, text });
        await this.notify({ type: "transcript", role: "user", id: ev.item_id ?? null, text, final });
        break;
      }
      case "response.function_call_arguments.done":
        await this.runToolCall(ev.name, ev.call_id, ev.arguments);
        break;
      case "response.output_item.done": {
        const item = ev.item || {};
        if (item.type === "function_call") await this.runToolCall(item.name, item.call_id, item.arguments);
        break;
      }
      case "response.done": {
        for (const item of (ev.response || {}).output || []) {
          if (item?.type === "function_call") await this.runToolCall(item.name, item.call_id, item.arguments);
        }
        this.responseActive = false;
        if (this.toolOutputsPending) await this.continueAfterTools();
        break;
      }
      case "error": {
        const err = ev.error || ev;
        log("error", "xAI error", { session: this.label, error: err });
        const msg = err && typeof err === "object" ? err.message : String(err);
        await this.notify({ type: "error", message: msg || "xAI error" });
        break;
      }
    }
  }

  protected async runToolCall(name: unknown, callId: unknown, args: unknown): Promise<void> {
    if (!name || !callId || this.handledCallIds.has(String(callId))) return;
    this.handledCallIds.add(String(callId));
    const result = await runTool(this.tools, String(name), this.crewId, args);
    log("info", "tool call", { session: this.label, tool: name, result });
    await this.sendXai({ type: "conversation.item.create", item: {
      type: "function_call_output", call_id: callId, output: JSON.stringify(result) } });
    await this.notify({ type: "tool_result", name, result });
    this.toolOutputsPending = true;
    if (!this.responseActive) await this.continueAfterTools(); // call arrived after response.done
  }

  /** Send response.create once every tool output is in, without talking over audio
   *  the listener is still hearing: a playback mark tells us when it ends. */
  protected async continueAfterTools(): Promise<void> {
    this.toolOutputsPending = false;
    if (this.audioInResponse && this.canMark()) {
      this.markSeq += 1;
      this.pendingMark = `evade-tools-${this.markSeq}`;
      await this.sendMark(this.pendingMark);
    } else {
      await this.sendXai({ type: "response.create" });
    }
  }
}
