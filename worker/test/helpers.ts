import { env } from "cloudflare:workers";
import type { Msg } from "../src/agent";
import type { ToolContext } from "../src/tools";

export const testEnv = env as unknown as Env & Record<string, unknown>;

/** Env with overrides; "" means unset (like delenv in the Python conftest). */
export function makeEnv(overrides: Record<string, string> = {}): Env {
  return { ...testEnv, TWILIO_AUTH_TOKEN: "", EVADE_ALERT_TOKEN: "", PUBLIC_BASE_URL: "", ...overrides } as unknown as Env;
}

export function toolCtx(overrides: Record<string, string> = {}): ToolContext {
  return { db: testEnv.DB, env: makeEnv(overrides) };
}

export async function resetDb(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare("DELETE FROM checkins"),
    testEnv.DB.prepare("DELETE FROM downlink_queue"),
    testEnv.DB.prepare("DELETE FROM stream_tokens"),
    testEnv.DB.prepare("DELETE FROM sqlite_sequence WHERE name IN ('checkins','downlink_queue')"),
  ]);
}

export class Recorder {
  client: Msg[] = [];
  xai: Msg[] = [];
  toClient = (m: Msg) => { this.client.push(m); };
  toXai = (m: Msg) => { this.xai.push(m); };
}

/** Collect JSON messages from a WebSocket; wait for one matching a predicate. */
export class WsInbox {
  msgs: Msg[] = [];
  closed: { code: number } | null = null;
  private waiters: Array<() => void> = [];
  constructor(public ws: WebSocket) {
    ws.addEventListener("message", (e) => { this.msgs.push(JSON.parse(e.data as string)); this.flush(); });
    ws.addEventListener("close", (e) => { this.closed = { code: e.code }; this.flush(); });
  }
  private flush() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async waitFor(pred: (m: Msg) => boolean, timeoutMs = 3000): Promise<Msg> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.msgs.find(pred);
      if (found) return found;
      if (this.closed) throw new Error(`socket closed (${this.closed.code}) before expected message; got ${JSON.stringify(this.msgs)}`);
      if (Date.now() > deadline) throw new Error(`timeout; got ${JSON.stringify(this.msgs)}`);
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 50); });
    }
  }
  async waitClosed(timeoutMs = 3000): Promise<{ code: number }> {
    const deadline = Date.now() + timeoutMs;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error("timeout waiting for close");
      await new Promise<void>((r) => { this.waiters.push(r); setTimeout(r, 50); });
    }
    return this.closed;
  }
}
