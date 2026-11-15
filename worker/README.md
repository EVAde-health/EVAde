# EVAde voice agent on Cloudflare Workers

TypeScript port of the Python/FastAPI voice agent (`api/voice*.py`, `models/checkin_rules.py`)
that runs on Cloudflare Workers at **https://evade.health**. Same persona, tools, check-in
rules, Twilio flow and security checks; the Python version stays in the repo for local use.

- **Phone:** Twilio number → `POST /voice/incoming` (signature-checked TwiML `<Connect><Stream>`)
  → `wss://evade.health/voice/stream` → xAI Grok realtime voice (`audio/pcmu`, 8 kHz, no resampling).
- **App / browser:** React Native app or the web app's Journal tab → `wss://evade.health/api/voice/ws`
  (alias `/voice/browser`) → xAI (`audio/pcm`, 24 kHz). JSON REST under `/api/`. See [API.md](API.md).
- **Red-alert call:** `POST /api/alert` (alias `/voice/alert`) places an outbound Twilio call.

## Architecture

| Piece | How |
| --- | --- |
| Router | `src/index.ts` (plain Worker). `/` is a small landing page; unknown paths are 404. On evade.health, `deploy/wrangler.jsonc` adds the web app build as static assets (SPA fallback). |
| Voice bridge | `src/session.ts`: **one Durable Object (`VoiceSession`) per call or app session.** The Worker forwards the WebSocket upgrade to a fresh DO, which accepts the listener socket and opens the outbound xAI socket with `fetch()` + `Upgrade: websocket` + `Authorization: Bearer`. |
| Why a DO | A call is minutes of ~50 frames/s each way. A plain Worker request has one CPU budget for its whole life (10 ms on Free), which a call would exhaust; in a DO every incoming WebSocket message resets the CPU budget, and the object stays alive while the sockets are open. |
| Agent logic | `src/agent.ts` (persona, `session.update`, greeting, barge-in, tool calls, playback marks) and `src/bridges.ts` (Twilio / app transports). Transport-free, so tests drive them directly. |
| Tools + rules | `src/tools.ts` (`save_checkin`, `queue_flight_surgeon_message`, same JSON schemas) and `src/rules.ts` (green / yellow / red). |
| Storage | **D1** database `evade` (binding `DB`) replaces `data/evade.db`: tables `checkins`, `downlink_queue`, `stream_tokens`, `sessions`. |
| One-time tokens | `/voice/incoming` writes a random token (120 s TTL) to `stream_tokens`; the DO consumes it with a single `DELETE … RETURNING` when Twilio's `start` event arrives, before any xAI session opens. Works across isolates; can't be replayed. App WebSocket tickets from `POST /api/voice/start` use the same table (`ws.` prefix, 60 s TTL). |
| Session cap | Browser/app sessions take a row in `sessions` (heartbeat in the last ~2 minutes counts as live). `MAX_CONCURRENT_SESSIONS` (set to 4 in Wrangler) rejects new browser sessions with "too many people talking". Phone calls are not counted. |
| Twilio signature | WebCrypto HMAC-SHA1 of `PUBLIC_BASE_URL + path + query` + sorted form params, constant-time compare (matches twilio-python's `RequestValidator`, incl. the `:443` variant). |
| Outbound call | Twilio REST `Calls.json` with `fetch` + basic auth; TwiML `<Say voice="Polly.Joanna">` ×2 with a 1 s pause. |

## Configuration

Vars (in `wrangler.jsonc`): `PUBLIC_BASE_URL=https://evade.health`, `TWILIO_ACCOUNT_SID`,
`TWILIO_PHONE_NUMBER=+19086631285`, `XAI_MODEL`, `XAI_VOICE`, `EVADE_COMMS_MODE`,
`TWILIO_VALIDATE_SIGNATURE`, `CORS_ALLOW_ORIGINS`, `DEMO_OPEN`, `MAX_SESSION_SECONDS`,
`MAX_CONCURRENT_SESSIONS`.

| Var | Configured value | Meaning |
| --- | --- | --- |
| `DEMO_OPEN` | `"true"` | When `"true"`, the web/app voice socket and read APIs (`/voice/browser`, `/api/voice/ws`, `/api/voice/start`, check-ins, downlink) do not require a token. `/api/alert` and `/voice/alert` stay token-protected, and Twilio signature checks are unchanged. |
| `CORS_ALLOW_ORIGINS` | `https://evade.health,https://www.evade.health` | Echo the request's origin in the CORS response only for an exact match. |
| `MAX_SESSION_SECONDS` | `"300"` | Max length of a browser/app voice session. The Durable Object sends a notice (`session limit reached`) and closes with code 1000. Browser sessions also close after 60 s with no client audio (`time-up`). Phone calls use a 600 s limit and are not subject to the idle-audio timer or the concurrency cap. |
| `MAX_CONCURRENT_SESSIONS` | `"4"` | Max live browser/app sessions (rows in `sessions` with a heartbeat in the last ~2 minutes). Extra callers get `"too many people talking"` (HTTP 429 on `POST /api/voice/start`, or a notice + close on the WebSocket). |

### Turn off open demo access

1. Set `DEMO_OPEN` to `"false"` in both `deploy/wrangler.jsonc` and `worker/wrangler.jsonc`.
2. Once the change is on `main`, redeploy from the repository root in PowerShell.

   ```powershell
   $env:WORKER_REF = (git rev-parse HEAD); node deploy/deploy.mjs
   ```

The web/app voice socket and read APIs will require `EVADE_BROWSER_TOKEN` again.

### Required secrets

Secrets (`npx wrangler secret put <NAME>`, never in git):

| Secret | Used for |
| --- | --- |
| `XAI_API_KEY` | xAI realtime voice (server-side only; never reaches the app) |
| `TWILIO_AUTH_TOKEN` | Twilio signature check on `/voice/incoming` and REST auth for alerts |
| `EVADE_BROWSER_TOKEN` | App / browser access when `DEMO_OPEN` is `"false"`: `Authorization: Bearer …` or `?token=…` |
| `EVADE_ALERT_TOKEN` | `X-EVADE-Token` (or `Authorization: Bearer`) for `POST /api/alert` |

## Deploy

Deploy only from the repository root on merged `main` in PowerShell.

```powershell
$env:WORKER_REF = (git rev-parse HEAD); node deploy/deploy.mjs
```

**Do not run `npx wrangler deploy` from `worker/`.** That would replace the live site with the voice Worker alone and leave `/`, `/journal`, and `/admin` returning 404.

After deploying, open [the Journal](https://evade.health/journal), start a voice check-in, and confirm it connects.

### One-time setup

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

npm test                         # vitest, fully local (Miniflare + fake xAI/Twilio)
```

Then in the Twilio Console set the number's **"A call comes in"** webhook to
`https://evade.health/voice/incoming` (HTTP POST). Browser: the web app's Journal tab at
`https://evade.health/journal` (open for the hackathon demo while `DEMO_OPEN` is `"true"`).

`evade.health` must be an active zone in the same Cloudflare account. The custom-domain route
creates the DNS record and certificate; remove any existing A/CNAME record on the apex first.

## Local development

```bash
cp .dev.vars.example .dev.vars   # fill in XAI_API_KEY etc.
npm run db:migrate:local
npm run dev                      # http://localhost:8787/ (API + phone webhooks)
```

On `localhost` the app API is open without a token (like the Python localhost-only mode).
On `evade.health`, access follows `DEMO_OPEN` (see above). Logs: `npx wrangler tail`.

## Tests

`npm test` runs Vitest inside the Workers runtime (`@cloudflare/vitest-plugin`) with a real local
D1 and the Durable Object. Outbound requests go to `test/fake-xai.js`, which emulates the xAI
realtime socket and Twilio's REST API. Covered: check-in rules and wording, tools and D1 storage,
TwiML, Twilio signatures (reference values from twilio-python), one-time tokens, alert auth,
REST API + CORS, the phone and app bridges, full WebSocket round trips through the DO,
`DEMO_OPEN` access, the concurrency cap, and the session time limit.
