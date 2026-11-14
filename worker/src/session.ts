/**
 * VoiceSession Durable Object: one instance per phone call or browser/app session.
 *
 * Why a Durable Object rather than bridging inside the plain Worker request:
 * a call is a long-lived pair of WebSockets (listener <-> Worker <-> xAI) that moves
 * ~50 audio frames a second in each direction. A plain Worker invocation has one CPU
 * budget for the whole request (10 ms on the Free plan), which a multi-minute call
 * would exhaust. In a Durable Object every incoming WebSocket message resets the CPU
 * budget, and the object stays alive as long as either socket is open.
 *
 * The listener socket uses the WebSocket Hibernation API (ctx.acceptWebSocket). The
 * object cannot actually hibernate while the outbound xAI socket is open, which is fine
 * because the session lives exactly as long as the call.
 */
import { DurableObject } from "cloudflare:workers";
import { connectXai, log, type Msg } from "./agent";
import { BrowserBridge, CallBridge } from "./bridges";
import { consumeStreamToken } from "./tokens";
import type { ToolContext } from "./tools";

type Mode = "phone" | "browser";

export class VoiceSession extends DurableObject<Env> {
  private mode: Mode | null = null;
  private client: WebSocket | null = null;
  private xai: WebSocket | null = null;
  private phone: CallBridge | null = null;
  private browser: BrowserBridge | null = null;
  private xaiStarted = false;
  private ended = false;
  private clientChain: Promise<void> = Promise.resolve();
  private xaiChain: Promise<void> = Promise.resolve();

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    if (this.client) return new Response("Session already in use", { status: 409 });
    const url = new URL(request.url);
    this.mode = url.searchParams.get("mode") === "phone" ? "phone" : "browser";

    const pair = new WebSocketPair();
    const [clientEnd, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    this.client = server;

    const tools: ToolContext = { db: this.env.DB, env: this.env };
    const sendClient = (msg: Msg) => this.sendClient(msg);
    const sendXai = (msg: Msg) => this.sendXai(msg);

    if (this.mode === "phone") {
      this.phone = new CallBridge(sendClient, sendXai, tools, (tok) => consumeStreamToken(this.env.DB, tok));
      // 1. Wait for Twilio's "start" event and check the one-time token before
      //    opening (and paying for) an xAI session. See onClientMessage().
    } else {
      const crew = (url.searchParams.get("crew") || "browser-demo").slice(0, 64);
      this.browser = new BrowserBridge(sendClient, sendXai, tools, crew);
      this.sendClient({ type: "status", state: "connecting" });
      this.ctx.waitUntil(this.startXai());
    }
    return new Response(null, { status: 101, webSocket: clientEnd });
  }

  // ------------------------------------------------------------ client side
  override async webSocketMessage(_ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    this.clientChain = this.clientChain.then(() => this.onClientMessage(raw)).catch((err) => {
      log("error", "client message failed", { error: String(err) });
      this.end(1011);
    });
    return this.clientChain;
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string): Promise<void> {
    this.end();
  }

  override async webSocketError(_ws: WebSocket, err: unknown): Promise<void> {
    log("warn", "client socket error", { error: String(err) });
    this.end();
  }

  private async onClientMessage(raw: string | ArrayBuffer): Promise<void> {
    if (this.ended) return;
    if (typeof raw !== "string") return; // binary frames are not part of the protocol
    let msg: Msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      this.end(1007); // Python: json.loads raised and the bridge ended
      return;
    }
    if (this.mode === "phone" && this.phone) {
      const result = await this.phone.onTwilio(msg);
      if (result === "stop") {
        this.end(this.xaiStarted ? 1000 : 1008);
        return;
      }
      if (msg.event === "start" && this.phone.authorized && !this.xaiStarted) await this.startXai();
    } else if (this.browser) {
      if ((await this.browser.onClient(msg)) === "stop") this.end();
    } else {
      this.end(1011); // evicted mid-session: state is gone, end cleanly
    }
  }

  private sendClient(msg: Msg): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(msg));
  }

  // --------------------------------------------------------------- xAI side
  private async startXai(): Promise<void> {
    if (this.xaiStarted || this.ended) return;
    this.xaiStarted = true;
    let xai: WebSocket;
    try {
      xai = await connectXai(this.env);
    } catch (err) {
      log("error", "Could not connect to xAI", { error: String(err) });
      if (this.mode === "browser") this.sendClient({ type: "error", message: "Could not connect to xAI. Is XAI_API_KEY set?" });
      this.end(1011);
      return;
    }
    if (this.ended) { xai.close(1000); return; }
    this.xai = xai;
    const bridge = this.phone ?? this.browser!;
    xai.addEventListener("message", (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return; // binary transport not enabled
      const data = ev.data;
      this.xaiChain = this.xaiChain.then(() => bridge.onXai(JSON.parse(data))).catch((err) => {
        log("error", "bridge task failed", { session: bridge.label, error: String(err) });
        this.end(1011);
      });
    });
    xai.addEventListener("close", () => this.end());
    xai.addEventListener("error", () => this.end(1011));
  }

  private sendXai(msg: Msg): void {
    if (this.xai && this.xai.readyState === WebSocket.OPEN) this.xai.send(JSON.stringify(msg));
  }

  // ------------------------------------------------------------------ end
  private end(code = 1000): void {
    if (this.ended) return;
    this.ended = true;
    try { this.xai?.close(1000); } catch { /* already closed */ }
    if (this.mode === "browser") this.sendClient({ type: "status", state: "ended" });
    try { this.client?.close(code, code === 1008 ? "Policy violation" : ""); } catch { /* already closed */ }
  }
}
