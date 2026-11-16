import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthEnv } from "../src/auth";
import { CrewFeed } from "../src/live";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(public ctx: DurableObjectState, public env: AuthEnv) {}
  },
}));

afterEach(() => vi.unstubAllGlobals());

describe("live feed session checks", () => {
  it("stops sending to an open staff connection after the D1 role is removed", async () => {
    vi.stubGlobal("WebSocketRequestResponsePair", class {});
    let role = "flight_surgeon";
    const staffSession = {
      user_id: "fixture-staff", role, provider: "cloudflare_access_staff",
      audience: "staff-fixture", expires: Date.now() + 60_000,
    };
    const ws = {
      deserializeAttachment: () => ({
        kind: "user", staff: true, user_id: staffSession.user_id, sessionRef: "sess:fixture",
      }),
      send: vi.fn(),
      close: vi.fn(),
    };
    const feed = new CrewFeed({
      setWebSocketAutoResponse: vi.fn(),
      getWebSockets: () => [ws],
    } as unknown as DurableObjectState, {
      DB: { prepare: () => ({ bind: () => ({ first: async () => ({ role }) }) }) },
      SESSIONS: { get: async () => staffSession },
      ACCESS_TEAM_DOMAIN: "fixture.cloudflareaccess.com",
      ACCESS_AUD: "crew-fixture",
    } as unknown as AuthEnv);
    const publish = () => feed.fetch(new Request("https://live/publish", {
      method: "POST", body: JSON.stringify({ type: "task", staff_only: true, data: { fixture: true } }),
    }));

    expect(await (await publish()).json()).toEqual({ sent: 1 });
    role = "astronaut";
    expect(await (await publish()).json()).toEqual({ sent: 0 });
    expect(ws.send).toHaveBeenCalledTimes(1);
    expect(ws.close).toHaveBeenCalledWith(1008, "Sign in again");
  });
});
