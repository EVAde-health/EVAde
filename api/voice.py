"""EVAde phone voice agent: Twilio Media Streams <-> xAI Grok realtime voice.

Call flow
  1. Someone dials the Twilio number. Twilio POSTs to /voice/incoming.
  2. We answer with TwiML <Connect><Stream url="wss://<host>/voice/stream">.
  3. Twilio opens a WebSocket to /voice/stream and sends the caller's audio as
     base64 G.711 mu-law, 8 kHz ("media" events).
  4. We open a WebSocket to xAI (wss://api.x.ai/v1/realtime) with the session
     set to audio/pcmu in and out, so audio passes through with no resampling.
  5. Grok's audio deltas go straight back to Twilio; its function calls
     (save_checkin, queue_flight_surgeon_message) run in api/voice_tools.py.

xAI docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
xAI's Twilio example: https://github.com/xai-org/xai-cookbook/tree/main/examples/voice-agent-phone
Twilio Media Streams: https://www.twilio.com/docs/voice/media-streams/websocket-messages
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import time
from typing import Any, Awaitable, Callable, Optional
from urllib.parse import parse_qsl, urlparse

from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from twilio.request_validator import RequestValidator
from twilio.twiml.voice_response import Connect, Say, VoiceResponse

from api import voice_tools

log = logging.getLogger("evade.voice")
router = APIRouter(prefix="/voice", tags=["voice"])

XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime"
DEFAULT_MODEL = "grok-voice-latest"
DEFAULT_VOICE = "eve"
STREAM_TOKEN_TTL_S = 120

INSTRUCTIONS = """\
# Role
You are EVAde, a calm onboard health co-pilot for astronauts, speaking on a voice call.
You run a short daily health check-in. Do not assume the crew member knows how to assess
their own health: explain things simply.

# Style
- Short spoken turns: one or two sentences, then let them talk. Ask one question at a time.
- Plain language, no jargon, no markdown, no lists read aloud. Say numbers naturally.
- Warm, steady, never alarmist.

# Check-in
1. Greet them as EVAde and say this is the daily check-in, about two minutes.
2. Ask how many hours they slept.
3. Ask for their mood from 1 (very low) to 5 (very good).
4. Ask whether they have any symptoms (for example headache, nausea, congestion, pain, rash).
5. Offer, optionally, to log blood pressure, temperature and blood sugar if they have readings.
   Skip anything they don't have.
6. Call save_checkin with what they told you. Before calling it, say something brief like
   "One moment while I check that."
7. Read the result: say the colour (green, yellow or red), WHY it was flagged in one or two
   plain sentences, then the top one to three concrete actions.
8. If the result is red, or they ask, offer to send it to the flight surgeon and call
   queue_flight_surgeon_message with a one-line summary (priority "urgent" for red).
   Tell them what happened to the message (sent, in transit, or queued for when comms return).
9. Close: remind them once that EVAde is decision support, not a medical device, and that
   the flight surgeon makes medical decisions.

# Safety
- If they describe chest pain, trouble breathing, fainting, confusion, slurred speech, or
  anything that sounds like an emergency, tell them to alert their crewmates and follow
  the emergency procedure now, and queue an urgent message to the flight surgeon.
