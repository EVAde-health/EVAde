# AGENTS.md

Guidance for AI coding agents (and humans) working on EVAde, NASA Space Apps 2026 (NYU Tandon): a crew health monitor with a web dashboard and a Grok voice agent.

Web app conventions (Astryx design system, component rules) are in [`EVAde/AGENTS.md`](EVAde/AGENTS.md). This file covers how the pieces fit together and how to ship them.

## Live URLs

| URL | What serves it |
| --- | --- |
| https://evade.health | Cloudflare Worker `evade`: the React web app (this branch) plus the voice agent |
| https://evade.health/journal | Journal tab: browser voice check-in with EVAde (web app, calls `/api/voice/*`) |
| https://evade.health/api/... , `/health`, `/voice/incoming` | Voice/API routes and the Twilio phone line (+1 908 663 1285) in the `evade` Worker |
| https://api.evade.health | API Worker `evade-api`, backed by the private `evade-gateway` model service |

Both domains are Cloudflare Workers custom domains in the **EVAde** Cloudflare account (`2e5df567f3580c5af313ebb51e1920fa`), zone `evade.health`.

## Branches

- `main` is the only production deployment branch. It contains the website (`EVAde/`), voice Worker (`worker/`), API (`cloud/worker/`), and model gateway (`cloud/model-gateway/`).
- `ExpoApp` contains the mobile app.

## Hard rules

- **The browser voice chat lives in the web app's Journal tab** (`EVAde/src/components/VoiceJournal.tsx`, `src/services/voiceAgent.ts`). The old `/voice/` page was removed. Keep the `/voice/incoming`, `/voice/stream`, `/voice/alert`, `/voice/browser`, `/voice/api/*` entries in `run_worker_first`: the phone line and API aliases depend on them.
- Don't change existing Worker endpoints. The phone line (Twilio) and the React Native app depend on them.
- Never commit secrets. Worker secrets (`XAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `EVADE_BROWSER_TOKEN`, `EVADE_ALERT_TOKEN`) are stored on the Worker and survive deploys.

## How evade.health is wired

One Worker (`evade`) serves everything on `evade.health`:

1. Requests to `/api`, `/api/*`, `/health`, `/voice/incoming`, `/voice/stream`, `/voice/alert`, `/voice/browser`, `/voice/api/*` go to the Worker code first (Twilio webhooks, WebSockets, JSON API).
2. Everything else is a static asset: the web app build (`EVAde/dist`).
3. Unknown page paths (such as `/journal` on refresh, or the retired `/voice/`) fall back to the SPA's `index.html` (`not_found_handling: single-page-application`).

Config: [`deploy/wrangler.jsonc`](deploy/wrangler.jsonc). It combines the site assets and voice Worker from the same checkout.

### Voice API for web clients (same origin, no CORS needed)

- `POST /api/voice/start` returns a one-time WebSocket ticket.
- `WS /api/voice/ws` is the voice socket (24 kHz PCM16 audio; see `EVAde/src/services/voiceAgent.ts` and `micWorklet.ts` for a working client).
- `GET /api/checkins/latest`, `GET /api/downlink` return crew data.
- Both Wrangler configs set `CORS_ALLOW_ORIGINS` to `https://evade.health,https://www.evade.health`. Browser API responses grant CORS only to those exact origins.
- `DEMO_OPEN=true` (hackathon demo) means no access key is needed for voice or read APIs. Limits: 4 concurrent browser/app sessions, 300 s each.

## Deploying

Follow [DEPLOY.md](DEPLOY.md) for the API, gateway, and site deploy sequence from clean `main`.
**Do not run `npx wrangler deploy` from `worker/`.** It would replace the live site with the voice Worker alone and leave `/`, `/journal`, and `/admin` returning 404.

## Local development

- Web app: `cd EVAde && npm install && npm run dev`. Optional `VITE_USDA_API_KEY` in `EVAde/.env` (see `.env.example`).
- Voice Worker: `cd worker && npm install && npx wrangler dev` (copy `.dev.vars.example` to `.dev.vars`). Tests: `npm test`.

## Deploy history

- 2026-11-14: first deploy of `features/web-app` (commit `aebdeb5`) to evade.health, together with the voice Worker from `feature/twilio-grok-voice-agent`. Worker version `aad7f32c`.
