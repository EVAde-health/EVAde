# AGENTS.md

Guidance for AI coding agents (and humans) working on EVAde, NASA Space Apps 2026 (NYU Tandon): a crew health monitor with a web dashboard and a Grok voice agent.

Web app conventions (Astryx design system, component rules) are in [`EVAde/AGENTS.md`](EVAde/AGENTS.md). This file covers how the pieces fit together and how to ship them.

## Live URLs

| URL | What serves it |
| --- | --- |
| https://evade.health | Cloudflare Worker `evade`: the React web app (this branch) plus the voice agent |
| https://evade.health/journal | Journal tab: browser voice check-in with EVAde (web app, calls `/api/voice/*`) |
| https://evade.health/api/... , `/health`, `/voice/incoming` | Voice/API routes and the Twilio phone line (+1 908 663 1285) in the `evade` Worker |
| https://api.evade.health | Separate Worker `evade-api`, not touched by this deploy |

Both domains are Cloudflare Workers custom domains in the **EVAde** Cloudflare account (`2e5df567f3580c5af313ebb51e1920fa`), zone `evade.health`.

## Branches

- `features/web-app`: the web app (Vite + React 19 + react-router `BrowserRouter`, Astryx UI) in `EVAde/`. Pages: `/`, `/login`, `/dashboard`, `/tutorials`, `/tasks`, `/journal`, `/selfies`.
- `feature/twilio-grok-voice-agent`: the voice agent. `worker/` is the Cloudflare Worker (TypeScript) and `api/` is the original Python version. (The old `frontend/voice/` page was removed; the Journal tab replaces it.) API reference: `worker/API.md`.
- `main`: default branch.

## Hard rules

- **The browser voice chat lives in the web app's Journal tab** (`EVAde/src/components/VoiceJournal.tsx`, `src/services/voiceAgent.ts`). The old `/voice/` page was removed. Keep the `/voice/incoming`, `/voice/stream`, `/voice/alert`, `/voice/browser`, `/voice/api/*` entries in `run_worker_first`: the phone line and API aliases depend on them.
- Don't change existing Worker endpoints. The phone line (Twilio) and the React Native app depend on them.
- Never commit secrets. Worker secrets (`XAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `EVADE_BROWSER_TOKEN`, `EVADE_ALERT_TOKEN`) are stored on the Worker and survive deploys.

## How evade.health is wired

One Worker (`evade`) serves everything on `evade.health`:

1. Requests to `/api`, `/api/*`, `/health`, `/voice/incoming`, `/voice/stream`, `/voice/alert`, `/voice/browser`, `/voice/api/*` go to the Worker code first (Twilio webhooks, WebSockets, JSON API).
2. Everything else is a static asset: the web app build (`EVAde/dist`).
3. Unknown page paths (such as `/journal` on refresh, or the retired `/voice/`) fall back to the SPA's `index.html` (`not_found_handling: single-page-application`).

Config: [`deploy/wrangler.jsonc`](deploy/wrangler.jsonc). It mirrors `worker/wrangler.jsonc` on the voice branch, except for paths, the SPA fallback, and `/` being served from assets instead of the Worker's old landing page.

### Voice API for web clients (same origin, no CORS needed)

- `POST /api/voice/start` returns a one-time WebSocket ticket.
- `WS /api/voice/ws` is the voice socket (24 kHz PCM16 audio; see `EVAde/src/services/voiceAgent.ts` and `micWorklet.ts` for a working client).
- `GET /api/checkins/latest`, `GET /api/downlink` return crew data.
- `DEMO_OPEN=true` (hackathon demo) means no access key is needed for voice or read APIs. Limits: 5 concurrent browser sessions, 300 s each.

## Deploying

Prereqs: git, Node 20+, and a Wrangler login with access to the EVAde Cloudflare account (`npx wrangler login`, check with `npx wrangler whoami`).

```bash
node deploy/deploy.mjs --dry-run   # build everything and validate config, no upload
node deploy/deploy.mjs             # build and deploy to https://evade.health
```

The script:
1. checks out `origin/feature/twilio-grok-voice-agent` into `.deploy/worker-src` (a git worktree; override with `WORKER_REF=<ref>`),
2. runs `npm ci && npm run build` in `EVAde/`,
3. assembles `.deploy/site` = `EVAde/dist`,
4. runs `wrangler deploy -c deploy/wrangler.jsonc` using the Worker's own Wrangler.

`.deploy/` is gitignored.

After deploying, smoke-test:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://evade.health/          # 200, web app
curl -s -o /dev/null -w "%{http_code}\n" https://evade.health/journal   # 200, SPA fallback
curl -s https://evade.health/health                                      # {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://evade.health/voice/incoming  # 403 (unsigned Twilio request is rejected, as it should be)
```

Rollback: `npx wrangler rollback -c deploy/wrangler.jsonc` (run from `.deploy/worker-src/worker`), or pick an earlier version under Workers > `evade` > Deployments in the Cloudflare dashboard.

Logs: `npx wrangler tail evade` (observability and persistent logs are on).

## Local development

- Web app: `cd EVAde && npm install && npm run dev`. Optional `VITE_USDA_API_KEY` in `EVAde/.env` (see `.env.example`).
- Worker: on the voice branch, `cd worker && npm install && npx wrangler dev` (copy `.dev.vars.example` to `.dev.vars`). Tests: `npm test`.

## Deploy history

- 2026-11-14: first deploy of `features/web-app` (commit `aebdeb5`) to evade.health, together with the voice Worker from `feature/twilio-grok-voice-agent`. Worker version `aad7f32c`.