- Never diagnose or prescribe medication. Never make up readings they did not give you.
"""

GREETING_PROMPT = ("The call just connected. Greet the crew member as EVAde and start "
                   "the daily check-in.")


# ------------------------------------------------------------------- config
def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _flag(name: str, default: bool) -> bool:
    value = _env(name)
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off")


def public_base_url() -> Optional[str]:
    url = _env("PUBLIC_BASE_URL")
    return url.rstrip("/") if url else None


def xai_url() -> str:
    return f"{XAI_REALTIME_URL}?model={_env('XAI_MODEL', DEFAULT_MODEL)}"


def session_update() -> dict:
    """session.update payload (shape from xAI's Speech to Speech docs)."""
    return {
        "type": "session.update",
        "session": {
            "instructions": INSTRUCTIONS,
            "voice": _env("XAI_VOICE", DEFAULT_VOICE),
            "turn_detection": {"type": "server_vad"},
            "audio": {
                "input": {"format": {"type": "audio/pcmu"}},
                "output": {"format": {"type": "audio/pcmu"}},
            },
            "tools": voice_tools.TOOLS,
        },
    }


# ------------------------------------------------- short-lived stream tokens
# /voice/incoming (signature-checked) issues a one-time token that Twilio passes
# back in the stream's "start" event. Stops random clients from opening
# /voice/stream and spending xAI minutes. In-memory: fine for one uvicorn worker.
_stream_tokens: dict[str, float] = {}


def issue_stream_token() -> str:
    now = time.monotonic()
    for tok, exp in list(_stream_tokens.items()):
        if exp < now:
            _stream_tokens.pop(tok, None)
    token = secrets.token_urlsafe(24)
    _stream_tokens[token] = now + STREAM_TOKEN_TTL_S
    return token


def consume_stream_token(token: Optional[str]) -> bool:
    if not token:
        return False
    exp = _stream_tokens.pop(token, None)
    return exp is not None and exp >= time.monotonic()


# --------------------------------------------------------- Twilio signature
def signature_check_enabled() -> bool:
    return bool(_env("TWILIO_AUTH_TOKEN")) and _flag("TWILIO_VALIDATE_SIGNATURE", True)


def _public_url_for(request: Request) -> str:
    """The URL Twilio actually called (behind ngrok/cloudflared, not localhost)."""
    base = public_base_url()
    if not base:
        return str(request.url)
    url = base + request.url.path
    if request.url.query:
        url += "?" + request.url.query
    return url


def is_valid_twilio_request(request: Request, params: dict[str, str]) -> bool:
    signature = request.headers.get("X-Twilio-Signature", "")
    validator = RequestValidator(_env("TWILIO_AUTH_TOKEN"))
    return bool(signature) and validator.validate(_public_url_for(request), params, signature)


# ------------------------------------------------------------------- routes
@router.post("/incoming")
async def incoming_call(request: Request) -> Response:
    """Twilio Voice webhook ("A call comes in", HTTP POST)."""
    body = (await request.body()).decode("utf-8", errors="replace")
    params = dict(parse_qsl(body, keep_blank_values=True))
    if signature_check_enabled() and not is_valid_twilio_request(request, params):
        log.warning("Rejected /voice/incoming: bad or missing X-Twilio-Signature")
        raise HTTPException(status_code=403, detail="Invalid Twilio signature")

    host = urlparse(public_base_url()).netloc if public_base_url() else request.headers.get("host")
    vr = VoiceResponse()
    connect = Connect()
    stream = connect.stream(url=f"wss://{host}/voice/stream")
    stream.parameter(name="caller", value=params.get("From", "unknown"))
    stream.parameter(name="token", value=issue_stream_token())
    vr.append(connect)
    return Response(content=str(vr), media_type="application/xml")


class AlertRequest(BaseModel):
    to: str = Field(..., description="E.164 number to call, e.g. +15551234567")
    message: str = Field("EVAde red alert. Please check the crew health dashboard now.",
                         max_length=600)


@router.post("/alert")
async def outbound_alert(alert: AlertRequest, request: Request) -> dict:
    """Place an outbound call that speaks a red alert (Twilio REST + TwiML <Say>).

    Protected: needs header X-EVADE-Token == EVADE_ALERT_TOKEN, or, if that env var
    is unset, the request must come from this machine.
    """
    expected = _env("EVADE_ALERT_TOKEN")
    if expected:
        if not secrets.compare_digest(request.headers.get("X-EVADE-Token", ""), expected):
            raise HTTPException(status_code=401, detail="Missing or wrong X-EVADE-Token")
    elif not request.client or request.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=403, detail="Set EVADE_ALERT_TOKEN to call this remotely")

    sid, token, from_ = _env("TWILIO_ACCOUNT_SID"), _env("TWILIO_AUTH_TOKEN"), _env("TWILIO_PHONE_NUMBER")
    if not (sid and token and from_):
        raise HTTPException(status_code=503, detail="TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and "
                                                    "TWILIO_PHONE_NUMBER must be set")
    vr = VoiceResponse()
    vr.append(Say(alert.message, voice="Polly.Joanna"))
    vr.pause(length=1)
    vr.append(Say(alert.message, voice="Polly.Joanna"))
    from twilio.rest import Client  # imported lazily: only needed here

    call = await asyncio.to_thread(
        lambda: Client(sid, token).calls.create(to=alert.to, from_=from_, twiml=str(vr)))
    return {"call_sid": call.sid, "status": call.status}


