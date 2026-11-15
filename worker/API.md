# EVAde API (for the React Native app and other clients)

Base URL: `https://evade.health`. JSON everywhere. CORS is enabled for `/api/*`, `/voice/api/*`,
`/voice/alert` and `/health` (`Access-Control-Allow-Origin` from `CORS_ALLOW_ORIGINS`, default `*`),
and `OPTIONS` preflights return `204`.

## Auth

| Endpoint group | Credential |
| --- | --- |
| App API + voice socket | When `DEMO_OPEN` is `"true"` (current hackathon demo), no token is required for `/voice/browser`, `/api/voice/ws`, `/api/voice/start`, `GET /api/checkins/latest`, `GET /api/downlink`, and the `/voice/api/…` aliases. When `DEMO_OPEN` is `"false"`, send `Authorization: Bearer <EVADE_BROWSER_TOKEN>` (preferred) or `?token=<EVADE_BROWSER_TOKEN>`. |
| Voice socket only | `?ticket=<ticket>` from `POST /api/voice/start` (single use, 60 s). Use this on React Native so the long-lived token never goes in a URL. |
| Red-alert call | Always required, even when the demo is open: `X-EVADE-Token: <EVADE_ALERT_TOKEN>` or `Authorization: Bearer <EVADE_ALERT_TOKEN>` |

To require a token again after the demo, set `DEMO_OPEN` to `"false"` in `wrangler.jsonc` and
redeploy.

Errors use FastAPI's shape: `{"detail": "..."}` (`403` bad/missing token, `401` bad alert token,
`422` validation, `429` too many concurrent browser sessions, `503` Twilio not configured).

> When `DEMO_OPEN` is `"false"`, the bearer token is a shared demo secret. Don't ship a production
> app with it baked in; put real user login in front of `/api/voice/start` when the team adds auth.

## Spending guards (browser / app sessions)

These apply to the web page and React Native voice socket, not to the concurrency cap for
Twilio phone calls (phone calls still end after 600 s).

| Guard | Default | What happens |
| --- | --- | --- |
| Max session length (`MAX_SESSION_SECONDS`) | 300 s (phone: 600 s) | Server sends `{"type":"notice","message":"session limit reached"}` and `{"type":"status","state":"ended","reason":"session limit reached"}`, then closes with code `1000` and that reason. |
| No client audio | 60 s | Same close pattern, with message / reason `time-up`. |
| Concurrent sessions (`MAX_CONCURRENT_SESSIONS`) | 5 | `POST /api/voice/start` returns `429 {"detail":"too many people talking"}`. A WebSocket upgrade is accepted only long enough to send a notice / error with that message, then closes with code `1000`. Phone calls are not counted. |

## REST endpoints

| Method + path | Description | Response |
| --- | --- | --- |
| `GET /api/checkins/latest?crew_id=` | Most recent check-in (optionally one crew member) | `{"checkin": {...} \| null}` |
| `GET /api/downlink?limit=10&crew_id=` | Newest flight-surgeon downlink messages (`limit` 1-100) | `{"messages": [...]}` |
| `POST /api/voice/start` | One-time ticket for the voice socket. Body `{"crew": "astro-1"}` or `?crew=` | see below |
| `POST /api/alert` | Outbound red-alert phone call. Body `{"to": "+15551234567", "message": "..."}` (message optional, max 600 chars) | `{"call_sid": "CA…", "status": "queued"}` |
| `GET /health` | Liveness | `{"status": "ok"}` |
| `GET /api` | Endpoint list | |

`/voice/api/checkins/latest` and `/voice/api/downlink` are aliases (used by the `/voice/` web page),
and `/voice/alert` is an alias of `/api/alert`.

`checkin` object: `id, created_at, crew_id, source, sleep_hours, mood, symptoms[], systolic,
diastolic, temperature_c, blood_sugar_mg_dl, notes, level ("green"|"yellow"|"red"), reasons[], actions[]`.

Downlink message: `id, created_at, crew_id, priority ("routine"|"urgent"), message, checkin_id,
comms_mode ("online"|"mars"|"blackout"), status ("sent"|"in_transit"|"queued"), arrives_at`.

`POST /api/voice/start` response:

```json
{
  "ws_url": "wss://evade.health/api/voice/ws?ticket=ws.XXXX&crew=astro-1",
  "ticket": "ws.XXXX",
  "crew_id": "astro-1",
  "expires_in": 60,
  "protocol": "evade-voice-1",
  "audio": {
    "input":  { "format": "pcm16le", "sample_rate": 24000, "channels": 1, "encoding": "base64" },
    "output": { "format": "pcm16le", "sample_rate": 24000, "channels": 1, "encoding": "base64" }
  }
}
```

## Voice WebSocket: `wss://evade.health/api/voice/ws` (alias `/voice/browser`)

Query: optional `ticket=` **or** `token=` (not required while `DEMO_OPEN` is `"true"`), plus
optional `crew=` (crew ID, max 64 chars, default `browser-demo`). Every frame is a JSON **text**
frame. Audio is **PCM16 little-endian, mono, 24 000 Hz, base64**. Send chunks of about 20-100 ms
(20 ms = 480 samples = 960 bytes).

### Client → server

| Message | Meaning |
| --- | --- |
| `{"type":"audio","audio":"<base64 pcm16>"}` | Mic audio. Ignored until `status: ready`. |
| `{"type":"mark","name":"evade-tools-1"}` | Echo a server `mark` back **after all audio received before it has finished playing**. |
| `{"type":"ping"}` | Keep-alive; server replies `{"type":"pong"}`. |
| `{"type":"stop"}` | End the session (server sends `status: ended` and closes). |

