# EVAde voice agent on Cloudflare Workers

TypeScript port of the Python/FastAPI voice agent (`api/voice*.py`, `models/checkin_rules.py`)
that runs on Cloudflare Workers at **https://evade.health**. Same persona, tools, check-in
rules, Twilio flow and security checks; the Python version stays in the repo for local use.

- **Phone:** Twilio number → `POST /voice/incoming` (signature-checked TwiML `<Connect><Stream>`)
  → `wss://evade.health/voice/stream` → xAI Grok realtime voice (`audio/pcmu`, 8 kHz, no resampling).
- **App / browser:** React Native app or the `/voice/` page → `wss://evade.health/api/voice/ws`
  (alias `/voice/browser`) → xAI (`audio/pcm`, 24 kHz). JSON REST under `/api/`. See [API.md](API.md).
- **Red-alert call:** `POST /api/alert` (alias `/voice/alert`) places an outbound Twilio call.

## Architecture

| Piece | How |
| --- | --- |
| Router | `src/index.ts` (plain Worker). Static files from the repo's `frontend/` via Workers Static Assets, so `frontend/voice/index.html` is `/voice/`. `/` is a small landing page. |
| Voice bridge | `src/session.ts`: **one Durable Object (`VoiceSession`) per call or app session.** The Worker forwards the WebSocket upgrade to a fresh DO, which accepts the listener socket and opens the outbound xAI socket with `fetch()` + `Upgrade: websocket` + `Authorization: Bearer`. |
| Why a DO | A call is minutes of ~50 frames/s each way. A plain Worker request has one CPU budget for its whole life (10 ms on Free), which a call would exhaust; in a DO every incoming WebSocket message resets the CPU budget, and the object stays alive while the sockets are open. |
| Agent logic | `src/agent.ts` (persona, `session.update`, greeting, barge-in, tool calls, playback marks) and `src/bridges.ts` (Twilio / app transports). Transport-free, so tests drive them directly. |
| Tools + rules | `src/tools.ts` (`save_checkin`, `queue_flight_surgeon_message`, same JSON schemas) and `src/rules.ts` (green / yellow / red). |
| Storage | **D1** database `evade` (binding `DB`) replaces `data/evade.db`: tables `checkins`, `downlink_queue`, `stream_tokens`. |
| One-time tokens | `/voice/incoming` writes a random token (120 s TTL) to `stream_tokens`; the DO consumes it with a single `DELETE … RETURNING` when Twilio's `start` event arrives, before any xAI session opens. Works across isolates; can't be replayed. App WebSocket tickets from `POST /api/voice/start` use the same table (`ws.` prefix, 60 s TTL). |
| Twilio signature | WebCrypto HMAC-SHA1 of `PUBLIC_BASE_URL + path + query` + sorted form params, constant-time compare (matches twilio-python's `RequestValidator`, incl. the `:443` variant). |
| Outbound call | Twilio REST `Calls.json` with `fetch` + basic auth; TwiML `<Say voice="Polly.Joanna">` ×2 with a 1 s pause. |

## Configuration

Vars (in `wrangler.jsonc`): `PUBLIC_BASE_URL=https://evade.health`, `TWILIO_ACCOUNT_SID`,
`TWILIO_PHONE_NUMBER=+19086631285`, `XAI_MODEL`, `XAI_VOICE`, `EVADE_COMMS_MODE`,
`TWILIO_VALIDATE_SIGNATURE`, `CORS_ALLOW_ORIGINS`.

Secrets (`npx wrangler secret put <NAME>`, never in git):

| Secret | Used for |
| --- | --- |
| `XAI_API_KEY` | xAI realtime voice (server-side only; never reaches the app) |
| `TWILIO_AUTH_TOKEN` | Twilio signature check on `/voice/incoming` and REST auth for alerts |
| `EVADE_BROWSER_TOKEN` | App / browser access: `Authorization: Bearer …` or `?token=…` |
| `EVADE_ALERT_TOKEN` | `X-EVADE-Token` (or `Authorization: Bearer`) for `POST /api/alert` |

## Deploy

```bash
cd worker
npm install                      # also runs `wrangler types`
npx wrangler login               # account 2e5df567f3580c5af313ebb51e1920fa

# D1 (already created: database_id is in wrangler.jsonc). For a fresh account:
#   npx wrangler d1 create evade   -> paste the id into wrangler.jsonc
npx wrangler d1 migrations apply evade --remote

# Secrets (each prompts for the value)
npx wrangler secret put XAI_API_KEY
npx wrangler secret put TWILIO_AUTH_TOKEN
npx wrangler secret put EVADE_BROWSER_TOKEN
npx wrangler secret put EVADE_ALERT_TOKEN

npm test                         # 56 tests, fully local (Miniflare + fake xAI/Twilio)
npx wrangler deploy              # creates the evade.health custom domain on first deploy
```

Then in the Twilio Console set the number's **"A call comes in"** webhook to
`https://evade.health/voice/incoming` (HTTP POST). Browser: `https://evade.health/voice/?token=<EVADE_BROWSER_TOKEN>`.

`evade.health` must be an active zone in the same Cloudflare account. The custom-domain route
creates the DNS record and certificate; remove any existing A/CNAME record on the apex first.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in XAI_API_KEY etc.
npm run db:migrate:local
npm run dev                      # http://localhost:8787/voice/
```

On `localhost` the app API is open without a token (like the Python localhost-only mode);
on `evade.health` a token is always required. Logs: `npx wrangler tail`.

## Tests

`npm test` runs Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`) with a real local
D1 and the Durable Object. Outbound requests go to `test/fake-xai.js`, which emulates the xAI
realtime socket and Twilio's REST API. Covered: check-in rules and wording, tools and D1 storage,
TwiML, Twilio signatures (reference values from twilio-python), one-time tokens, alert auth,
REST API + CORS, the phone and app bridges, and full WebSocket round trips through the DO.
