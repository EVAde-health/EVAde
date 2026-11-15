<!-- Voice agent docs (moved from the old README.md when main replaced it with "README (3).md"). Hosted version: worker/ on evade.health; see worker/README.md. -->

## 📞 Voice agent (Twilio + Grok)

Talk live with **EVAde**, an xAI Grok realtime voice agent that runs the daily check-in out loud. Two ways in, **one agent**: same instructions, voice, tools and rules.

- **🎙️ Browser (primary demo):** the web app's **Journal** tab (https://evade.health/journal) talks to the hosted agent with your mic. (The old standalone `/voice/` page was removed.)
- **📞 Phone:** dial a Twilio number. Needs a Twilio number (paid account), so use it once you have one.
- **☁️ Hosted:** the same agent runs on Cloudflare Workers at **https://evade.health** (TypeScript port in [`worker/`](worker/README.md)): phone **+1 (908) 663-1285**, browser via the Journal tab, and a JSON + WebSocket API for the React Native app ([`worker/API.md`](worker/API.md)).

Same design principle: every flag comes with *why* and *what to do*, and it says it's **decision support, not a medical device**.

```
Browser mic ──(WS /voice/browser, PCM16 24 kHz)──┐
                                                 ├─> api/voice_agent.py ⇄ wss://api.x.ai/v1/realtime (grok-voice-latest)
Phone ⇄ Twilio ──(WS /voice/stream, μ-law 8 kHz)─┘           │  function calls
                                                             ▼
                                  api/voice_tools.py → models/checkin_rules.py → SQLite data/evade.db
                                  (save_checkin, queue_flight_surgeon_message → downlink_queue)
```

