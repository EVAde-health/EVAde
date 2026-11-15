import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleRequest } from "../src/index";
import { consumeStreamToken } from "../src/tokens";
import { alertTwiml, computeSignature, createCall, validateSignature } from "../src/twilio";
import { makeEnv, resetDb, testEnv } from "./helpers";

const FORM = { CallSid: "CA123", From: "+15550001111", To: "+15550002222" };
const PUBLIC = "https://evade.example.ngrok.app";

function post(url: string, body: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", body: new URLSearchParams(body).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers } });
}
const call = (req: Request, env: Env) => handleRequest(req, env);

function parseStream(xml: string) {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream ')).toBe(true);
  const url = /<Stream url="([^"]+)"/.exec(xml)![1];
  const params: Record<string, string> = {};
  for (const m of xml.matchAll(/<Parameter name="([^"]+)" value="([^"]*)" \/>/g)) params[m[1]] = m[2];
  return { url, params };
}

describe("phone routes (api/voice.py)", () => {
  beforeEach(resetDb);

  it("incoming returns Connect/Stream TwiML with a one-time D1 token", async () => {
    const r = await call(post("https://evade.health/voice/incoming", FORM), makeEnv({ PUBLIC_BASE_URL: PUBLIC + "/" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^application\/xml/);
    const { url, params } = parseStream(await r.text());
    expect(url).toBe("wss://evade.example.ngrok.app/voice/stream");
    expect(params.caller).toBe("+15550001111");
    expect(params.token).toBeTruthy();
    expect(await consumeStreamToken(testEnv.DB, params.token)).toBe(true);
    expect(await consumeStreamToken(testEnv.DB, params.token)).toBe(false); // one-time
  });

  it("incoming falls back to the Host header", async () => {
    const r = await call(post("http://localhost:8787/voice/incoming", FORM, { host: "localhost:8000" }), makeEnv());
    expect(parseStream(await r.text()).url).toBe("wss://localhost:8000/voice/stream");
  });

  it("caller defaults to unknown and values are XML-escaped", async () => {
    const r = await call(post("https://evade.health/voice/incoming", { From: 'a"<b>&' }), makeEnv({ PUBLIC_BASE_URL: PUBLIC }));
    expect(await r.text()).toContain('value="a&quot;&lt;b&gt;&amp;"');
    const r2 = await call(post("https://evade.health/voice/incoming", {}), makeEnv({ PUBLIC_BASE_URL: PUBLIC }));
    expect(parseStream(await r2.text()).params.caller).toBe("unknown");
  });

  it("signature rejected when missing or wrong", async () => {
    const env = makeEnv({ TWILIO_AUTH_TOKEN: "secret-token", PUBLIC_BASE_URL: PUBLIC });
    const r = await call(post("https://evade.health/voice/incoming", FORM), env);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ detail: "Invalid Twilio signature" });
    expect((await call(post("https://evade.health/voice/incoming", FORM, { "X-Twilio-Signature": "bogus" }), env)).status).toBe(403);
  });

  it("signature accepted when valid (signed against PUBLIC_BASE_URL)", async () => {
    const env = makeEnv({ TWILIO_AUTH_TOKEN: "secret-token", PUBLIC_BASE_URL: PUBLIC });
    const sig = await computeSignature("secret-token", PUBLIC + "/voice/incoming", FORM);
    const r = await call(post("https://internal.workers.dev/voice/incoming", FORM, { "X-Twilio-Signature": sig }), env);
    expect(r.status).toBe(200);
    parseStream(await r.text());
  });

  it("signature matches twilio-python's reference value and port variants", async () => {
    // Reference values computed with twilio-python's RequestValidator (twilio 9.x).
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
    const url = "https://example.com/myapp.php?foo=1&bar=2";
    const sig = await computeSignature("12345", url, params);
    expect(sig).toBe("vNe7KK2kJwCsxc9K3OLkkKB3qqI=");
    expect(await computeSignature("12345", "https://evade.example.ngrok.app/voice/incoming", FORM)).toBe("WzK/23U6YGG3ALxwVzC2HxWHj1A=");
    expect(await validateSignature("12345", url, params, sig)).toBe(true);
    expect(await validateSignature("12345", "https://example.com:443/myapp.php?foo=1&bar=2", params, sig)).toBe(true);
    expect(await validateSignature("wrong", url, params, sig)).toBe(false);
  });

  it("signature check can be disabled", async () => {
    const env = makeEnv({ TWILIO_AUTH_TOKEN: "secret-token", TWILIO_VALIDATE_SIGNATURE: "false" });
    expect((await call(post("https://evade.health/voice/incoming", FORM), env)).status).toBe(200);
  });

  it("alert requires twilio config (local caller, no alert token)", async () => {
    const r = await call(new Request("http://localhost:8787/voice/alert", { method: "POST", body: JSON.stringify({ to: "+15550001111" }) }),
      makeEnv({ TWILIO_ACCOUNT_SID: "", TWILIO_PHONE_NUMBER: "" }));
    expect(r.status).toBe(503);
  });

  it("alert refused remotely when EVADE_ALERT_TOKEN is unset", async () => {
    const r = await call(new Request("https://evade.health/voice/alert", { method: "POST", body: JSON.stringify({ to: "+1" }) }), makeEnv());
    expect(r.status).toBe(403);
  });

  it("alert token enforced (X-EVADE-Token or Bearer)", async () => {
    const env = makeEnv({ EVADE_ALERT_TOKEN: "abc" });
    const mk = (h: Record<string, string>) => new Request("https://evade.health/api/alert", { method: "POST", headers: h, body: JSON.stringify({ to: "+15550001111" }) });
    expect((await call(mk({}), env)).status).toBe(401);
    expect((await call(mk({ "X-EVADE-Token": "nope" }), env)).status).toBe(401);
    // right token passes auth and reaches the (unconfigured) Twilio check
    const noTwilio = makeEnv({ EVADE_ALERT_TOKEN: "abc", TWILIO_ACCOUNT_SID: "" });
    expect((await call(mk({ "X-EVADE-Token": "abc" }), noTwilio)).status).toBe(503);
    expect((await call(mk({ Authorization: "Bearer abc" }), noTwilio)).status).toBe(503);
  });

  it("alert validates the body like the pydantic model", async () => {
    const env = makeEnv({ EVADE_ALERT_TOKEN: "abc" });
    const mk = (body: unknown) => new Request("https://evade.health/voice/alert", { method: "POST", headers: { "X-EVADE-Token": "abc" }, body: JSON.stringify(body) });
    expect((await call(mk({}), env)).status).toBe(422);
    expect((await call(mk({ to: "+1", message: "x".repeat(601) }), env)).status).toBe(422);
  });

  it("alert places a call via the Twilio REST API", async () => {
    const env = makeEnv({ TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "tok", TWILIO_PHONE_NUMBER: "+15550009999", EVADE_ALERT_TOKEN: "abc" });
    const r = await call(new Request("https://evade.health/voice/alert", { method: "POST", headers: { "X-EVADE-Token": "abc" },
      body: JSON.stringify({ to: "+15550001111", message: "Red alert test" }) }), env);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ call_sid: "CA999", status: "queued" });
  });

  it("createCall sends To/From/Twiml with basic auth", async () => {
    const env = makeEnv({ TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "tok", TWILIO_PHONE_NUMBER: "+15550009999" });
    let seen: { url: string; auth: string | null; form: URLSearchParams } | null = null;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen = { url: String(input), auth: new Headers(init?.headers).get("Authorization"), form: new URLSearchParams(String(init?.body)) };
      return Response.json({ sid: "CA1", status: "queued" }, { status: 201 });
    }) as typeof fetch;
    const twiml = alertTwiml("Red alert test");
    expect(await createCall(env, "+15550001111", twiml, fakeFetch)).toEqual({ call_sid: "CA1", status: "queued" });
    expect(seen!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/AC${"0".repeat(32)}/Calls.json`);
    expect(seen!.auth).toBe("Basic " + btoa(`AC${"0".repeat(32)}:tok`));
    expect(seen!.form.get("To")).toBe("+15550001111");
    expect(seen!.form.get("From")).toBe("+15550009999");
    expect(seen!.form.get("Twiml")).toBe('<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Red alert test</Say><Pause length="1" /><Say voice="Polly.Joanna">Red alert test</Say></Response>');
  });

  it("health", async () => {
    expect(await (await call(new Request("https://evade.health/health"), makeEnv())).json()).toEqual({ status: "ok" });
  });

  it("landing page links to /voice/ and the voice page is served from static assets", async () => {
    const home = await exports.default.fetch("https://evade.health/");
    expect(await home.text()).toContain('href="/voice/"');
    const page = await exports.default.fetch("https://evade.health/voice/");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Talk to EVAde");
    expect((await exports.default.fetch("https://evade.health/voice/app.js")).status).toBe(200);
    expect(await (await exports.default.fetch("https://evade.health/voice/mic-worklet.js")).text()).toContain("registerProcessor");
  });
});
