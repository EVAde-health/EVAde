/**
 * Transport-free bridges (ports of CallBridge in api/voice.py and BrowserBridge in
 * api/voice_browser.py). Feed parsed JSON to onTwilio()/onClient()/onXai(); they call
 * the send functions with JSON-able objects. The VoiceSession Durable Object wires
 * them to real WebSockets; tests drive them directly.
 */
import { AgentSession, BROWSER_AUDIO, log, PHONE_AUDIO, type Msg, type SendFn } from "./agent";
import type { ToolContext } from "./tools";

export type ConsumeToken = (token: string | null | undefined) => Promise<boolean>;

/** Twilio Media Stream <-> xAI. All xAI logic lives in AgentSession. */
export class CallBridge extends AgentSession {
  override audioFormat = PHONE_AUDIO;
  streamSid: string | null = null;
  callSid: string | null = null;
  authorized: boolean;
  readonly requireToken: boolean;

  constructor(public sendTwilio: SendFn, sendXai: SendFn, tools: ToolContext,
              private consumeToken: ConsumeToken, opts: { requireToken?: boolean } = {}) {
    super(sendXai, tools);
    this.requireToken = opts.requireToken ?? true;
    this.authorized = !this.requireToken;
  }

  async playAudio(b64: string) {
    if (this.streamSid) await this.sendTwilio({ event: "media", streamSid: this.streamSid, media: { payload: b64 } });
  }

  async clearAudio() {
    if (this.streamSid) await this.sendTwilio({ event: "clear", streamSid: this.streamSid });
  }

  override canMark() { return Boolean(this.streamSid); }

  async sendMark(name: string) {
    await this.sendTwilio({ event: "mark", streamSid: this.streamSid, mark: { name } });
  }

  /** Handle one Twilio event. Returns "stop" when the call is over. */
  async onTwilio(msg: Msg): Promise<"stop" | null> {
    const event = msg.event;
    if (event === "start") {
      const start = msg.start || {};
      this.streamSid = start.streamSid || msg.streamSid || null;
      this.callSid = start.callSid ?? null;
      const params = start.customParameters || {};
      this.crewId = params.caller || "unknown";
      this.label = this.callSid || "phone"; // crewId is the caller's phone number: keep it out of logs
      if (this.requireToken && !(await this.consumeToken(params.token))) {
        log("warn", "Stream rejected: missing/expired token", { stream: this.streamSid });
        return "stop";
      }
      this.authorized = true;
      log("info", "Call started", { call: this.callSid, stream: this.streamSid });
    } else if (event === "media") {
      const media = msg.media || {};
      if (this.authorized && (media.track ?? "inbound") === "inbound") await this.userAudio(media.payload ?? "");
    } else if (event === "mark") {
      await this.playbackReached((msg.mark || {}).name);
    } else if (event === "stop") {
      log("info", "Call ended", { call: this.callSid });
      return "stop";
    }
    return null;
  }
}

/** Browser / React Native app mic <-> xAI. All xAI logic lives in AgentSession. */
export class BrowserBridge extends AgentSession {
  override audioFormat = BROWSER_AUDIO;
  override transcribe = true;

  constructor(public sendClient: SendFn, sendXai: SendFn, tools: ToolContext, crewId = "browser-demo") {
    super(sendXai, tools, crewId);
    this.label = `browser:${crewId}`;
  }

  async playAudio(b64: string) { await this.sendClient({ type: "audio", audio: b64 }); }
  async clearAudio() { await this.sendClient({ type: "clear" }); }
  async sendMark(name: string) { await this.sendClient({ type: "mark", name }); }
  override async notify(event: Msg) { await this.sendClient(event); }

  async onClient(msg: Msg): Promise<"stop" | null> {
    const t = msg.type;
    if (t === "audio") await this.userAudio(msg.audio ?? "");
    else if (t === "mark") await this.playbackReached(msg.name);
    else if (t === "ping") await this.sendClient({ type: "pong" }); // keep-alive for mobile clients
    else if (t === "stop") return "stop";
    return null;
  }
}
