import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { queueFlightSurgeonMessage, saveCheckin } from "../src/tools";
import { makeEnv, resetDb, testEnv, toolCtx, WsInbox } from "./helpers";

const TOKEN = "test-browser-token";
const call = (req: Request, env: Env = makeEnv()) => handleRequest(req, env);
const auth = { Authorization: `Bearer ${TOKEN}` };

async function openWs(url: string, headers: Record<string, string> = {}) {
  const res = await exports.default.fetch(url, { headers: { Upgrade: "websocket", ...headers } });
  return res;
}

describe("app/browser REST API (api/voice_browser.py + React Native)", () => {
  beforeEach(resetDb);

  it("latest check-in and downlink endpoints (both /api and /voice/api paths)", async () => {
    for (const prefix of ["/api", "/voice/api"]) {
      expect(await (await call(new Request(`https://evade.health${prefix}/checkins/latest`, { headers: auth }))).json()).toEqual({ checkin: null });
      expect(await (await call(new Request(`https://evade.health${prefix}/downlink`, { headers: auth }))).json()).toEqual({ messages: [] });
    }
    await saveCheckin(toolCtx(), "a", { sleep_hours: 8, mood: 4 });
    await saveCheckin(toolCtx(), "b", { sleep_hours: 3, mood: 2 });
    await queueFlightSurgeonMessage(toolCtx(), "b", { message: "m1", priority: "routine" });
    await queueFlightSurgeonMessage(toolCtx(), "b", { message: "m2", priority: "urgent" });
    const latest = (await (await call(new Request("https://evade.health/api/checkins/latest", { headers: auth }))).json() as any).checkin;
    expect(latest).toMatchObject({ crew_id: "b", level: "red" });
    expect(Array.isArray(latest.reasons) && latest.actions.length > 0).toBe(true);
    const onlyA = (await (await call(new Request(`https://evade.health/voice/api/checkins/latest?crew_id=a&token=${TOKEN}`))).json() as any).checkin;
    expect(onlyA.level).toBe("green");
    const msgs = (await (await call(new Request("https://evade.health/api/downlink?limit=5", { headers: auth }))).json() as any).messages;
    expect(msgs.map((m: any) => m.message)).toEqual(["m2", "m1"]);
    expect(msgs[0]).toMatchObject({ comms_mode: "online", priority: "urgent" });
  });

  it("limit is validated like Query(10, ge=1, le=100)", async () => {
    for (const bad of ["0", "101", "abc"]) {
      expect((await call(new Request(`https://evade.health/api/downlink?limit=${bad}`, { headers: auth }))).status).toBe(422);
    }
  });

  it("data endpoints need the token on the public host", async () => {
    expect((await call(new Request("https://evade.health/api/checkins/latest"))).status).toBe(403);
    expect((await call(new Request("https://evade.health/voice/api/downlink?token=wrong"))).status).toBe(403);
    expect((await call(new Request("https://evade.health/api/downlink", { headers: { Authorization: "Bearer wrong" } }))).status).toBe(403);
  });

  it("local dev (wrangler dev on localhost) is allowed, but not cross-origin", async () => {
    const env = makeEnv({ EVADE_BROWSER_TOKEN: "" });
    expect((await call(new Request("http://localhost:8787/voice/api/downlink"), env)).status).toBe(200);
    expect((await call(new Request("http://localhost:8787/voice/api/downlink", { headers: { Origin: "http://localhost:8787" } }), env)).status).toBe(200);
    expect((await call(new Request("http://localhost:8787/voice/api/downlink", { headers: { Origin: "https://evil.example" } }), env)).status).toBe(403);
    expect((await call(new Request("https://evade.health/voice/api/downlink"), env)).status).toBe(403);
  });

  it.each([
    ["https://evade.health", "https://evade.health"],
    ["https://www.evade.health", "https://www.evade.health"],
    ["https://evil.example", null],
    ["https://evade.health.evil.example", null],
    ["https://preview.evade.health", null],
  ])("sets CORS headers for %s according to the Wrangler allowlist", async (origin, allowed) => {
    const url = "https://evade.health/api/downlink";
    const preflight = await call(new Request(url, {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "GET" },
    }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");

    const response = await call(new Request(url, { headers: { ...auth, Origin: origin } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
    if (allowed) expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("serves API requests without an Origin header", async () => {
    const response = await call(new Request("https://evade.health/api/downlink", { headers: auth }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("POST /api/voice/start returns a one-time WebSocket ticket", async () => {
    expect((await call(new Request("https://evade.health/api/voice/start", { method: "POST" }))).status).toBe(403);
    const r = await call(new Request("https://evade.health/api/voice/start", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ crew: "astro-1" }) }),
      makeEnv({ PUBLIC_BASE_URL: "https://evade.health" }));
    const body = await r.json() as any;
    expect(body.ticket).toMatch(/^ws\./);
    expect(body.crew_id).toBe("astro-1");
    expect(body.ws_url).toBe(`wss://evade.health/api/voice/ws?ticket=${encodeURIComponent(body.ticket)}&crew=astro-1`);
    expect(body.audio.input).toMatchObject({ format: "pcm16le", sample_rate: 24000 });
  });
});

describe("voice WebSockets end to end (Durable Object + fake xAI)", () => {
  beforeEach(resetDb);

  it("browser socket rejected without a token", async () => {
    const r = await openWs("https://evade.health/voice/browser");
    expect(r.status).toBe(403);
    expect(r.webSocket).toBeNull();
  });

  it("app socket: session setup, tool call, transcripts, playback mark, stop", async () => {
    const r = await openWs(`https://evade.health/api/voice/ws?token=${TOKEN}&crew=astro-1`);
    expect(r.status).toBe(101);
    const ws = r.webSocket!;
    ws.accept();
    const inbox = new WsInbox(ws);
    expect((await inbox.waitFor((m) => m.type === "status")).state).toBe("connecting");
    await inbox.waitFor((m) => m.type === "status" && m.state === "ready");
    ws.send(JSON.stringify({ type: "audio", audio: "UENNMTY=" }));
    expect(await inbox.waitFor((m) => m.type === "clear")).toEqual({ type: "clear" });
    expect(await inbox.waitFor((m) => m.type === "transcript" && m.role === "user"))
      .toEqual({ type: "transcript", role: "user", id: "u1", text: "I slept three hours, mood two", final: true });
    expect((await inbox.waitFor((m) => m.type === "audio")).audio).toBe("UENNMTY="); // untouched
    expect((await inbox.waitFor((m) => m.type === "transcript" && m.role === "agent")).delta).toBe("One moment.");
    const tool = await inbox.waitFor((m) => m.type === "tool_result");
    expect(tool.name).toBe("save_checkin");
    expect(tool.result.level).toBe("red");
    const mark = await inbox.waitFor((m) => m.type === "mark");
    expect(mark.name).toBe("evade-tools-1");
    ws.send(JSON.stringify({ type: "mark", name: mark.name }));
    ws.send(JSON.stringify({ type: "ping" }));
    await inbox.waitFor((m) => m.type === "pong");
    ws.send(JSON.stringify({ type: "stop" }));
    await inbox.waitFor((m) => m.type === "status" && m.state === "ended");
    await inbox.waitClosed();
    const saved = await testEnv.DB.prepare("SELECT crew_id, level FROM checkins").first();
    expect(saved).toEqual({ crew_id: "astro-1", level: "red" });
  });

  it("one-time ticket from /api/voice/start opens the socket once", async () => {
    const start = await exports.default.fetch("https://evade.health/api/voice/start?crew=t1", { method: "POST", headers: auth });
    const { ticket } = await start.json() as any;
    const r = await openWs(`https://evade.health/api/voice/ws?ticket=${encodeURIComponent(ticket)}&crew=t1`);
    expect(r.status).toBe(101);
    r.webSocket!.accept();
    r.webSocket!.close(1000);
    expect((await openWs(`https://evade.health/api/voice/ws?ticket=${encodeURIComponent(ticket)}`)).status).toBe(403);
  });

  it("phone: /voice/incoming token -> /voice/stream bridges audio to xAI and back", async () => {
    const twiml = await (await exports.default.fetch("https://evade.health/voice/incoming", { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "CallSid=CA9&From=%2B15550001111" })).text();
    const token = /name="token" value="([^"]+)"/.exec(twiml)![1];
    expect(twiml).toContain('url="wss://evade.health/voice/stream"');
    const r = await openWs("https://evade.health/voice/stream");
    expect(r.status).toBe(101);
    const ws = r.webSocket!;
    ws.accept();
    const inbox = new WsInbox(ws);
    ws.send(JSON.stringify({ event: "connected", protocol: "Call", version: "1.0.0" }));
    ws.send(JSON.stringify({ event: "start", sequenceNumber: "1", streamSid: "MZ9", start: { streamSid: "MZ9", callSid: "CA9",
      tracks: ["inbound"], mediaFormat: { encoding: "audio/x-mulaw", sampleRate: 8000, channels: 1 },
      customParameters: { caller: "+15550001111", token } } }));
    // Send audio until the session is ready and the fake echoes it back reversed.
    let reply;
    for (let i = 0; i < 40 && !reply; i++) {
      ws.send(JSON.stringify({ event: "media", streamSid: "MZ9", media: { track: "inbound", payload: "abcd" } }));
      await new Promise((res) => setTimeout(res, 50));
      reply = inbox.msgs.find((m) => m.event === "media");
    }
    expect(reply).toEqual({ event: "media", streamSid: "MZ9", media: { payload: "dcba" } });
    ws.send(JSON.stringify({ event: "stop", streamSid: "MZ9" }));
    expect((await inbox.waitClosed()).code).toBe(1000);
  });

  it("phone: forged token closes the stream with 1008 before any xAI session", async () => {
    const r = await openWs("https://evade.health/voice/stream");
    const ws = r.webSocket!;
    ws.accept();
    const inbox = new WsInbox(ws);
    ws.send(JSON.stringify({ event: "start", start: { streamSid: "MZ8", customParameters: { caller: "x", token: "forged" } } }));
    expect((await inbox.waitClosed()).code).toBe(1008);
    expect(inbox.msgs).toEqual([]);
  });
});
