# EVAde Cloud: D1 database, Worker API, space health data (Python)

Owner: Decong. This is the Cloudflare layer of EVAde: the frontend (Ryan B) and the model service (Michael, FastAPI) both talk to this Worker, and the Worker stores everything in D1.

```
Frontend ──► evade-api Worker ──► D1 (evade-db)
   ▲            │  ▲   ▲
   │            │  │   └── cron every 15 min: NOAA space weather → space_weather table
   │            ▼  │
   └─────── /predict/* proxy ──► Michael's FastAPI (/predict/ecg, eeg, radiation-risk, risk)
Python evade_space ──► /observations, /radiation, /space-weather (demo data, NOAA, EVA windows)
```

## Who owns what

| Person | Part | Touch points with this layer |
|---|---|---|
| Decong + Ryan L | D1 database, Worker API, **OAuth login**, Python space data | this repo; schema changes go in `worker/migrations/000N_*.sql` |
| Ryan B | frontend, DB edge functions | bind the same D1 (`evade-db`); call this Worker with `credentials: "include"` so the login cookie is sent, or use a Service Binding to `evade-api` from his Workers |
| Daniel | GoDaddy domain (DNS pointed to Cloudflare), voice AI | Worker custom domain `api.<domain>`; frontend origin goes in `ALLOWED_ORIGINS` |
| Michael | datasets, ECG/EEG models, FastAPI | trains on his datasets offline; D1 stores only results (`/model-results` or `/predict/*`), never raw waveforms |

## Status

| Piece | State |
|---|---|
| D1 `evade-db` (id `c97b8036-5c72-46eb-af95-de38ef64e0b8`) | **live**: migrations 0001-0004 applied |
| Worker `evade-api` | built and tested locally, Cloudflare Access login included; serves at **https://api.evade.health** after deploy (workers.dev URL as fallback) |
| KV `evade-sessions` (id `09f54c946903407a94189a7db78bf20c`) | **live** |
| R2 `evade-media` | needs R2 switched on once in the dashboard, then `npx wrangler r2 bucket create evade-media` |
| Workers AI, Durable Object `CrewFeed` | created automatically on deploy |
| Python `evade_space` | done, 5 tests pass, standard library only |

## Deploy (run on your laptop, once)

```bash
cd worker
npm install
npx wrangler login                 # sign in to Cloudflare, pick the EVAde account
npx wrangler secret put EVADE_API_KEY # supply the service key at the masked prompt
npx wrangler deploy                # prints https://evade-api.<subdomain>.workers.dev
```
Then seed demo crew into the live DB:
```bash
cd ../python
EVADE_API_URL=https://evade-api.<subdomain>.workers.dev EVADE_API_KEY=<key> python3 -m evade_space seed
```
If `deploy` says the D1 database isn't found, the database was created in a different Cloudflare account. Run `npx wrangler d1 create evade-db`, paste the new id into `wrangler.jsonc`, then `npx wrangler d1 migrations apply evade-db --remote`.

When Michael's FastAPI is up: set `FASTAPI_URL` in `wrangler.jsonc` and redeploy. CORS already allows https://evade.health and https://www.evade.health. If deploy fails on the custom domain, evade.health is not a zone in this Cloudflare account yet: remove the `routes` line, deploy on workers.dev, and add the domain once Daniel moves the zone.

Set `EVADE_API_KEY` in `worker/.dev.vars` for local development. Git ignores this file. Keep the service key in server-side configuration. For local Python commands, set `EVADE_API_KEY` in the Python process environment to the same value.

Local dev: `npx wrangler d1 migrations apply evade-db --local && npx wrangler dev`, which serves the API on http://localhost:8787.

## Login with Cloudflare Access

The website links to the Cloudflare Access login. The Worker verifies the Access application token, links its subject to a D1 user, and sets a host-only HttpOnly session cookie. See [Access setup](worker/ACCESS_SETUP.md).

