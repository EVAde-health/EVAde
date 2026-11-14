"""EVAde browser voice mode: talk to the same Grok voice agent from a laptop mic.

  GET  /voice/                      page (frontend/voice/index.html)
  GET  /voice/app.js, /voice/mic-worklet.js
  WS   /voice/browser               browser <-> xAI bridge (server-side, so
                                    XAI_API_KEY never reaches the browser)
  GET  /voice/api/checkins/latest   latest check-in result
  GET  /voice/api/downlink          recent flight-surgeon downlink messages

Audio: the browser sends PCM16 little-endian mono at 24 kHz (base64) and plays
back the agent's PCM16 24 kHz audio. xAI session = same instructions, voice,
server VAD and tools as the phone path (api/voice_agent.py), with
audio/pcm @ 24000 instead of audio/pcmu.

Browser <-> server messages (JSON text frames)
  browser -> server: {"type":"audio","audio":b64} | {"type":"mark","name":..} | {"type":"stop"}
  server -> browser: {"type":"status","state":..} | {"type":"audio","audio":b64} | {"type":"clear"}
                     {"type":"mark","name":..} | {"type":"speech_started"} | {"type":"speech_stopped"}
                     {"type":"transcript","role":"agent","id":..,"delta":..}
                     {"type":"transcript","role":"user","id":..,"text":..,"final":bool}
                     {"type":"transcript_done",..} | {"type":"tool_result","name":..,"result":{..}}
                     {"type":"error","message":..}

Access: by default only from this machine (localhost, not via a tunnel). Set
EVADE_BROWSER_TOKEN to allow other machines with ?token=<value>.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
from pathlib import Path
from typing import Any, Mapping, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from api import voice_agent, voice_tools
from api.voice_agent import BROWSER_AUDIO, AgentSession, SendFn, connect_xai  # noqa: F401

log = logging.getLogger("evade.voice.browser")
router = APIRouter(prefix="/voice", tags=["voice-browser"])

FRONTEND = Path(__file__).resolve().parent.parent / "frontend" / "voice"
LOCAL_HOSTS = {"127.0.0.1", "::1", "localhost", "testclient"}
TUNNEL_HEADERS = ("x-forwarded-for", "cf-connecting-ip", "x-real-ip", "forwarded")


def browser_allowed(headers: Mapping[str, str], client_host: Optional[str], token: Optional[str]) -> bool:
    """Local-only unless EVADE_BROWSER_TOKEN is set and matches.

    A tunnel (ngrok/cloudflared) connects from localhost too, so requests that
    carry forwarding headers are treated as remote. Cross-site pages are blocked
    by requiring the Origin (when present) to match the Host.
    """
    expected = voice_agent.env("EVADE_BROWSER_TOKEN")
    if expected and token and secrets.compare_digest(token, expected):
        return True
    if client_host not in LOCAL_HOSTS or any(h in headers for h in TUNNEL_HEADERS):
        return False
    origin = headers.get("origin")
    if origin and urlparse(origin).netloc != headers.get("host"):
        return False
    return True


def _guard(request: Request, token: Optional[str]) -> None:
    host = request.client.host if request.client else None
    if not browser_allowed(request.headers, host, token):
        raise HTTPException(status_code=403, detail="Local access only (or set EVADE_BROWSER_TOKEN)")


# -------------------------------------------------------------------- page
@router.get("/", include_in_schema=False)
def voice_page() -> FileResponse:
    return FileResponse(FRONTEND / "index.html", media_type="text/html")


@router.get("/app.js", include_in_schema=False)
def voice_app_js() -> FileResponse:
    return FileResponse(FRONTEND / "app.js", media_type="text/javascript")


@router.get("/mic-worklet.js", include_in_schema=False)
def voice_worklet_js() -> FileResponse:
    return FileResponse(FRONTEND / "mic-worklet.js", media_type="text/javascript")


# -------------------------------------------------------------------- data
@router.get("/api/checkins/latest")
def api_latest_checkin(request: Request, crew_id: Optional[str] = None,
                       token: Optional[str] = None) -> dict:
    _guard(request, token)
    return {"checkin": voice_tools.latest_checkin(crew_id)}


@router.get("/api/downlink")
def api_downlink(request: Request, limit: int = Query(10, ge=1, le=100),
                 crew_id: Optional[str] = None, token: Optional[str] = None) -> dict:
    _guard(request, token)
    return {"messages": voice_tools.list_downlink(limit, crew_id)}


# ------------------------------------------------------------------ bridge
class BrowserBridge(AgentSession):
    """Browser mic <-> xAI. All xAI logic lives in AgentSession."""

    audio_format = BROWSER_AUDIO
    transcribe = True

    def __init__(self, send_browser: SendFn, send_xai: SendFn, crew_id: str = "browser-demo"):
        super().__init__(send_xai, crew_id)
        self.send_browser = send_browser
        self.label = f"browser:{crew_id}"

    async def play_audio(self, b64: str) -> None:
        await self.send_browser({"type": "audio", "audio": b64})

    async def clear_audio(self) -> None:
        await self.send_browser({"type": "clear"})

    async def send_mark(self, name: str) -> None:
        await self.send_browser({"type": "mark", "name": name})

    async def notify(self, event: dict) -> None:
        await self.send_browser(event)

    async def on_browser(self, msg: dict) -> Optional[str]:
        mtype = msg.get("type")
        if mtype == "audio":
            await self.user_audio(msg.get("audio", ""))
        elif mtype == "mark":
            await self.playback_reached(msg.get("name"))
        elif mtype == "stop":
            return "stop"
        return None


@router.websocket("/browser")
async def browser_stream(ws: WebSocket) -> None:
    token = ws.query_params.get("token")
    host = ws.client.host if ws.client else None
    if not browser_allowed(ws.headers, host, token):
        await ws.close(code=1008)
        return
    await ws.accept()
    crew_id = (ws.query_params.get("crew") or "browser-demo")[:64]
    xai_box: dict[str, Any] = {}

    async def send_browser(msg: dict) -> None:
        await ws.send_text(json.dumps(msg))

    async def send_xai(msg: dict) -> None:
        await xai_box["ws"].send(json.dumps(msg))

    bridge = BrowserBridge(send_browser, send_xai, crew_id)
    await send_browser({"type": "status", "state": "connecting"})
    try:
        xai = xai_box["ws"] = await connect_xai()
    except Exception as exc:
        log.error("Could not connect to xAI: %s", exc)
        await send_browser({"type": "error", "message": "Could not connect to xAI. Is XAI_API_KEY set?"})
        await ws.close(code=1011)
        return

    async def browser_loop() -> None:
        try:
            while True:
                if await bridge.on_browser(json.loads(await ws.receive_text())) == "stop":
                    return
        except WebSocketDisconnect:
            return

    try:
        await voice_agent.pump(browser_loop, xai, bridge)
    finally:
        try:
            await send_browser({"type": "status", "state": "ended"})
            await ws.close()
        except Exception:
            pass