- **One implementation:** `api/voice_agent.py` holds the persona, the xAI session config, tool handling and barge-in. `api/voice_browser.py` and `api/voice.py` only move audio.
- **Key stays on the server:** the browser talks to our FastAPI bridge, which talks to xAI, so `XAI_API_KEY` never reaches the page. (xAI also offers short-lived *ephemeral tokens* for direct browser connections; we don't need them with the bridge.)
- **Audio:** the browser captures the mic with an AudioWorklet, downsamples to **24 kHz PCM16** (`audio/pcm`, rate 24000) and plays the agent's 24 kHz PCM16 back. The phone path passes Twilio's **G.711 μ-law 8 kHz** straight through (`audio/pcmu`), with no resampling.
- **Barge-in:** when Grok's server VAD hears you start talking, the browser stops playback (Twilio gets a `clear`).
- **Data endpoints:** the latest check-in and the flight-surgeon downlink queue (`GET /voice/api/checkins/latest`, `GET /voice/api/downlink`).
- **Tools:** `save_checkin` (stores the check-in, returns level + reasons + actions, compares sleep and mood with your own last 7 check-ins) and `queue_flight_surgeon_message` (writes to `downlink_queue` with comms mode `online` / `mars` / `blackout`).
- **Security:** the browser WebSocket and data endpoints are **local-only** by default (requests through a tunnel are refused); set `EVADE_BROWSER_TOKEN` and pass `?token=…` to allow another machine. `/voice/incoming` checks Twilio's `X-Twilio-Signature` and hands Twilio a one-time token that `/voice/stream` checks before opening an xAI session. `/voice/alert` needs `X-EVADE-Token` (or a localhost caller).
- **Stand-ins:** `models/checkin_rules.py` (standard clinical reference ranges) and the SQLite helpers in `api/voice_tools.py` are placeholders for the team's real check-in rules and storage. Repoint the two functions in `api/voice_tools.py` when that code lands. `api/main.py` here is minimal; merge its two `include_router` lines into the real one.

### Setup

1. **Keys:** an xAI API key ([console.x.ai](https://console.x.ai)). For phone mode, also a Twilio account with a voice-capable number ([console.twilio.com](https://console.twilio.com)).
2. **Env:** copy `.env.example` to `.env` and fill it in (it's git-ignored). Browser mode only needs `XAI_API_KEY`.

| Variable | Required | What it is |
|---|---|---|
| `XAI_API_KEY` | ✅ | xAI API key (sent as `Authorization: Bearer …`, server-side only) |
| `TWILIO_ACCOUNT_SID` | phone: `/voice/alert` | Twilio Account SID (`AC…`) |
| `TWILIO_AUTH_TOKEN` | phone (recommended) | Twilio auth token; turns on webhook signature checks |
| `TWILIO_PHONE_NUMBER` | phone: `/voice/alert` | Your Twilio number, E.164 (`+1…`) |
| `PUBLIC_BASE_URL` | phone | Public HTTPS URL of this server, e.g. `https://abc123.ngrok.app` |
| `XAI_VOICE` | optional | Voice name, default `eve` (others include `ara`, `rex`, `sal`, `leo`) |
| `XAI_MODEL` | optional | Default `grok-voice-latest` |
| `TWILIO_VALIDATE_SIGNATURE` | optional | `false` to skip signature checks in local testing only |
| `EVADE_COMMS_MODE` | optional | Default downlink mode: `online` (ISS), `mars` (20-min delay), `blackout` |
| `EVADE_ALERT_TOKEN` | optional | Shared secret for `POST /voice/alert` from another machine |
| `EVADE_BROWSER_TOKEN` | optional | Lets another machine use the browser socket/data endpoints via `?token=…` |

### Run it locally

```bash
# Mac / Linux
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.main:app --port 8000
```

```powershell
# Windows (PowerShell)
py -m venv .venv; .venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
py -m uvicorn api.main:app --port 8000
```

The old browser page (`/voice/`) was removed; for a browser demo use the web app's Journal tab against the hosted Worker. Locally this server handles the phone path and the `/voice/browser` socket.

Tests: `python -m pytest` (Windows: `py -m pytest`). They mock Twilio and xAI, so no keys are needed.

### Phone mode: expose it and point Twilio at it

Twilio has to reach your laptop over HTTPS/WSS. In a second terminal, run **one** of:

```bash
ngrok http 8000                                   # copy the https://….ngrok-free.app URL
cloudflared tunnel --url http://localhost:8000    # copy the https://….trycloudflare.com URL
```

Put that URL in `.env` as `PUBLIC_BASE_URL` and restart uvicorn. Then in the Twilio Console: **Phone Numbers → Manage → Active numbers → your number → Voice configuration → "A call comes in" → Webhook → `https://<public>/voice/incoming` → HTTP POST → Save.** Call the number.

Optional red-alert call (from the same machine):

```bash
curl -X POST http://localhost:8000/voice/alert -H "Content-Type: application/json" \
  -d '{"to": "+15551234567", "message": "EVAde red alert: crew member check-in is red."}'
```

### Hosted on Cloudflare (evade.health)

[`worker/`](worker/README.md) is a TypeScript port of the voice agent for Cloudflare Workers, with the same persona, tools, check-in rules and security checks. Calls and app sessions each run in a Durable Object that bridges the WebSocket to xAI. Check-ins, the downlink queue and one-time stream tokens live in a D1 database instead of `data/evade.db`. The React Native app uses REST under `/api/` plus a voice WebSocket (`/api/voice/ws`), documented in [`worker/API.md`](worker/API.md). To deploy: `cd worker && npm install && npx wrangler d1 migrations apply evade --remote`, set the four secrets (`XAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `EVADE_BROWSER_TOKEN`, `EVADE_ALERT_TOKEN`) with `npx wrangler secret put`, then run `npx wrangler deploy`, and point the Twilio webhook at `https://evade.health/voice/incoming`. On the hosted version, the tunnel and single-worker limits below don't apply.

### Voice limitations
- Needs a **live link** (internet to xAI, plus the phone network for phone mode), so it's a **ground-side or ISS channel**. On a Mars transit, the on-board check-in and on-device text-to-speech are the right path.
- **Phone mode needs a Twilio number**, which a free trial may not be able to get. **Twilio trial accounts** also play a trial notice at the start of each call and only reach **verified numbers**. Browser mode avoids all of this.
- The tunnel URL changes each time you restart a free ngrok/cloudflared tunnel: update `PUBLIC_BASE_URL` **and** the Twilio webhook.
- One-time stream tokens live in memory, so run a single uvicorn worker.
- The caller's phone number (or `?crew=` in the browser, default `browser-demo`) is the crew ID until login exists.

