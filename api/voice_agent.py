"""Shared EVAde voice-agent core: one implementation for phone and browser.

Holds the persona/instructions, the xAI session config, the xAI connection and
`AgentSession`, which owns all xAI-side logic (session setup, greeting, tool
calls, continuing after tools without talking over playback, barge-in).
Transports subclass it and only implement how audio, "clear" and playback
marks reach the listener:

  api/voice.py          Twilio Media Streams (G.711 mu-law 8 kHz)
  api/voice_browser.py  Browser mic over WebSocket (PCM16 24 kHz)

xAI docs: https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech
Event reference: https://docs.x.ai/developers/rest-api-reference/inference/voice
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Awaitable, Callable, Optional

from api import voice_tools

log = logging.getLogger("evade.voice")

XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime"
DEFAULT_MODEL = "grok-voice-latest"
DEFAULT_VOICE = "eve"

# Audio formats (xAI "Configuring Audio Format" table)
PHONE_AUDIO = {"type": "audio/pcmu"}                 # G.711 mu-law, fixed 8000 Hz
BROWSER_AUDIO = {"type": "audio/pcm", "rate": 24000}  # PCM16 little-endian, 24 kHz

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
   Tell them what happened to the message using the tool's summary (sent, in transit, or
   queued for when comms return). Don't claim the flight surgeon has replied or is on the line.
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


def env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def flag(name: str, default: bool) -> bool:
    value = env(name)
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off")


def xai_url() -> str:
    return f"{XAI_REALTIME_URL}?model={env('XAI_MODEL', DEFAULT_MODEL)}"


def session_update(audio_format: Optional[dict] = None, *, transcribe: bool = False) -> dict:
    """session.update payload (shape from xAI's Speech to Speech docs).

    Same instructions, voice, VAD and tools for every transport; only the audio
    codec differs. `transcribe=True` asks for user-speech transcripts
    (audio.input.transcription.model = "grok-transcribe").
    """
    fmt = dict(audio_format or PHONE_AUDIO)
    audio: dict[str, Any] = {"input": {"format": fmt}, "output": {"format": dict(fmt)}}
    if transcribe:
        audio["input"]["transcription"] = {"model": "grok-transcribe"}
    return {
        "type": "session.update",
        "session": {
            "instructions": INSTRUCTIONS,
            "voice": env("XAI_VOICE", DEFAULT_VOICE),
            "turn_detection": {"type": "server_vad"},
            "audio": audio,
            "tools": voice_tools.TOOLS,
        },
    }


async def connect_xai():
    """Open the xAI realtime WebSocket (Authorization: Bearer <XAI_API_KEY>)."""
    import websockets

    key = env("XAI_API_KEY")
    if not key:
        raise RuntimeError("XAI_API_KEY is not set")
    return await websockets.connect(xai_url(), additional_headers={"Authorization": f"Bearer {key}"},
                                    max_size=None)


SendFn = Callable[[dict], Awaitable[None]]


class AgentSession:
    """xAI-side logic shared by every transport.

    Subclasses implement `play_audio`, `clear_audio`, `send_mark` and optionally
    `notify` (UI events such as transcripts and tool results) and `can_mark`.
    The transport calls `user_audio(b64)` for listener audio, `playback_reached(name)`
    when a mark finished playing, and `on_xai(event)` for every xAI event.
    """

    audio_format: dict = PHONE_AUDIO
    transcribe: bool = False

    def __init__(self, send_xai: SendFn, crew_id: str = "unknown"):
        self.send_xai = send_xai
        self.crew_id = crew_id
        self.session_configured = False
        self.session_ready = False
        self.greeted = False
        self.response_active = False
        self.audio_in_response = False
        self.tool_outputs_pending = False
        self.pending_mark: Optional[str] = None
        self.handled_call_ids: set[str] = set()
        self._mark_seq = 0
        self.label = crew_id

    # ---- transport hooks
    async def play_audio(self, b64: str) -> None:
        raise NotImplementedError

    async def clear_audio(self) -> None:
        raise NotImplementedError

    async def send_mark(self, name: str) -> None:
        raise NotImplementedError

    def can_mark(self) -> bool:
        return True

    async def notify(self, event: dict) -> None:
        """UI side-channel (transcripts, tool results). Phone ignores it."""

    # ---- listener -> xAI
    async def user_audio(self, b64: str) -> None:
        if self.session_ready and b64:
            await self.send_xai({"type": "input_audio_buffer.append", "audio": b64})

    async def playback_reached(self, name: Optional[str]) -> None:
        if name and name == self.pending_mark:
            # Listener has heard everything before the tool call; continue now.
            self.pending_mark = None
            await self.send_xai({"type": "response.create"})

    # ---- xAI -> listener
    async def on_xai(self, ev: dict) -> None:
        etype = ev.get("type", "")
        if etype in ("conversation.created", "session.created"):
            if not self.session_configured:
                self.session_configured = True
                await self.send_xai(session_update(self.audio_format, transcribe=self.transcribe))
        elif etype == "session.updated":
            self.session_ready = True
            await self.notify({"type": "status", "state": "ready"})
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
            if ev.get("delta"):
                self.audio_in_response = True
                await self.play_audio(ev["delta"])
        elif etype == "input_audio_buffer.speech_started":
            # Barge-in: drop whatever agent audio is still buffered at the listener.
            self.pending_mark = None
            await self.clear_audio()
            await self.notify({"type": "speech_started"})
        elif etype == "input_audio_buffer.speech_stopped":
            await self.notify({"type": "speech_stopped"})
        elif etype == "response.output_audio_transcript.delta":
            await self.notify({"type": "transcript", "role": "agent", "id": ev.get("response_id")
                               or ev.get("item_id"), "delta": ev.get("delta", "")})
        elif etype == "response.output_audio_transcript.done":
            await self.notify({"type": "transcript_done", "role": "agent",
                               "id": ev.get("response_id") or ev.get("item_id")})
        elif etype in ("conversation.item.input_audio_transcription.updated",
                       "conversation.item.input_audio_transcription.completed"):
            text = ev.get("transcript", "")
            if etype.endswith("completed"):
                log.info("[%s] user: %s", self.label, text)
            await self.notify({"type": "transcript", "role": "user", "id": ev.get("item_id"),
                               "text": text, "final": etype.endswith("completed")})
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
        elif etype == "error":
            err = ev.get("error") or ev
            log.error("[%s] xAI error: %s", self.label, err)
            msg = err.get("message") if isinstance(err, dict) else str(err)
            await self.notify({"type": "error", "message": msg or "xAI error"})

    async def _run_tool(self, name: Optional[str], call_id: Optional[str], arguments: Any) -> None:
        if not name or not call_id or call_id in self.handled_call_ids:
            return
        self.handled_call_ids.add(call_id)
        result = await asyncio.to_thread(voice_tools.run_tool, name, self.crew_id, arguments)
        log.info("[%s] tool %s -> %s", self.label, name, result)
        await self.send_xai({"type": "conversation.item.create", "item": {
            "type": "function_call_output", "call_id": call_id, "output": json.dumps(result)}})
        await self.notify({"type": "tool_result", "name": name, "result": result})
        self.tool_outputs_pending = True
        if not self.response_active:  # call arrived after response.done
            await self._continue_after_tools()

    async def _continue_after_tools(self) -> None:
        """Send response.create once every tool output is in, without talking over
        audio the listener is still hearing: a playback mark tells us when it ends."""
        self.tool_outputs_pending = False
        if self.audio_in_response and self.can_mark():
            self._mark_seq += 1
            self.pending_mark = f"evade-tools-{self._mark_seq}"
            await self.send_mark(self.pending_mark)
        else:
            await self.send_xai({"type": "response.create"})


async def pump(client_loop: Callable[[], Awaitable[None]], xai, session: AgentSession) -> None:
    """Run listener->xAI and xAI->listener loops until either side ends."""

    async def xai_loop() -> None:
        async for raw in xai:
            if isinstance(raw, (bytes, bytearray)):
                continue  # binary transport not enabled
            await session.on_xai(json.loads(raw))

    tasks = [asyncio.create_task(client_loop()), asyncio.create_task(xai_loop())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in done:
            if not t.cancelled() and t.exception():
                log.error("[%s] bridge task failed: %r", session.label, t.exception())
    finally:
        await xai.close()
