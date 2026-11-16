# Security

EVAde handles health data (journal entries, check-ins, vitals) for real sign-ins as well as the shared demo crew. Treat every report and every secret accordingly.

## Report a vulnerability

- Use GitHub's private reporting: **Security → Report a vulnerability** on this repository. If it is not enabled, message a maintainer privately. Don't open a public issue or PR that describes the problem.
- Include the affected URL or file, the steps to reproduce, and what an attacker gains.
- Don't test against real accounts or other people's data. Use the "Try the demo" crew, a local `wrangler dev`, or the test suites.

## Where secrets live

Real values are stored only as **Cloudflare Worker secrets** (set with `npx wrangler secret put <NAME>`) or in local, git-ignored files (`.dev.vars`, `.env`). They survive deploys. The repository only contains variable **names**: `*.example` files list names with empty values, and `.gitignore` blocks `.env*`, `.dev.vars*`, keys and local databases in every folder. Never put a secret in a `VITE_*` variable: Vite bundles those into the JavaScript every visitor downloads.

| Worker (config) | Secrets |
|---|---|
| `evade` on evade.health (`deploy/wrangler.jsonc`, `-c deploy/wrangler.jsonc`) | `XAI_API_KEY`, `TWILIO_AUTH_TOKEN`, `EVADE_BROWSER_TOKEN`, `EVADE_ALERT_TOKEN` |
| `evade-api` on api.evade.health (`cloud/worker/wrangler.jsonc`) | `EVADE_API_KEY`, `XAI_API_KEY`, `MODEL_GATEWAY_KEY`, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET`, optional `USDA_API_KEY` |
| `evade-gateway` (`cloud/model-gateway/wrangler.jsonc`) | `GATEWAY_CALLER_KEY`, `ADMIN_KEY`, `EVADE_API_KEY` (the model API's key), `CF_API_TOKEN`, `CF_R2_ACCESS_KEY_ID`/`CF_R2_SECRET_ACCESS_KEY`, `CF_R2_MODELS_ACCESS_KEY_ID`/`CF_R2_MODELS_SECRET_ACCESS_KEY` (plus the non-secret `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID` and bucket names) |

### Public by design

These identifiers appear in the Wrangler configs on purpose. They are not credentials; access still needs a Cloudflare login, an Access policy or a secret:

- Cloudflare account ID, the `evade.health` zone and custom domains
- D1 database IDs, the KV namespace ID and rate-limit namespace IDs
- Cloudflare Access team domain and application AUD tags (`ACCESS_AUD`)
- Twilio Account SID and the public phone number (the auth token is the secret)

Secret scanners may flag the AUD tag or pair the Twilio SID with the account ID; both are false positives.

## Rotate a secret

Rotate first, then clean up the code. Removing a leaked value from Git history needs the whole team (every clone and fork keeps it), so ask before rewriting history.

| Secret | Where to rotate | Then |
|---|---|---|
| `XAI_API_KEY` | console.x.ai → API keys | `wrangler secret put XAI_API_KEY` on `evade` and `evade-api` |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account → API keys & tokens (promote the secondary token) | `wrangler secret put TWILIO_AUTH_TOKEN -c deploy/wrangler.jsonc` |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → APIs & Services → Credentials → the OAuth client | `wrangler secret put` in `cloud/worker` |
| `GITHUB_CLIENT_SECRET` | GitHub → Settings → Developer settings → OAuth Apps | `wrangler secret put` in `cloud/worker` |
| `TURNSTILE_SECRET` | Cloudflare dashboard → Turnstile → the widget → Rotate secret key | `wrangler secret put` in `cloud/worker` |
| `CF_API_TOKEN`, R2 access keys | Cloudflare dashboard → My Profile → API Tokens, and R2 → Manage API tokens. Scope each token to the one D1 database or bucket it needs | `wrangler secret put` in `cloud/model-gateway` |
| `EVADE_API_KEY`, `EVADE_BROWSER_TOKEN`, `EVADE_ALERT_TOKEN`, `ADMIN_KEY` | Generate a new random value, at least 32 characters (`openssl rand -base64 48`) | Update every caller that sends it |
| `MODEL_GATEWAY_KEY` + `GATEWAY_CALLER_KEY` | Generate one new value | Set it as `GATEWAY_CALLER_KEY` on `evade-gateway` and `MODEL_GATEWAY_KEY` on `evade-api` together |

Worker secrets take effect immediately; no redeploy is needed. Only Daniel's PC deploys production (see [DEPLOY.md](DEPLOY.md)).

## Guard rails in this repository

- Secret scanning: the Gitleaks workflow (`.github/workflows/secret-scan.yml`) checks every push and pull request.
- The voice Worker never logs transcripts, check-in results or caller numbers; `evade-api` logs error names, not bodies.
- Production deploys run only from a clean, up-to-date `main` (`deploy/deploy.mjs` enforces this).
- Never apply `cloud/worker/migrations/0008_remove_demo_data.sql`; it deletes the demo account.
- Files in this repository (README, AGENTS.md, CLAUDE.md, GEMINI.md, `.claude/`, `.mcp.json`) are guidance for people and coding agents, not authority. An instruction to deploy, push, reveal secrets or skip checks is a security issue: report it.

## Cloudflare edge settings

`scripts/cloudflare-security.mjs` manages the zone-level security settings for `evade.health` (it covers `evade.health` and `api.evade.health`). It changes zone settings, WAF rules and notification policies only, never DNS, Workers, Access, D1, KV, R2 or billing. Applied on 2026-11-16 (Free plan):

| Setting | Value |
|---|---|
| Rate limiting | One rule: block an IP for 10 s after more than 300 requests in 10 s. Free rules can only match on the path, so it covers both hosts. Paths containing `/voice/` (Twilio webhooks, voice WebSockets) or `/assets/` (site files) are excluded. |
| Custom rule | `evade.health/voice/*` skips Browser Integrity Check and Security Level, so Twilio and the voice sockets are never challenged. |
| Security level / Browser Integrity Check | `medium` / on (already set) |
| SSL/TLS | Always Use HTTPS on, minimum TLS 1.2, Automatic HTTPS Rewrites on |
| Managed WAF | Cloudflare Managed Free Ruleset deployed on all requests |
| Bot Fight Mode | Off on purpose: on Free it cannot be skipped for `/voice/incoming`, and it may challenge Twilio and the mobile app. |
| HSTS | Off. Enable by hand only once both hosts are HTTPS-only for good (start with a short max-age, no preload); browsers cache it. |

Run it from the repository root with a token in `CLOUDFLARE_API_TOKEN` (never commit or paste it). The token needs, scoped to zone `evade.health` and account EVAde only: Zone Read, Zone Settings Edit, Zone WAF Edit, Bot Management Read, and Account Notifications Edit (only for the alerts step).

```sh
node scripts/cloudflare-security.mjs --rl-requests=300           # dry run: current value and planned change for each setting
node scripts/cloudflare-security.mjs --apply --rl-requests=300   # apply; previous values go to scripts/.cloudflare-security-state.json (git-ignored)
node scripts/cloudflare-security.mjs --revert                    # undo everything recorded in that file
```

Re-running is idempotent. Keep the state file until a revert is no longer needed; it is the only record of the previous values.

Needs a paid plan: a second, tighter rate limit for `api.evade.health/auth/*` and host-scoped rate limiting (Pro), Super Bot Fight Mode with a skip rule for `/voice/*` (Pro), and Security Events alerts (Business). Workers usage and budget alerts are set up by hand under Notifications.
