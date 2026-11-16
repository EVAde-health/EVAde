# Deploy EVAde

Deploy production from a clean, merged `main` checkout. The deploy script checks that the checkout matches the current remote `main` before each upload. Use these commands from the repository root for all three Workers.

> **Production deploys run only from a clean, up-to-date `main`, and only on Daniel's PC.** No other machine, CI job, coding agent or feature branch runs `wrangler deploy`, `node deploy/deploy.mjs` or a remote D1 migration. To ship a change, merge it to `main` through a reviewed pull request and ask Daniel to deploy. `deploy.mjs` refuses to run on another branch, with uncommitted or staged changes, or when `HEAD` differs from `origin/main`.

## Prerequisites

- Git, Node.js 24, access to the EVAde Cloudflare account through Wrangler, and read access to Michael’s model API repository.
- Docker Desktop running with Linux containers for the gateway step.

## Deploy in order

Run each command after the preceding command succeeds.

```powershell
git checkout main
git pull --ff-only origin main
node deploy/deploy.mjs --api
node deploy/deploy.mjs --gateway
node deploy/deploy.mjs
```

| Command | Publishes |
| --- | --- |
| `--api` | `evade-api` from `cloud/worker`, serving `api.evade.health` |
| `--gateway` | `evade-gateway` from `cloud/model-gateway`, reachable through the existing service binding |
| No target flag | `evade`, serving the website and voice Worker together at `evade.health` |

The gateway command initializes `backend-models` at the gitlink recorded in this checkout and uses Mikeblackbelt/EVAde-backend-models commit `f449f8aa45ccb4339c41755b8ba9f79a679abd47` for the current image. When changing the pin, update this commit reference with it. A fresh clone works without a sibling checkout.

This rollout requires no database migration. **Never apply `0008_remove_demo_data.sql`**, including from archived branches. It deletes the demo account. The deploy commands leave D1 migrations to a separately reviewed rollout.

Keep existing Cloudflare credentials in Worker secrets. Use the Wrangler prompt for any separately approved secret rotation.

For local build validation, append `--dry-run` to the appropriate command. A site deploy always uses the website and voice source from the same checkout. Deploying Wrangler directly from `worker/` would replace the site with the voice Worker alone.

## Verify production

1. Check [the API health endpoint](https://api.evade.health/health) and open [the signed-in model list](https://api.evade.health/models). Confirm `ecg` (EVA-6), `seizure` (EVA-2), `spaceweather` (EVA-12), `ecg_deep` (EVA-13), and `sleep_deep` (EVA-14) are available. Allow time for the first request to start the container.
2. Open [the Journal](https://evade.health/journal) and start a voice check-in. Use the demo to check the Dashboard, Journal companion, and Research page.

## Roll out new model weights

Michael uploads the new model folders and SHA-256 manifests to the `evade-models` R2 bucket. The container downloads and verifies them at boot using its existing read-only credentials. The weights stay in R2.

Keep `INSTANCE = "evade-api-2"` for this consolidation. For a later model refresh, bump `INSTANCE` to the next fixed name in `cloud/model-gateway/src/index.ts` through a PR to `main`. Run `node deploy/deploy.mjs --gateway` from updated `main` to send new traffic to a fresh container, then check the model list. Do this between demos. The previous instance can finish its work and idle out.

If the team already has an authorized internal caller for the gateway’s protected restart route, it can restart the current instance after an R2-only update. A gateway redeploy with the same instance name does not restart a running container. Keep the gateway private.