| Path | Use |
|---|---|
| `GET /login?redirect=` | hosted sign-in page (redirect must be an allowed origin) |
| `GET /auth/access` | crew login through Cloudflare Access |
| `GET /auth/access/staff` | staff login through a separate Access application when enabled |
| `GET /auth/providers` | configured login methods and the public site key for optional OAuth fallbacks |
| `GET /auth/me` | current user and role, or 401 with the login URL |
| `POST /auth/logout` | ends the EVAde session |

Who can do what:
- **Astronaut** (session): only their own data. A body without `user_id` is filled in from the session; a different `user_id` gets 403.
- **Staff** (`flight_surgeon` / `therapist` / `admin`; staff sign in through Cloudflare Access at `/auth/access/staff`; roles are set in D1 by an admin, see `worker/ACCESS_SETUP.md`): every astronaut, plus `/admin/*`.
- **Service** (`X-EVAde-Key`): full access, for Python, FastAPI and edge functions.
- Cookie-authenticated writes from another origin are blocked (CSRF), on top of SameSite=Lax.

Frontend call: `fetch("https://api.evade.health/users/<id>/dashboard", { credentials: "include" })`. Get `<id>` from `/auth/me`.

Live feed in the browser (the login cookie is sent automatically):
```js
const ws = new WebSocket("wss://api.evade.health/live");
ws.onmessage = (m) => { const ev = JSON.parse(m.data); /* ev.type, ev.user_id, ev.data */ };
setInterval(() => ws.readyState === 1 && ws.send("ping"), 30000); // keepalive, answered without waking the Durable Object
```
Upload a photo: `fetch(api + "/media?kind=photo&metric=body_temp", { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file })`.

Journal safety: concerning language (self-harm, wanting to die) always creates a red alert for the flight surgeon / psychologist, even if the AI is unavailable, through a keyword check that the model can't override. The astronaut doesn't see concern scores about themselves; only staff do.

Optional direct OAuth fallbacks:
1. **Google**: console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID → Web application. Authorized redirect URI: `https://api.evade.health/auth/callback/google`. Set up the OAuth consent screen as External/Testing and add the team as test users.
2. **GitHub**: github.com/settings/developers → New OAuth App. Homepage `https://evade.health`, callback `https://api.evade.health/auth/callback/github`.
3. **Turnstile**: Cloudflare dashboard → Turnstile → Add widget for `evade.health` and `api.evade.health`. Put the site key in `TURNSTILE_SITE_KEY` in `wrangler.jsonc`.
4. Secrets: `npx wrangler secret put` for `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `TURNSTILE_SECRET`, then `npx wrangler deploy`.

Local testing: set `DEV_LOGIN=true`, `FRONTEND_URL=http://localhost:5173`, and `ALLOWED_ORIGINS=http://localhost:5173` in `worker/.dev.vars`. Open the local Worker's `/login` page for the loopback-only test sign-in. Keep `DEV_LOGIN` off in production.

## Cloudflare services in use

| Service | What EVAde uses it for |
|---|---|
| Workers | the whole API, OAuth login, CSRF/CORS/role checks |
| D1 | health data, baselines, alerts, tasks, login links, admin views |
| Workers KV | sessions and OAuth state, read at the edge on every request |
| Turnstile | bot check on the login page |
| Cron Triggers | NOAA space weather every 15 minutes, EVA go/no-go |
| Custom Domains + DNS | `api.evade.health` on Daniel's domain |
| Workers Observability | logs and traces for the API |
| Workers AI | journal summary, mood and concern level for the psychologist; Whisper voice-to-text for voice journals; plain-language daily briefing |
| AI Gateway (optional) | set `AI_GATEWAY` to log, cache and rate-limit every AI call |
| R2 | photos, ultrasound images, voice journal audio, PDFs (private, access-checked per astronaut) |
| Durable Objects | live crew feed over WebSockets (hibernating), staff see the whole crew in real time |

## Website sign-in