# ------------------------------------------------------------------- bridge
SendFn = Callable[[dict], Awaitable[None]]


class CallBridge:
    """Translates events between one Twilio Media Stream and one xAI session.

    Transport-free on purpose: feed it parsed JSON with on_twilio()/on_xai(), and
    it calls send_twilio()/send_xai() with JSON-able dicts. That keeps it testable.
    """

    def __init__(self, send_twilio: SendFn, send_xai: SendFn, *, require_token: bool = True):
        self.send_twilio = send_twilio
        self.send_xai = send_xai
        self.require_token = require_token
        self.stream_sid: Optional[str] = None
        self.call_sid: Optional[str] = None
        self.crew_id = "unknown"
        self.authorized = not require_token
        self.session_configured = False
        self.session_ready = False
        self.greeted = False
        self.response_active = False
        self.audio_in_response = False
        self.tool_outputs_pending = False
        self.pending_mark: Optional[str] = None
        self.handled_call_ids: set[str] = set()
        self._mark_seq = 0

    # ---- Twilio -> xAI
    async def on_twilio(self, msg: dict) -> Optional[str]:
        """Handle one Twilio event. Returns "stop" when the call is over."""
        event = msg.get("event")
        if event == "start":
            start = msg.get("start", {})
            self.stream_sid = start.get("streamSid") or msg.get("streamSid")
            self.call_sid = start.get("callSid")
            params = start.get("customParameters") or {}
            self.crew_id = params.get("caller") or "unknown"
            if self.require_token and not consume_stream_token(params.get("token")):
                log.warning("Stream %s rejected: missing/expired token", self.stream_sid)
                return "stop"
            self.authorized = True
            log.info("Call %s started (stream %s, caller %s)", self.call_sid, self.stream_sid, self.crew_id)
        elif event == "media":
            media = msg.get("media", {})
            if (self.authorized and self.session_ready
                    and media.get("track", "inbound") == "inbound" and media.get("payload")):
                await self.send_xai({"type": "input_audio_buffer.append", "audio": media["payload"]})
        elif event == "mark":
            name = (msg.get("mark") or {}).get("name")
            if name and name == self.pending_mark:
                # Caller has heard everything before the tool call; continue now.
                self.pending_mark = None
                await self.send_xai({"type": "response.create"})
        elif event == "stop":
            log.info("Call %s ended", self.call_sid)
            return "stop"
        return None

    # ---- xAI -> Twilio
    async def on_xai(self, ev: dict) -> None:
        etype = ev.get("type", "")
        if etype == "conversation.created" or (etype == "session.created" and not self.session_configured):
            if not self.session_configured:
                self.session_configured = True
                await self.send_xai(session_update())
        elif etype == "session.updated":
            self.session_ready = True
            if not self.greeted:
                self.greeted = True
                await self.send_xai({"type": "conversation.item.create", "item": {
                    "type": "message", "role": "user",
                    "content": [{"type": "input_text", "text": GREETING_PROMPT}]}})
                await self.send_xai({"type": "response.create"})
        elif etype == "response.created":
            self.response_active = True
            self.audio_in_response = False
        elif etype == "response.output_audio.delta":
            if ev.get("delta") and self.stream_sid:
                self.audio_in_response = True
                await self.send_twilio({"event": "media", "streamSid": self.stream_sid,
                                        "media": {"payload": ev["delta"]}})
        elif etype == "input_audio_buffer.speech_started":
            # Barge-in: drop whatever Grok audio Twilio still has buffered.
            self.pending_mark = None
            if self.stream_sid:
                await self.send_twilio({"event": "clear", "streamSid": self.stream_sid})
        elif etype == "response.function_call_arguments.done":
            await self._run_tool(ev.get("name"), ev.get("call_id"), ev.get("arguments"))
        elif etype == "response.output_item.done":
            item = ev.get("item") or {}
            if item.get("type") == "function_call":
                await self._run_tool(item.get("name"), item.get("call_id"), item.get("arguments"))
        elif etype == "response.done":
            for item in (ev.get("response") or {}).get("output") or []:
                if item.get("type") == "function_call":
                    await self._run_tool(item.get("name"), item.get("call_id"), item.get("arguments"))
            self.response_active = False
            if self.tool_outputs_pending:
                await self._continue_after_tools()
        elif etype == "conversation.item.input_audio_transcription.completed":
            log.info("[%s] caller: %s", self.call_sid, ev.get("transcript"))
        elif etype == "error":
            log.error("xAI error: %s", ev.get("error") or ev)

    async def _run_tool(self, name: Optional[str], call_id: Optional[str], arguments: Any) -> None:
        if not name or not call_id or call_id in self.handled_call_ids:
            return
        self.handled_call_ids.add(call_id)
        result = await asyncio.to_thread(voice_tools.run_tool, name, self.crew_id, arguments)
        log.info("[%s] tool %s -> %s", self.call_sid, name, result)
        await self.send_xai({"type": "conversation.item.create", "item": {
            "type": "function_call_output", "call_id": call_id, "output": json.dumps(result)}})
        self.tool_outputs_pending = True
        if not self.response_active:  # call arrived after response.done
            await self._continue_after_tools()

    async def _continue_after_tools(self) -> None:
        """Send response.create once every tool output is in, without talking over
        audio Twilio is still playing: a Twilio mark tells us when playback ends."""
        self.tool_outputs_pending = False
        if self.audio_in_response and self.stream_sid:
            self._mark_seq += 1
            self.pending_mark = f"evade-tools-{self._mark_seq}"
            await self.send_twilio({"event": "mark", "streamSid": self.stream_sid,
                                    "mark": {"name": self.pending_mark}})
        else:
            await self.send_xai({"type": "response.create"})


