// Live crew feed: one Durable Object holds every open WebSocket (hibernating between events, so idle sockets cost nothing).
// Staff sockets (flight surgeon, therapist, admin, service) get every event; an astronaut's socket gets only their own
// events plus crew-wide ones (space weather). The Worker publishes events with POST /publish on the object.
import { DurableObject } from "cloudflare:workers";
import { getSessionPrincipalByReference, STAFF_ROLES, type AuthEnv } from "./auth";

export interface LiveEvent {
  type: "observation" | "alert" | "risk" | "journal" | "space_weather" | "media" | "task";
  user_id?: string;
  data: unknown;
  ts?: string;
}

interface FeedConnection {
  kind: "user" | "service";
  staff: boolean;
  user_id: string | null;
  sessionRef: string | null;
}

export class CrewFeed extends DurableObject<AuthEnv> {
  constructor(ctx: DurableObjectState, env: AuthEnv) {
    super(ctx, env);
    // Keepalive answered by the runtime without waking the object
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  private async verifyConnection(ws: WebSocket) {
    const connection = ws.deserializeAttachment() as FeedConnection | null;
    if (connection?.kind === "service") return true;
    const session = connection?.sessionRef
      ? await getSessionPrincipalByReference(connection.sessionRef, this.env)
      : null;
    if (connection && session && session.user_id === connection.user_id &&
        STAFF_ROLES.has(session.role ?? "") === connection.staff) return true;
    ws.close(1008, "Sign in again");
    return false;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/publish" && request.method === "POST") {
      const { staff_only, ...ev } = (await request.json()) as LiveEvent & { staff_only?: boolean };
      const msg = JSON.stringify({ ...ev, ts: ev.ts ?? new Date().toISOString() });
      const targets = staff_only
        ? this.ctx.getWebSockets("staff")
        : ev.user_id
          ? [...this.ctx.getWebSockets("staff"), ...this.ctx.getWebSockets(`user:${ev.user_id}`)]
          : this.ctx.getWebSockets();
      let sent = 0;
      await Promise.all([...new Set(targets)].map(async (ws) => {
        try {
          if (await this.verifyConnection(ws)) {
            ws.send(msg);
            sent++;
          }
        } catch {
          // Drop this event if the session could not be checked.
        }
      }));
      return Response.json({ sent });
    }

    if (url.pathname === "/stats") {
      return Response.json({ connections: this.ctx.getWebSockets().length, staff: this.ctx.getWebSockets("staff").length });
    }

    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    // The Worker has already authenticated the caller and passes who they are in this internal header.
    const who = JSON.parse(request.headers.get("X-Live-Principal") ?? "{}") as FeedConnection;
    const tags = who.staff ? ["staff"] : who.user_id ? [`user:${who.user_id}`] : [];
    if (!tags.length || (who.kind !== "service" && !who.sessionRef)) return new Response("Forbidden", { status: 403 });

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment(who);
    server.send(JSON.stringify({ type: "hello", data: { scope: who.staff ? "crew" : "self", connections: this.ctx.getWebSockets().length } }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Clients only listen; answer a manual "stats" request, ignore everything else.
    if (message === "stats" && await this.verifyConnection(ws)) ws.send(JSON.stringify({ type: "stats", data: { connections: this.ctx.getWebSockets().length } }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket) {
    ws.close(1011, "error");
  }
}
