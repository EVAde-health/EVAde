import asyncio
import json

from fastapi.testclient import TestClient

from api import voice
from api.main import app


class Recorder:
    def __init__(self):
        self.twilio, self.xai = [], []

    async def to_twilio(self, msg):
        self.twilio.append(msg)

    async def to_xai(self, msg):
        self.xai.append(msg)


def make_bridge(require_token=False):
    rec = Recorder()
    return voice.CallBridge(rec.to_twilio, rec.to_xai, require_token=require_token), rec


def run(coro):
    return asyncio.run(coro)


START = {"event": "start", "start": {"streamSid": "MZ1", "callSid": "CA1",
                                     "customParameters": {"caller": "+15550001111"}}}


def test_session_setup_and_greeting():
    b, rec = make_bridge()
    run(b.on_xai({"type": "conversation.created", "conversation": {"id": "c1"}}))
    run(b.on_xai({"type": "session.created"}))  # must not configure twice
    assert len(rec.xai) == 1
    s = rec.xai[0]
    assert s["type"] == "session.update"
    assert s["session"]["audio"]["input"]["format"]["type"] == "audio/pcmu"
    assert s["session"]["audio"]["output"]["format"]["type"] == "audio/pcmu"
    assert s["session"]["turn_detection"] == {"type": "server_vad"}
    assert s["session"]["voice"] == "eve"
    assert {t["name"] for t in s["session"]["tools"]} == {"save_checkin", "queue_flight_surgeon_message"}
    run(b.on_xai({"type": "session.updated"}))
    assert rec.xai[1]["type"] == "conversation.item.create"
    assert rec.xai[2] == {"type": "response.create"}
    run(b.on_xai({"type": "session.updated"}))  # no second greeting
    assert len(rec.xai) == 3


def test_voice_env_override(monkeypatch):
    monkeypatch.setenv("XAI_VOICE", "ara")
    assert voice.session_update()["session"]["voice"] == "ara"
    monkeypatch.setenv("XAI_MODEL", "grok-voice-3.0")
    assert voice.xai_url() == "wss://api.x.ai/v1/realtime?model=grok-voice-3.0"


def test_twilio_media_forwarded_only_when_ready():
    b, rec = make_bridge()
    run(b.on_twilio(START))
    assert b.stream_sid == "MZ1" and b.crew_id == "+15550001111"
    media = {"event": "media", "media": {"track": "inbound", "payload": "AAAA"}}
    run(b.on_twilio(media))
    assert rec.xai == []  # session not ready yet
    b.session_ready = True
    run(b.on_twilio(media))
    run(b.on_twilio({"event": "media", "media": {"track": "outbound", "payload": "BBBB"}}))
    assert rec.xai == [{"type": "input_audio_buffer.append", "audio": "AAAA"}]
    assert run(b.on_twilio({"event": "stop"})) == "stop"


def test_xai_audio_to_twilio_and_barge_in():
    b, rec = make_bridge()
    run(b.on_twilio(START))
    run(b.on_xai({"type": "response.created"}))
    run(b.on_xai({"type": "response.output_audio.delta", "delta": "//79"}))
    assert rec.twilio == [{"event": "media", "streamSid": "MZ1", "media": {"payload": "//79"}}]
    run(b.on_xai({"type": "input_audio_buffer.speech_started"}))
    assert rec.twilio[-1] == {"event": "clear", "streamSid": "MZ1"}


def test_stream_token_required():
    b, _ = make_bridge(require_token=True)
    assert run(b.on_twilio(START)) == "stop"
    token = voice.issue_stream_token()
    b2, rec = make_bridge(require_token=True)
    start = json.loads(json.dumps(START))
    start["start"]["customParameters"]["token"] = token
    assert run(b2.on_twilio(start)) is None and b2.authorized


def test_function_call_flow_waits_for_playback_mark():
    b, rec = make_bridge()
    run(b.on_twilio(START))
    run(b.on_xai({"type": "response.created"}))
    run(b.on_xai({"type": "response.output_audio.delta", "delta": "AAAA"}))
    run(b.on_xai({"type": "response.function_call_arguments.done", "name": "save_checkin",
                  "call_id": "call_1", "arguments": json.dumps({"sleep_hours": 3, "mood": 2})}))
    out = rec.xai[-1]
    assert out["type"] == "conversation.item.create"
    assert out["item"]["type"] == "function_call_output" and out["item"]["call_id"] == "call_1"
    result = json.loads(out["item"]["output"])
    assert result["level"] == "red"
    # duplicate notification of the same call (output_item.done) is ignored
    run(b.on_xai({"type": "response.output_item.done", "item": {
        "type": "function_call", "name": "save_checkin", "call_id": "call_1", "arguments": "{}"}}))
    assert sum(1 for m in rec.xai if m["type"] == "conversation.item.create") == 1
    assert {"type": "response.create"} not in rec.xai
    run(b.on_xai({"type": "response.done", "response": {"output": []}}))
    mark = rec.twilio[-1]
    assert mark["event"] == "mark" and mark["streamSid"] == "MZ1"
    assert {"type": "response.create"} not in rec.xai  # still playing
    run(b.on_twilio({"event": "mark", "streamSid": "MZ1", "mark": {"name": mark["mark"]["name"]}}))
    assert rec.xai[-1] == {"type": "response.create"}


