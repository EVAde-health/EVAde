// Stands in for wss://api.x.ai/v1/realtime in tests (wired as the main Worker's
// outbound service). Scripted like the live service:
// session.created + conversation.created -> (session.update) -> session.updated.
// Phone (audio/pcmu): echoes appended audio reversed as an output_audio delta.
// Browser (audio/pcm): VAD start, user transcript, then a save_checkin tool call.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname === "api.twilio.com") return fakeTwilio(request, url);
    if (url.hostname !== "api.x.ai") return new Response("blocked in tests", { status: 502 });
    if (request.headers.get("Authorization") !== "Bearer test-xai-key") return new Response("unauthorized", { status: 401 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("upgrade required", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const emit = (ev) => server.send(JSON.stringify(ev));
    let browser = false;
    let toolDone = false;
    server.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "session.update") {
        browser = msg.session.audio.input.format.type === "audio/pcm";
        emit({ type: "session.updated", session: msg.session });
      } else if (msg.type === "input_audio_buffer.append") {
        if (!browser) {
          emit({ type: "response.output_audio.delta", delta: [...msg.audio].reverse().join("") });
        } else if (!toolDone) {
          toolDone = true;
          emit({ type: "input_audio_buffer.speech_started" });
          emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "u1",
                 transcript: "I slept three hours, mood two" });
          emit({ type: "response.created", response: { id: "r1" } });
          emit({ type: "response.output_audio.delta", response_id: "r1", delta: msg.audio });
          emit({ type: "response.output_audio_transcript.delta", response_id: "r1", delta: "One moment." });
          emit({ type: "response.function_call_arguments.done", name: "save_checkin", call_id: "call-1",
                 arguments: JSON.stringify({ sleep_hours: 3, mood: 2 }) });
          emit({ type: "response.done", response: { id: "r1", output: [] } });
        }
      } else {
        server.send(JSON.stringify({ type: "_echo", got: msg }));
      }
    });
    emit({ type: "session.created" });
    emit({ type: "conversation.created", conversation: { id: "c1" } });
    return new Response(null, { status: 101, webSocket: client });
  },
};

async function fakeTwilio(request, url) {
  const expected = "Basic " + btoa("AC" + "0".repeat(32) + ":tok");
  if (request.headers.get("Authorization") !== expected) {
    return Response.json({ message: "Authenticate" }, { status: 401 });
  }
  if (!url.pathname.endsWith("/Calls.json")) return new Response("not found", { status: 404 });
  const form = new URLSearchParams(await request.text());
  return Response.json({ sid: "CA999", status: "queued", to: form.get("To"), from: form.get("From"),
                         twiml: form.get("Twiml") }, { status: 201 });
}
