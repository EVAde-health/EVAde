import asyncio
import base64
import json
import time

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from api import voice_browser, voice_tools
from api.main import app


class FakeXai:
    """Stands in for the xAI realtime socket. Scripted like the live service:
    session.created -> (session.update) -> session.updated; echoes audio back."""

    def __init__(self):
        self.sent = []
        self.inbox = asyncio.Queue()
        self.closed = False
        self.inbox.put_nowait(json.dumps({"type": "session.created"}))
        self.inbox.put_nowait(json.dumps({"type": "conversation.created", "conversation": {"id": "c"}}))

    async def emit(self, ev):
        await self.inbox.put(json.dumps(ev))

    async def send(self, raw):
        msg = json.loads(raw)
        self.sent.append(msg)
        t = msg["type"]
        if t == "session.update":
            await self.emit({"type": "session.updated", "session": msg["session"]})
        elif t == "input_audio_buffer.append":
            # pretend the user spoke: VAD start, transcript, then a tool-calling response
            await self.emit({"type": "input_audio_buffer.speech_started"})
            await self.emit({"type": "conversation.item.input_audio_transcription.completed",
                             "item_id": "u1", "transcript": "I slept three hours, mood two"})
            await self.emit({"type": "response.created", "response": {"id": "r1"}})
            await self.emit({"type": "response.output_audio.delta", "response_id": "r1",
                             "delta": msg["audio"]})
            await self.emit({"type": "response.output_audio_transcript.delta", "response_id": "r1",
                             "delta": "One moment."})
            await self.emit({"type": "response.function_call_arguments.done", "response_id": "r1",
                             "name": "save_checkin", "call_id": "call-1",
                             "arguments": json.dumps({"sleep_hours": 3, "mood": 2, "symptoms": []})})
            await self.emit({"type": "response.done", "response": {"id": "r1", "output": []}})

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


@pytest.fixture
def fake_xai(monkeypatch):
    holder = {}

    async def fake_connect():
        holder["xai"] = FakeXai()
        return holder["xai"]

    monkeypatch.setattr(voice_browser, "connect_xai", fake_connect)
    return holder


def recv_until(ws, mtype, limit=50):
    seen = []
    for _ in range(limit):
        msg = json.loads(ws.receive_text())
        seen.append(msg)
        if msg["type"] == mtype:
            return msg, seen
    raise AssertionError(f"never got {mtype}: {[m['type'] for m in seen]}")


def test_browser_bridge_end_to_end(fake_xai):
    client = TestClient(app)
    pcm = base64.b64encode(b"\x01\x00\xff\x7f" * 240).decode()
    with client.websocket_connect("/voice/browser?crew=astro-1") as ws:
        first, _ = recv_until(ws, "status")
        assert first["state"] == "connecting"
        ready, _ = recv_until(ws, "status")
        assert ready["state"] == "ready"
        xai = fake_xai["xai"]
        upd = xai.sent[0]
        assert upd["type"] == "session.update"
        assert upd["session"]["audio"]["input"]["format"] == {"type": "audio/pcm", "rate": 24000}
        assert upd["session"]["audio"]["output"]["format"] == {"type": "audio/pcm", "rate": 24000}
        assert upd["session"]["audio"]["input"]["transcription"] == {"model": "grok-transcribe"}
        assert {t["name"] for t in upd["session"]["tools"]} == {"save_checkin",
                                                                "queue_flight_surgeon_message"}
        assert [m["type"] for m in xai.sent[1:3]] == ["conversation.item.create", "response.create"]

        ws.send_text(json.dumps({"type": "audio", "audio": pcm}))
        # barge-in passthrough: speech_started -> clear + speech_started
        _, seen = recv_until(ws, "speech_started")
        assert {"type": "clear"} in seen
        user, _ = recv_until(ws, "transcript")
        assert user == {"type": "transcript", "role": "user", "id": "u1",
                        "text": "I slept three hours, mood two", "final": True}
        audio, _ = recv_until(ws, "audio")
        assert audio["audio"] == pcm  # agent audio forwarded untouched
        agent, _ = recv_until(ws, "transcript")
        assert agent["role"] == "agent" and agent["delta"] == "One moment."
        tool, _ = recv_until(ws, "tool_result")
        assert tool["name"] == "save_checkin" and tool["result"]["level"] == "red"
        mark, _ = recv_until(ws, "mark")  # wait for playback before continuing
        assert not any(m["type"] == "response.create" for m in xai.sent[3:])
        ws.send_text(json.dumps({"type": "mark", "name": mark["name"]}))
        for _ in range(100):
            if any(m["type"] == "response.create" for m in xai.sent[3:]):
                break
            time.sleep(0.01)
        ws.send_text(json.dumps({"type": "stop"}))

    appended = [m for m in xai.sent if m["type"] == "input_audio_buffer.append"]
    assert appended == [{"type": "input_audio_buffer.append", "audio": pcm}]
    outputs = [m for m in xai.sent if m["type"] == "conversation.item.create"
               and m["item"]["type"] == "function_call_output"]
    assert len(outputs) == 1 and outputs[0]["item"]["call_id"] == "call-1"
    assert json.loads(outputs[0]["item"]["output"])["level"] == "red"
    assert any(m["type"] == "response.create" for m in xai.sent[3:])
    assert xai.closed
    saved = voice_tools.latest_checkin("astro-1")
    assert saved["level"] == "red" and saved["crew_id"] == "astro-1"