def test_parallel_tool_calls_single_response_create_without_audio():
    b, rec = make_bridge()
    run(b.on_twilio(START))
    run(b.on_xai({"type": "response.created"}))
    run(b.on_xai({"type": "response.function_call_arguments.done", "name": "save_checkin",
                  "call_id": "a", "arguments": json.dumps({"sleep_hours": 8, "mood": 4})}))
    run(b.on_xai({"type": "response.function_call_arguments.done",
                  "name": "queue_flight_surgeon_message", "call_id": "b",
                  "arguments": json.dumps({"message": "hi", "priority": "routine"})}))
    run(b.on_xai({"type": "response.done"}))
    assert [m["type"] for m in rec.xai] == ["conversation.item.create", "conversation.item.create",
                                           "response.create"]


def test_function_call_only_in_response_done_output():
    b, rec = make_bridge()
    run(b.on_xai({"type": "response.created"}))
    run(b.on_xai({"type": "response.done", "response": {"output": [
        {"type": "function_call", "name": "save_checkin", "call_id": "z",
         "arguments": json.dumps({"sleep_hours": 8, "mood": 4})}]}}))
    assert [m["type"] for m in rec.xai] == ["conversation.item.create", "response.create"]


def test_barge_in_cancels_pending_mark():
    b, rec = make_bridge()
    run(b.on_twilio(START))
    b.pending_mark = "evade-tools-1"
    run(b.on_xai({"type": "input_audio_buffer.speech_started"}))
    run(b.on_twilio({"event": "mark", "mark": {"name": "evade-tools-1"}}))
    assert {"type": "response.create"} not in rec.xai


# ---------------------------------------------------- end-to-end over WebSockets
class FakeXai:
    """Stands in for the xAI realtime socket."""

    def __init__(self):
        self.sent = []
        self.inbox = asyncio.Queue()
        self.closed = False
        for ev in ({"type": "conversation.created", "conversation": {"id": "c1"}},):
            self.inbox.put_nowait(json.dumps(ev))

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        if msg["type"] == "session.update":
            await self.inbox.put(json.dumps({"type": "session.updated"}))
        elif msg["type"] == "input_audio_buffer.append":
            await self.inbox.put(json.dumps({"type": "response.output_audio.delta",
                                             "delta": msg["audio"][::-1]}))

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.closed:
            raise StopAsyncIteration
        item = await self.inbox.get()
        if item is None:
            raise StopAsyncIteration
        return item

    async def close(self):
        self.closed = True
        await self.inbox.put(None)


def test_websocket_bridge_end_to_end(monkeypatch):
    fake_holder = {}

    async def fake_connect():
        fake_holder["xai"] = FakeXai()
        return fake_holder["xai"]

    monkeypatch.setattr(voice, "connect_xai", fake_connect)
    client = TestClient(app)
    token = voice.issue_stream_token()
    with client.websocket_connect("/voice/stream") as ws:
        ws.send_text(json.dumps({"event": "connected", "protocol": "Call", "version": "1.0.0"}))
        ws.send_text(json.dumps({"event": "start", "sequenceNumber": "1", "start": {
            "streamSid": "MZ9", "callSid": "CA9", "tracks": ["inbound"],
            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
            "customParameters": {"caller": "+15550001111", "token": token}}, "streamSid": "MZ9"}))
        # wait until the session is ready (greeting sent), then send audio
        for _ in range(200):
            # The server connects to (fake) xAI on its own task, so the fake may not exist yet.
            xai = fake_holder.get("xai")
            if xai and any(m["type"] == "response.create" for m in xai.sent):
                break
            import time; time.sleep(0.01)
        ws.send_text(json.dumps({"event": "media", "streamSid": "MZ9",
                                 "media": {"track": "inbound", "payload": "abcd"}}))
        reply = json.loads(ws.receive_text())
        assert reply == {"event": "media", "streamSid": "MZ9", "media": {"payload": "dcba"}}
        ws.send_text(json.dumps({"event": "stop", "streamSid": "MZ9"}))
    sent_types = [m["type"] for m in fake_holder["xai"].sent]
    assert sent_types[0] == "session.update"
    assert "input_audio_buffer.append" in sent_types
    assert fake_holder["xai"].closed


def test_websocket_rejects_bad_token_without_opening_xai(monkeypatch):
    called = []

    async def fake_connect():
        called.append(1)
        return FakeXai()

    monkeypatch.setattr(voice, "connect_xai", fake_connect)
    client = TestClient(app)
    from starlette.websockets import WebSocketDisconnect
    import pytest
    with client.websocket_connect("/voice/stream") as ws:
        ws.send_text(json.dumps({"event": "start", "start": {
            "streamSid": "MZ8", "customParameters": {"caller": "x", "token": "forged"}}}))
        with pytest.raises(WebSocketDisconnect):
            ws.receive_text()
    assert called == []