- Google OAuth uses a **Web application** client with the authorized redirect URI `https://api.evade.health/auth/callback/google`. Put that client's ID and secret in Wrangler as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- GitHub OAuth uses the callback `https://api.evade.health/auth/callback/github` and the `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` bindings.
- Use a Cloudflare Turnstile widget for `evade.health` and `api.evade.health`. Set its site key and secret as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`. OAuth providers are available only when their client credentials and both widget settings are present.
- The website links to `https://api.evade.health/auth/access?redirect=https://evade.health/dashboard`. Browser API calls use the API's HttpOnly cookie with `credentials: "include"`.

## API (sign in, or send header `X-EVAde-Key: <EVADE_API_KEY>`; /health and /metrics are public)

- `POST /meals` saves a food name, portion in `grams`, and `macros` (`kcal`, `protein`, `carbs`, `fat`). `GET /users/:id/meals` lists entries and `DELETE /meals/:id` removes one.
- `POST /hydration` records a signed `amount_ml`. `GET /users/:id/hydration` returns entries and `total_ml`. Both lists accept ISO timestamps `since` (inclusive) and `until` (exclusive). A hydration write can specify the same bounds for the user's local tracking day.
- Meal and hydration writes accept an optional UUID `id` for retries and an optional `ts`. Cookie-authenticated astronauts can write to their own record without supplying a `user_id`.

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | liveness check |
| GET | `/metrics` | all health indicators: unit, green/yellow ranges, **how to measure, why it matters in space, what to do, when to call the flight surgeon** (feeds the tutorial section) |
| POST | `/users` | `{display_name, environment: station/spacecraft/rover/planetary_base, mission_name, role}` returns a user with a UUID and seeds today's to-do list |
| GET | `/users` | crew list with open alerts and last risk (for the admin/doctor panel) |
| POST | `/observations` | `{user_id, observations:[{metric, value, ts?, source?, quality?, context_tags?, client_id?}]}` returns each reading's **level** (green/yellow/red) and z-score against the personal baseline; yellow/red readings create alerts; manual readings close matching tasks and award points |
| GET | `/users/:id/observations?metric=heart_rate&days=30` | time series for the charts |
| POST | `/users/:id/baseline/:metric` | builds the personal baseline (median / MAD, as in backend-models baseline-comparison.md) |
| POST | `/self-reports` | `{user_id, mood, stress, fatigue, sleep_quality, note}` (1-5) |
| POST | `/instruments` | PHQ-9 / GAD-7 / PVT; PHQ-9 item 9 > 0 escalates right away |
| POST / GET / PATCH | `/journal`, `/users/:id/journal`, `/journal/:id` | journal entries; Ryan B's LLM step PATCHes `ai_summary`, `sentiment` |
| POST | `/radiation` | dosimeter reading `{daily_dose_msv, cumulative_msv, dose_rate_usv_h, spe_flag}` |
| GET | `/space-weather/latest`, `/space-weather/history?hours=72` | NOAA Kp, proton flux, X-ray class, S-scale, **EVA go/caution/no-go** |
| GET | `/users/:id/risk` | risk score R (0-1), band, action, **max days to return**, domain scores (noisy-OR from backend-models risk-score.md) |
| GET | `/users/:id/dashboard` | **one call for the home screen**: user, risk, latest indicator per metric with color, open alerts, tasks, space weather |
| GET / POST | `/users/:id/tasks`, `/tasks`, `/tasks/:id/complete`, `/leaderboard` | to-do list + gamification |
| GET / POST | `/users/:id/alerts`, `/alerts/escalated`, `/alerts/:id/ack` | alerts; escalated = needs the flight surgeon |
| POST | `/predict/{ecg,eeg,radiation-risk,risk}` | proxy to FastAPI; the result is stored in `model_results` |
| POST | `/model-results` | FastAPI can push results directly instead |
| POST | `/auth/identities` | **server-side only (API key or staff)**: links an external login manually; `{provider, subject, email?, display_name?}`. Links a login to an astronaut and creates the astronaut on first login. Returns the user with `user_id` |
| GET | `/auth/identities/:provider/:subject` | look up the astronaut behind a login |
| GET | `/admin/crew`, `/admin/escalations`, `/admin/therapist-feed?user_id=` | doctor/therapist panel: crew overview with risk band and alert counts, escalations waiting for the flight surgeon, journal summaries with that day's mood |
| POST | `/journal?analyze=sync` | same as `/journal` but waits for the Workers AI analysis and returns it (demo) |
| POST | `/journal/voice` | raw audio body (`audio/webm`, `wav`, `mp3`, `m4a`, `ogg`) → stored in R2 → Whisper transcript → journal entry → AI analysis |
| POST | `/journal/:id/analyze` | staff: re-run the AI analysis |
| GET | `/users/:id/briefing` | plain-language daily briefing from Workers AI (cached 30 min; `?refresh=1`), falls back to rules if AI is down |
| POST | `/media?kind=photo\|ultrasound\|audio\|document&metric=&note=` | raw file body with its Content-Type, max 25 MB → R2 |
| GET | `/users/:id/media`, `/media/:id` | list files, download a file (owner or staff only) |
| GET (WebSocket) | `/live` | live feed: `observation`, `alert`, `risk`, `journal` (staff only), `media`, `task`, `space_weather` events. Staff get the whole crew, astronauts get their own |
| GET | `/live/stats` | staff: open connections |
| POST | `/sync` | offline-first: the frontend queues records in IndexedDB, flushes when the link is up; `client_id` makes it idempotent |