def test_browser_ws_reports_missing_xai_key(monkeypatch):
    client = TestClient(app)  # real connect_xai, no XAI_API_KEY in env
    with client.websocket_connect("/voice/browser") as ws:
        assert json.loads(ws.receive_text())["state"] == "connecting"
        err = json.loads(ws.receive_text())
        assert err["type"] == "error" and "XAI_API_KEY" in err["message"]


def test_browser_ws_rejects_tunnel_and_cross_origin(fake_xai):
    client = TestClient(app)
    for headers in ({"X-Forwarded-For": "8.8.8.8"}, {"Origin": "https://evil.example"}):
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/voice/browser", headers=headers) as ws:
                ws.receive_text()
    assert "xai" not in fake_xai


def test_browser_token_allows_remote(monkeypatch, fake_xai):
    monkeypatch.setenv("EVADE_BROWSER_TOKEN", "s3cret")
    client = TestClient(app)
    with client.websocket_connect("/voice/browser?token=s3cret",
                                  headers={"X-Forwarded-For": "8.8.8.8"}) as ws:
        assert json.loads(ws.receive_text())["state"] == "connecting"
        ws.send_text(json.dumps({"type": "stop"}))


def test_old_voice_page_removed():
    client = TestClient(app)
    for path in ("/voice/", "/voice/app.js", "/voice/mic-worklet.js"):
        assert client.get(path).status_code == 404


def test_latest_checkin_and_downlink_endpoints():
    client = TestClient(app)
    assert client.get("/voice/api/checkins/latest").json() == {"checkin": None}
    assert client.get("/voice/api/downlink").json() == {"messages": []}
    voice_tools.save_checkin("a", {"sleep_hours": 8, "mood": 4})
    voice_tools.save_checkin("b", {"sleep_hours": 3, "mood": 4})
    for i in range(3):
        voice_tools.queue_flight_surgeon_message("b", {"message": f"m{i}", "priority": "urgent"})
    latest = client.get("/voice/api/checkins/latest").json()["checkin"]
    assert latest["crew_id"] == "b" and latest["level"] == "red"
    assert isinstance(latest["reasons"], list) and latest["actions"]
    only_a = client.get("/voice/api/checkins/latest?crew_id=a").json()["checkin"]
    assert only_a["level"] == "green"
    msgs = client.get("/voice/api/downlink?limit=2").json()["messages"]
    assert [m["message"] for m in msgs] == ["m2", "m1"]
    assert msgs[0]["comms_mode"] == "online" and msgs[0]["priority"] == "urgent"


def test_data_endpoints_blocked_through_tunnel():
    client = TestClient(app)
    r = client.get("/voice/api/downlink", headers={"X-Forwarded-For": "1.2.3.4"})
    assert r.status_code == 403
