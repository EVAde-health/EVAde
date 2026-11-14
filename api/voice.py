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

from api import voice_agent
from api.voice_agent import (  # noqa: F401  (re-exported for callers/tests)
    GREETING_PROMPT, INSTRUCTIONS, PHONE_AUDIO, AgentSession, SendFn, connect_xai,
    session_update, xai_url,
)

log = logging.getLogger("evade.voice")
router = APIRouter(prefix="/voice", tags=["voice"])

STREAM_TOKEN_TTL_S = 120
_env = voice_agent.env
_flag = voice_agent.flag


def public_base_url() -> Optional[str]:
    url = _env("PUBLIC_BASE_URL")
    return url.rstrip("/") if url else None


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


# ------------------------------------------------------------- phone bridge
class CallBridge(AgentSession):
    """Twilio Media Stream <-> xAI. All xAI logic lives in AgentSession.

    Transport-free: feed parsed JSON to on_twilio()/on_xai(); it calls
    send_twilio()/send_xai() with JSON-able dicts. That keeps it testable.
    """

    audio_format = PHONE_AUDIO

    def __init__(self, send_twilio: SendFn, send_xai: SendFn, *, require_token: bool = True):
        super().__init__(send_xai)
        self.send_twilio = send_twilio
        self.require_token = require_token
        self.stream_sid: Optional[str] = None
        self.call_sid: Optional[str] = None
        self.authorized = not require_token

    # transport hooks
    async def play_audio(self, b64: str) -> None:
        if self.stream_sid:
            await self.send_twilio({"event": "media", "streamSid": self.stream_sid,
                                    "media": {"payload": b64}})

    async def clear_audio(self) -> None:
        if self.stream_sid:
            await self.send_twilio({"event": "clear", "streamSid": self.stream_sid})

    def can_mark(self) -> bool:
        return bool(self.stream_sid)

    async def send_mark(self, name: str) -> None:
        await self.send_twilio({"event": "mark", "streamSid": self.stream_sid, "mark": {"name": name}})

    # Twilio -> xAI
    async def on_twilio(self, msg: dict) -> Optional[str]:
        """Handle one Twilio event. Returns "stop" when the call is over."""
        event = msg.get("event")
        if event == "start":
            start = msg.get("start", {})
            self.stream_sid = start.get("streamSid") or msg.get("streamSid")
            self.call_sid = start.get("callSid")
            params = start.get("customParameters") or {}
            self.crew_id = params.get("caller") or "unknown"
            self.label = self.call_sid or self.crew_id
            if self.require_token and not consume_stream_token(params.get("token")):
                log.warning("Stream %s rejected: missing/expired token", self.stream_sid)
                return "stop"
            self.authorized = True
            log.info("Call %s started (stream %s, caller %s)", self.call_sid, self.stream_sid, self.crew_id)
        elif event == "media":
            media = msg.get("media", {})
            if self.authorized and media.get("track", "inbound") == "inbound":
                await self.user_audio(media.get("payload", ""))
        elif event == "mark":
            await self.playback_reached((msg.get("mark") or {}).get("name"))
        elif event == "stop":
            log.info("Call %s ended", self.call_sid)
            return "stop"
        return None


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

    async def twilio_loop() -> None:
        try:
            while True:
                if await bridge.on_twilio(json.loads(await ws.receive_text())) == "stop":
                    return
        except WebSocketDisconnect:
            return

    try:
        await voice_agent.pump(twilio_loop, xai, bridge)
    finally:
        try:
            await ws.close()
        except RuntimeError:
            pass