### Server → client

| Message | Meaning / what to do |
| --- | --- |
| `{"type":"status","state":"connecting"\|"ready"\|"ended", "reason"?}` | Session lifecycle. Start streaming mic audio at `ready`. `reason` is set when the server ends the session (`session limit reached`, `time-up`, or `too many people talking`). |
| `{"type":"notice","message":"…"}` | Server-side notice immediately before a guarded close (same phrases as `reason`). |
| `{"type":"audio","audio":"<base64 pcm16>"}` | Agent speech. Queue it for gapless playback. |
| `{"type":"clear"}` | Barge-in: the user started talking. **Stop playback and drop queued audio now.** |
| `{"type":"mark","name":"..."}` | Playback marker. When everything queued before it has played, send the same `mark` back (the agent waits for this before continuing after a tool call, so it doesn't talk over itself). |
| `{"type":"speech_started"}` / `{"type":"speech_stopped"}` | Server VAD heard the user start / stop. |
| `{"type":"transcript","role":"agent","id":"…","delta":"…"}` | Streaming agent caption; append `delta` to the bubble with this `id`. |
| `{"type":"transcript_done","role":"agent","id":"…"}` | Agent caption finished. |
| `{"type":"transcript","role":"user","id":"…","text":"…","final":true\|false}` | User caption (replace the bubble's text). |
| `{"type":"tool_result","name":"save_checkin"\|"queue_flight_surgeon_message","result":{…}}` | Tool output. For `save_checkin`, `result` has `checkin_id, level, reasons[], actions[], reminder`; refresh the check-in card. |
| `{"type":"error","message":"…"}` | xAI or server error (e.g. "Could not connect to xAI. Is XAI_API_KEY set?"). |
| `{"type":"pong"}` | Reply to `ping`. |

Close codes: `1000` normal (reason may be `session limit reached`, `time-up`, or
`too many people talking`), `1007` invalid JSON frame, `1011` server/xAI failure. When
`DEMO_OPEN` is `"false"`, a bad or missing token/ticket is rejected with HTTP `403` before
the upgrade.

## React Native example (TypeScript)

React Native's `fetch` and `WebSocket` work as-is. Mic capture and PCM playback need native
audio modules: for example a PCM recorder that emits 24 kHz 16-bit mono chunks as base64
(such as `react-native-live-audio-stream` or `@mykin-ai/expo-audio-stream`) and a player that
can queue raw PCM (such as `react-native-audio-api`'s Web-Audio-style `AudioContext`). The
`mic` and `player` objects below stand in for whichever you choose.

While `DEMO_OPEN` is `"true"` you can omit the bearer token; keep it in the client anyway so
the same code works after the demo is closed.

```ts
const BASE = "https://evade.health";
const TOKEN = process.env.EXPO_PUBLIC_EVADE_TOKEN!; // demo only, see the auth note

type ServerMsg =
  | { type: "status"; state: "connecting" | "ready" | "ended"; reason?: string }
  | { type: "notice"; message: string }
  | { type: "audio"; audio: string }
  | { type: "clear" }
  | { type: "mark"; name: string }
  | { type: "transcript"; role: "agent"; id: string; delta: string }
  | { type: "transcript"; role: "user"; id: string; text: string; final: boolean }
  | { type: "transcript_done"; role: "agent"; id: string }
  | { type: "tool_result"; name: string; result: any }
  | { type: "speech_started" | "speech_stopped" | "pong" }
  | { type: "error"; message: string };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(await res.json())}`);
  return res.json() as Promise<T>;
}

export const getLatestCheckin = (crewId?: string) =>
  api<{ checkin: any | null }>(`/api/checkins/latest${crewId ? `?crew_id=${encodeURIComponent(crewId)}` : ""}`);
export const getDownlink = (limit = 5) => api<{ messages: any[] }>(`/api/downlink?limit=${limit}`);

export async function startVoice(crew: string, mic: Mic, player: Player, onEvent: (m: ServerMsg) => void) {
  const { ws_url } = await api<{ ws_url: string }>("/api/voice/start", {
    method: "POST",
    body: JSON.stringify({ crew }),
  });
  const ws = new WebSocket(ws_url);
  const send = (m: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));
  const ping = setInterval(() => send({ type: "ping" }), 20_000);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data as string) as ServerMsg;
    switch (msg.type) {
      case "status":
        if (msg.state === "ready") mic.start((b64Pcm16At24k) => send({ type: "audio", audio: b64Pcm16At24k }));
        break;
      case "audio":
        player.enqueue(msg.audio); // base64 PCM16 LE mono 24 kHz
        break;
      case "clear":
        player.flush(); // barge-in: stop talking immediately
        break;
      case "mark":
        player.onDrained(() => send({ type: "mark", name: msg.name })); // after queued audio plays
        break;
    }
    onEvent(msg); // transcripts, tool_result, errors -> UI
  };
  ws.onclose = () => { clearInterval(ping); mic.stop(); player.flush(); };

  return { stop: () => send({ type: "stop" }) };
}

// Minimal shapes for your audio modules:
interface Mic { start(onChunk: (b64: string) => void): void; stop(): void }
interface Player { enqueue(b64: string): void; flush(): void; onDrained(cb: () => void): void }
```