Metric keys: `heart_rate, systolic_bp, diastolic_bp, spo2, respiration_rate, body_temp, blood_glucose, sleep_hours, mood, stress, hrv_rmssd, ecg_irregular_pct, eeg_drowsiness_z, bone_density_change_pct, body_mass_change_pct, daily_radiation_msv`.

## Python: `python3 -m evade_space ...`

| Command | Use |
|---|---|
| `seed --days 30` | creates 4 demo astronauts (nominal, sleep debt, solar storm, fever) across all 4 environments and pushes synthetic mission data, baselines and risk |
| `weather [--push]` | live NOAA space weather; `--push` stores it in D1 |
| `eva-window` | **next best time to spacewalk** from the NOAA 3-day Kp forecast |
| `dose spacecraft --pfu 300` | radiation dose estimate per environment, including a solar particle event |

## Challenge objectives covered by this layer

| Objective (Space Apps 2026, Health Monitoring Software) | Where |
|---|---|
| Gather health indicators (BP, HR, blood sugar, temp, sleep, mood, + images/ECG/EEG via models) | `observations`, `self_reports`, `/predict/*` |
| Evaluate and act on health status | levels + personal baseline, alerts with actions, risk score + MDTR |
| When a result needs crew or flight-surgeon attention | `escalate_when` per metric, escalated alerts, hard-rule overrides (O1, O2, O4, O5) |
| How spaceflight hazards affect indicators; simple instructions | `metric_definitions` text, served by `/metrics` |
| Different environments (spacecraft, station, rover, planetary base) | `users.environment`, environment-specific radiation model |
| Prompt measurements as part of the routine | daily task seeding |
| Gamification | points, task completion, leaderboard |
| Dynamic charts over time | `/users/:id/observations`, `/risk/history`, `/space-weather/history` |
| Color coding | `level` on every reading |
| Limited connectivity in space | `/sync` idempotent offline queue |
| Escalate to flight surgeons on the ground | `/admin/escalations`, `/admin/crew` (doctor panel), live feed |
| Camera images / ultrasound as health input | `/media` (R2) |
| Behavioral health, simple explanations | AI journal analysis, voice journals, daily briefing |

Every value is for demo flagging and human review, not diagnosis. Synthetic data are labelled `source='synthetic'`.
