import { beforeEach, describe, expect, it } from "vitest";
import { sessionUpdate, xaiUrl, connectXai } from "../src/agent";
import { BrowserBridge, CallBridge } from "../src/bridges";
import { consumeStreamToken, issueStreamToken } from "../src/tokens";
import { makeEnv, Recorder, resetDb, testEnv, toolCtx } from "./helpers";

const START = { event: "start", start: { streamSid: "MZ1", callSid: "CA1", customParameters: { caller: "+15550001111" } } };

function makeBridge(requireToken = false) {
  const rec = new Recorder();
  const b = new CallBridge(rec.toClient, rec.toXai, toolCtx(), (t) => consumeStreamToken(testEnv.DB, t), { requireToken });
  return { b, rec };
}

describe("phone bridge (CallBridge in api/voice.py)", () => {
  beforeEach(resetDb);

  it("session setup and greeting", async () => {
    const { b, rec } = makeBridge();
    await b.onXai({ type: "conversation.created", conversation: { id: "c1" } });
    await b.onXai({ type: "session.created" }); // must not configure twice
    expect(rec.xai).toHaveLength(1);
    const s = rec.xai[0];
    expect(s.type).toBe("session.update");
    expect(s.session.audio.input.format.type).toBe("audio/pcmu");
    expect(s.session.audio.output.format.type).toBe("audio/pcmu");
    expect(s.session.turn_detection).toEqual({ type: "server_vad" });
    expect(s.session.voice).toBe("atlas");
    expect(s.session.instructions).toContain("You are EVAde, a calm onboard health co-pilot");
    expect(new Set(s.session.tools.map((t: { name: string }) => t.name))).toEqual(new Set(["save_checkin", "queue_flight_surgeon_message"]));
    await b.onXai({ type: "session.updated" });
    expect(rec.xai[1].type).toBe("conversation.item.create");
    expect(rec.xai[1].item.content[0].text).toBe("The call just connected. Greet the crew member as EVAde and start the daily check-in.");
    expect(rec.xai[2]).toEqual({ type: "response.create" });
    await b.onXai({ type: "session.updated" }); // no second greeting
    expect(rec.xai).toHaveLength(3);
  });

  it("voice/model env override", () => {
    expect(sessionUpdate(makeEnv({ XAI_VOICE: "ara" })).session.voice).toBe("ara");
    expect(xaiUrl(makeEnv({ XAI_MODEL: "grok-voice-3.0" }))).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-3.0");
    expect(xaiUrl(makeEnv({ XAI_MODEL: "" }))).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-latest");
  });

  it("connectXai fails clearly without a key", async () => {
    await expect(connectXai(makeEnv({ XAI_API_KEY: "" }))).rejects.toThrow("XAI_API_KEY is not set");
  });

  it("twilio media forwarded only when ready", async () => {
    const { b, rec } = makeBridge();
    await b.onTwilio(START);
    expect(b.streamSid).toBe("MZ1");
    expect(b.crewId).toBe("+15550001111");
    const media = { event: "media", media: { track: "inbound", payload: "AAAA" } };
    await b.onTwilio(media);
    expect(rec.xai).toEqual([]); // session not ready yet
    b.sessionReady = true;
    await b.onTwilio(media);
    await b.onTwilio({ event: "media", media: { track: "outbound", payload: "BBBB" } });
    expect(rec.xai).toEqual([{ type: "input_audio_buffer.append", audio: "AAAA" }]);
    expect(await b.onTwilio({ event: "stop" })).toBe("stop");
  });

  it("xAI audio to twilio and barge-in", async () => {
    const { b, rec } = makeBridge();
    await b.onTwilio(START);
    await b.onXai({ type: "response.created" });
    await b.onXai({ type: "response.output_audio.delta", delta: "//79" });
    expect(rec.client).toEqual([{ event: "media", streamSid: "MZ1", media: { payload: "//79" } }]);
    await b.onXai({ type: "input_audio_buffer.speech_started" });
    expect(rec.client.at(-1)).toEqual({ event: "clear", streamSid: "MZ1" });
  });

  it("stream token required, one-time, stored in D1", async () => {
    const { b } = makeBridge(true);
    expect(await b.onTwilio(START)).toBe("stop");
    const token = await issueStreamToken(testEnv.DB, "CA1");
    const { b: b2 } = makeBridge(true);
    const start = structuredClone(START) as any;
    start.start.customParameters.token = token;
    expect(await b2.onTwilio(start)).toBeNull();
    expect(b2.authorized).toBe(true);
    expect(await consumeStreamToken(testEnv.DB, token)).toBe(false); // already used
  });

  it("expired stream tokens are rejected", async () => {
    await testEnv.DB.prepare("INSERT INTO stream_tokens (token, call_sid, expires_at) VALUES ('old', NULL, ?)").bind(Date.now() - 1).run();
    expect(await consumeStreamToken(testEnv.DB, "old")).toBe(false);
  });

  it("function call flow waits for playback mark", async () => {
    const { b, rec } = makeBridge();
    await b.onTwilio(START);
    await b.onXai({ type: "response.created" });
    await b.onXai({ type: "response.output_audio.delta", delta: "AAAA" });
    await b.onXai({ type: "response.function_call_arguments.done", name: "save_checkin", call_id: "call_1",
                    arguments: JSON.stringify({ sleep_hours: 3, mood: 2 }) });
    const out = rec.xai.at(-1)!;
    expect(out.type).toBe("conversation.item.create");
    expect(out.item.type).toBe("function_call_output");
    expect(out.item.call_id).toBe("call_1");
    expect(JSON.parse(out.item.output).level).toBe("red");
    // duplicate notification of the same call (output_item.done) is ignored
    await b.onXai({ type: "response.output_item.done", item: { type: "function_call", name: "save_checkin", call_id: "call_1", arguments: "{}" } });
    expect(rec.xai.filter((m) => m.type === "conversation.item.create")).toHaveLength(1);
    expect(rec.xai).not.toContainEqual({ type: "response.create" });
    await b.onXai({ type: "response.done", response: { output: [] } });
    const mark = rec.client.at(-1)!;
    expect(mark.event).toBe("mark");
    expect(mark.streamSid).toBe("MZ1");
    expect(rec.xai).not.toContainEqual({ type: "response.create" }); // still playing
    await b.onTwilio({ event: "mark", streamSid: "MZ1", mark: { name: mark.mark.name } });
    expect(rec.xai.at(-1)).toEqual({ type: "response.create" });
  });

  it("parallel tool calls: single response.create without audio", async () => {
    const { b, rec } = makeBridge();
    await b.onTwilio(START);
    await b.onXai({ type: "response.created" });
    await b.onXai({ type: "response.function_call_arguments.done", name: "save_checkin", call_id: "a", arguments: JSON.stringify({ sleep_hours: 8, mood: 4 }) });
    await b.onXai({ type: "response.function_call_arguments.done", name: "queue_flight_surgeon_message", call_id: "b", arguments: JSON.stringify({ message: "hi", priority: "routine" }) });
    await b.onXai({ type: "response.done" });
    expect(rec.xai.map((m) => m.type)).toEqual(["conversation.item.create", "conversation.item.create", "response.create"]);
  });

  it("function call only in response.done output", async () => {
    const { b, rec } = makeBridge();
    await b.onXai({ type: "response.created" });
    await b.onXai({ type: "response.done", response: { output: [{ type: "function_call", name: "save_checkin", call_id: "z", arguments: JSON.stringify({ sleep_hours: 8, mood: 4 }) }] } });
    expect(rec.xai.map((m) => m.type)).toEqual(["conversation.item.create", "response.create"]);
  });

  it("barge-in cancels pending mark", async () => {
    const { b, rec } = makeBridge();
    await b.onTwilio(START);
    b.pendingMark = "evade-tools-1";
    await b.onXai({ type: "input_audio_buffer.speech_started" });
    await b.onTwilio({ event: "mark", mark: { name: "evade-tools-1" } });
    expect(rec.xai).not.toContainEqual({ type: "response.create" });
  });
});

