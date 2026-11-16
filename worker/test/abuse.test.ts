import { describe, expect, it, vi } from "vitest";
import { handleRequest } from "../src/index";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));

const SITE = "https://evade.health";
function limiter() {
  const used = new Set<string>();
  return {
    limit: async ({ key }: { key: string }) => {
      if (used.has(key)) return { success: false };
      used.add(key);
      return { success: true };
    },
  };
}

function request(path: string, ip = "192.0.2.1") {
  const ticket = path === "/api/voice/start";
  return new Request(SITE + path, {
    method: ticket ? "POST" : "GET",
    headers: { "CF-Connecting-IP": ip, ...(ticket ? {} : { Upgrade: "websocket" }) },
  });
}

describe("voice abuse guards", () => {
  it("limits ticket issuance per IP", async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => ({ n: 0 }) }) }),
      batch: async () => [],
    };
    const env = { DEMO_OPEN: "true", DB: db, VOICE_START_IP_LIMITER: limiter() } as unknown as Env;
    expect((await handleRequest(request("/api/voice/start"), env)).status).toBe(200);
    const denied = await handleRequest(request("/api/voice/start"), env);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect((await handleRequest(request("/api/voice/start", "192.0.2.2"), env)).status).toBe(200);
  });

  it("shares the handshake bucket across voice WebSocket aliases", async () => {
    const env = { VOICE_SOCKET_IP_LIMITER: limiter() } as unknown as Env;
    expect((await handleRequest(request("/api/voice/ws"), env)).status).toBe(403); // passed the IP check
    const denied = await handleRequest(request("/voice/browser"), env);
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect((await handleRequest(request("/voice/browser", "192.0.2.2"), env)).status).toBe(403);
  });

  it("returns the paused message before touching D1 or issuing a ticket", async () => {
    const counter = {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async () => Response.json({
        calls: { count: 4, budget: 5 }, voice_seconds: { count: 300, budget: 300 },
      }) }),
    };
    const env = { DEMO_OPEN: "true", ABUSE_BUDGET: counter } as unknown as Env;
    const denied = await handleRequest(request("/api/voice/start"), env);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(await denied.json()).toMatchObject({ detail: expect.stringContaining("Voice is paused for today") });
  });
});