async def connect_xai():
    """Open the xAI realtime WebSocket (Authorization: Bearer <XAI_API_KEY>)."""
    import websockets

    key = _env("XAI_API_KEY")
    if not key:
        raise RuntimeError("XAI_API_KEY is not set")
    return await websockets.connect(xai_url(), additional_headers={"Authorization": f"Bearer {key}"},
                                    max_size=None)


@router.websocket("/stream")
async def media_stream(ws: WebSocket) -> None:
    """Twilio Media Stream endpoint (bidirectional, via <Connect><Stream>)."""
    await ws.accept()
    xai_box: dict[str, Any] = {}

    async def send_twilio(msg: dict) -> None:
        await ws.send_text(json.dumps(msg))

    async def send_xai(msg: dict) -> None:
        await xai_box["ws"].send(json.dumps(msg))

    bridge = CallBridge(send_twilio, send_xai)

    # 1. Wait for Twilio's "start" event and check the one-time token *before*
    #    opening (and paying for) an xAI session.
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            if await bridge.on_twilio(msg) == "stop":
                await ws.close(code=1008)
                return
            if msg.get("event") == "start":
                break
    except WebSocketDisconnect:
        return

    # 2. Connect to xAI. It replies with conversation.created -> we send session.update.
    try:
        xai = xai_box["ws"] = await connect_xai()
    except Exception as exc:
        log.error("Could not connect to xAI: %s", exc)
        await ws.close(code=1011)
        return

    async def twilio_to_xai() -> None:
        try:
            while True:
                if await bridge.on_twilio(json.loads(await ws.receive_text())) == "stop":
                    return
        except WebSocketDisconnect:
            return

    async def xai_to_twilio() -> None:
        async for raw in xai:
            if isinstance(raw, (bytes, bytearray)):
                continue  # binary transport not enabled; ignore
            await bridge.on_xai(json.loads(raw))

    tasks = [asyncio.create_task(twilio_to_xai()), asyncio.create_task(xai_to_twilio())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in done:
            if not t.cancelled() and t.exception():
                log.error("Bridge task failed: %r", t.exception())
    finally:
        await xai.close()
        try:
            await ws.close()
        except RuntimeError:
            pass