describe("browser/app bridge (BrowserBridge in api/voice_browser.py)", () => {
  beforeEach(resetDb);

  it("uses 24 kHz PCM with transcription and forwards UI events", async () => {
    const rec = new Recorder();
    const b = new BrowserBridge(rec.toClient, rec.toXai, toolCtx(), "astro-1");
    expect(b.label).toBe("browser:astro-1");
    await b.onXai({ type: "session.created" });
    const upd = rec.xai[0];
    expect(upd.session.audio.input.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(upd.session.audio.output.format).toEqual({ type: "audio/pcm", rate: 24000 });
    expect(upd.session.audio.input.transcription).toEqual({ model: "grok-transcribe" });
    await b.onXai({ type: "session.updated" });
    expect(rec.client).toContainEqual({ type: "status", state: "ready" });
    await b.onClient({ type: "audio", audio: "AAAA" });
    expect(rec.xai.at(-1)).toEqual({ type: "input_audio_buffer.append", audio: "AAAA" });
    await b.onXai({ type: "input_audio_buffer.speech_started" });
    expect(rec.client).toContainEqual({ type: "clear" });
    await b.onXai({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1", transcript: "hi" });
    expect(rec.client.at(-1)).toEqual({ type: "transcript", role: "user", id: "u1", text: "hi", final: true });
    await b.onXai({ type: "response.created" });
    await b.onXai({ type: "response.output_audio.delta", delta: "PCM" });
    expect(rec.client.at(-1)).toEqual({ type: "audio", audio: "PCM" });
    await b.onXai({ type: "response.output_audio_transcript.delta", response_id: "r1", delta: "One moment." });
    expect(rec.client.at(-1)).toEqual({ type: "transcript", role: "agent", id: "r1", delta: "One moment." });
    await b.onXai({ type: "response.function_call_arguments.done", name: "save_checkin", call_id: "c1", arguments: JSON.stringify({ sleep_hours: 3, mood: 2 }) });
    const tool = rec.client.find((m) => m.type === "tool_result")!;
    expect(tool.name).toBe("save_checkin");
    expect(tool.result.level).toBe("red");
    await b.onXai({ type: "response.done", response: { output: [] } });
    const mark = rec.client.at(-1)!;
    expect(mark.type).toBe("mark");
    await b.onClient({ type: "mark", name: mark.name });
    expect(rec.xai.at(-1)).toEqual({ type: "response.create" });
    await b.onXai({ type: "error", error: { message: "boom" } });
    expect(rec.client.at(-1)).toEqual({ type: "error", message: "boom" });
    expect(await b.onClient({ type: "ping" })).toBeNull();
    expect(rec.client.at(-1)).toEqual({ type: "pong" });
    expect(await b.onClient({ type: "stop" })).toBe("stop");
  });
});
