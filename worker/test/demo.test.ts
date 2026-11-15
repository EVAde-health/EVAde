import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { makeEnv, resetDb, WsInbox } from "./helpers";

const call = (req: Request, env: Env) => handleRequest(req, env);
const open = (url: string, env: Env, headers: Record<string, string> = {}) =>
  call(new Request(url, { headers: { Upgrade: "websocket", ...headers } }), env);

describe("DEMO_OPEN access and spending guards", () => {
  beforeEach(resetDb);

  it("opens the browser voice endpoints without a token when DEMO_OPEN is true", async () => {
    const env = makeEnv({ DEMO_OPEN: "true" });
    for (const path of [
      "/api/checkins/latest",
      "/api/downlink",
      "/voice/api/checkins/latest",
      "/voice/api/downlink",
    ]) {
      expect((await call(new Request(`https://evade.health${path}`), env)).status).toBe(200);
    }
    const start = await call(new Request("https://evade.health/api/voice/start", { method: "POST" }), env);
    expect(start.status).toBe(200);
    expect((await start.json() as { ticket: string }).ticket).toMatch(/^ws\./);

    for (const path of ["/voice/browser", "/api/voice/ws"]) {
      const r = await open(`https://evade.health${path}`, env);
      expect(r.status).toBe(101);
      expect(r.webSocket).toBeTruthy();
      const ws = r.webSocket!;
      ws.accept();
      const inbox = new WsInbox(ws);
      expect((await inbox.waitFor((m) => m.type === "status")).state).toBe("connecting");
      ws.close(1000);
      await inbox.waitClosed();
    }
  });

  it("keeps /api/alert and /voice/alert token-protected when DEMO_OPEN is true", async () => {
    const env = makeEnv({ DEMO_OPEN: "true", EVADE_ALERT_TOKEN: "abc" });
    const mk = (path: string, headers: Record<string, string> = {}) =>
      new Request(`https://evade.health${path}`, { method: "POST", headers, body: JSON.stringify({ to: "+15550001111" }) });
    expect((await call(mk("/api/alert"), env)).status).toBe(401);
    expect((await call(mk("/voice/alert"), env)).status).toBe(401);
    expect((await call(mk("/api/alert", { "X-EVADE-Token": "nope" }), env)).status).toBe(401);
    // right token passes auth and reaches the (unconfigured) Twilio check
    const noTwilio = makeEnv({ DEMO_OPEN: "true", EVADE_ALERT_TOKEN: "abc", TWILIO_ACCOUNT_SID: "" });
    expect((await call(mk("/api/alert", { "X-EVADE-Token": "abc" }), noTwilio)).status).toBe(503);
    expect((await call(mk("/voice/alert", { Authorization: "Bearer abc" }), noTwilio)).status).toBe(503);
  });

  it("rejects a new browser session when the concurrency cap is full", async () => {
    const env = makeEnv({ DEMO_OPEN: "true", MAX_CONCURRENT_SESSIONS: "1" });
    const first = await open("https://evade.health/voice/browser", env);
    expect(first.status).toBe(101);
    const ws1 = first.webSocket!;
    ws1.accept();
    const inbox1 = new WsInbox(ws1);
    await inbox1.waitFor((m) => m.type === "status" && m.state === "connecting");

    const start = await call(new Request("https://evade.health/api/voice/start", { method: "POST" }), env);
    expect(start.status).toBe(429);
    expect(await start.json()).toEqual({ detail: "too many people talking" });

    const second = await open("https://evade.health/api/voice/ws", env);
    expect(second.status).toBe(101);
    const ws2 = second.webSocket!;
    ws2.accept();
    const inbox2 = new WsInbox(ws2);
    const notice = await inbox2.waitFor((m) => m.type === "notice" || m.type === "error");
    expect(notice.message).toBe("too many people talking");
    const closed = await inbox2.waitClosed();
    expect(closed.code).toBe(1000);
    expect(closed.reason).toBe("too many people talking");

    // freeing the first slot lets a new session in
    ws1.close(1000);
    await inbox1.waitClosed();
    // release is async via waitUntil; retry briefly
    let third: Response | null = null;
    for (let i = 0; i < 20; i++) {
      third = await open("https://evade.health/voice/browser", env);
      if (third.status === 101 && third.webSocket) {
        const probe = new WsInbox(third.webSocket);
        third.webSocket.accept();
        const firstMsg = await Promise.race([
          probe.waitFor((m) => m.type === "status" && m.state === "connecting"),
          probe.waitFor((m) => m.type === "error" || m.type === "notice"),
        ]);
        if (firstMsg.type === "status") {
          third.webSocket.close(1000);
          return;
        }
        await probe.waitClosed().catch(() => {});
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("slot was not released after the first session closed");
  });

  it("closes a browser session when MAX_SESSION_SECONDS is exceeded", async () => {
    const env = makeEnv({ DEMO_OPEN: "true", MAX_SESSION_SECONDS: "1" });
    const r = await open("https://evade.health/voice/browser", env);
    expect(r.status).toBe(101);
    const ws = r.webSocket!;
    ws.accept();
    const inbox = new WsInbox(ws);
    const notice = await inbox.waitFor(
      (m) => m.type === "notice" && m.message === "session limit reached",
      4000,
    );
    expect(notice.message).toBe("session limit reached");
    await inbox.waitFor((m) => m.type === "status" && m.state === "ended" && m.reason === "session limit reached", 1000);
    const closed = await inbox.waitClosed(1000);
    expect(closed.code).toBe(1000);
    expect(closed.reason).toBe("session limit reached");
  });
});
