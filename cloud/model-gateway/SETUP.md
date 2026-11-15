# Model API on Cloudflare Containers (evade-gateway)

Michael's FastAPI model service runs in **one** Cloudflare Container behind the `evade-gateway` Worker.
Only the `evade-api` Worker can reach it (service binding, no public URL). Full background:
`EVAde-backend-models/docs/cloudflare-containers-setup.md`.

```
browser ─► evade-api (login, D1, stores results) ─service binding─► evade-gateway ─► container (FastAPI :8000)
                X-Gateway-Key (MODEL_GATEWAY_KEY)                    adds X-EVAde-Key      models from R2, state in D1/R2
```

Placeholders (`"source": "mock"`) are shown with a "placeholder" label and never stored or alerted on (evade-api).

## Before you start (all on the PC that deploys)
- **Workers Paid** is active on the EVAde Cloudflare account.
- **Docker Desktop** is running (Windows: WSL 2 backend). `docker info` must work.
- **R2 is enabled**: dashboard → R2 Object Storage → enable (Cloudflare asks once).
- Michael's repo is cloned **next to** `evade-repo`, on the branch with the `X-EVAde-Key` API and Cloudflare storage:
  ```powershell
  cd C:\Users\decon
  git clone -b api-models-storage https://github.com/Mikeblackbelt/EVAde-backend-models.git
  ```

## 1. Prepare Michael's checkout (local only, nothing is pushed to his repo)
```powershell
cd C:\Users\decon\EVAde-backend-models
copy C:\Users\decon\evade-repo\cloud\model-gateway\Dockerfile.cloudflare .
Add-Content .dockerignore "`n!scripts/fetch_models.py"
docker build -f Dockerfile.cloudflare -t evade-api-test .     # must succeed
```

## 2. Storage for the model service (dashboard)
1. **D1** → Create database `evade-models` (separate from `evade-db`). Copy its **Database ID**.
   Apply Michael's schema:
   `npx.cmd wrangler d1 execute evade-models --remote --file C:\Users\decon\EVAde-backend-models\evade\storage\schema.sql`
2. **R2** → Create bucket `evade-model-data` and bucket `evade-models` (models only).
3. **API token for D1**: My Profile → API Tokens → Create Custom Token → permission **Account · D1 · Edit**, this account only.
4. **R2 tokens** (R2 → Manage API tokens):
   - `evade-model-data` → **Object Read & Write**, that bucket only → Access Key ID + Secret.
   - `evade-models` → **Object Read only**, that bucket only → Access Key ID + Secret (the server must not be able to change models).
   - (Michael, for uploading trained models later) `evade-models` → **Object Read & Write**, kept on his training machine only.

## 3. Secrets (each command prompts; values are never shown or saved in git)
Run from `C:\Users\decon\evade-repo\cloud\model-gateway` after `npm install`.

Generate the two shared keys and load them **without ever displaying them**. The same caller key goes to both Workers:
```powershell
function New-Key { $b = New-Object byte[] 36; [Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b) }
$api = New-Key; $caller = New-Key; $admin = New-Key
$api    | npx.cmd wrangler secret put EVADE_API_KEY      --name evade-gateway
$caller | npx.cmd wrangler secret put GATEWAY_CALLER_KEY --name evade-gateway
$admin  | npx.cmd wrangler secret put ADMIN_KEY          --name evade-gateway
$caller | npx.cmd wrangler secret put MODEL_GATEWAY_KEY  --name evade-api
Remove-Variable api, caller, admin
```
(If `secret put` says the Worker doesn't exist yet, run `npx.cmd wrangler deploy` once in step 4 first, then come back.)

Then paste these at each prompt:
```powershell
foreach ($n in "CF_ACCOUNT_ID","CF_API_TOKEN","CF_D1_DATABASE_ID","CF_R2_BUCKET","CF_R2_ACCESS_KEY_ID","CF_R2_SECRET_ACCESS_KEY","CF_R2_MODELS_BUCKET","CF_R2_MODELS_ACCESS_KEY_ID","CF_R2_MODELS_SECRET_ACCESS_KEY") { npx.cmd wrangler secret put $n --name evade-gateway }
```
| Secret | Value |
|---|---|
| CF_ACCOUNT_ID | `2e5df567f3580c5af313ebb51e1920fa` |
| CF_API_TOKEN | the D1 Edit token (step 2.3) |
| CF_D1_DATABASE_ID | the `evade-models` database ID |
| CF_R2_BUCKET | `evade-model-data` |
| CF_R2_ACCESS_KEY_ID / CF_R2_SECRET_ACCESS_KEY | data bucket token (Read & Write) |
| CF_R2_MODELS_BUCKET | `evade-models` |
| CF_R2_MODELS_ACCESS_KEY_ID / CF_R2_MODELS_SECRET_ACCESS_KEY | models bucket token (**Read only**) |

## 4. Deploy (Docker must be running)
```powershell
cd C:\Users\decon\evade-repo\cloud\model-gateway
npm install
npx.cmd wrangler deploy
```
Then connect evade-api to it: in `cloud/worker/wrangler.jsonc` add
`"services": [{ "binding": "MODELS", "service": "evade-gateway" }],` and redeploy evade-api (`npx.cmd wrangler deploy` in `cloud/worker`).
Wait a few minutes after the first container deploy.

## 5. Check
- `https://api.evade.health/health` → `"models": true`
- Signed in: `https://api.evade.health/models` → the model list (`deep_models` shows which are placeholders).
- First call after idle may return `503` with `Retry-After` while the container starts (up to ~45 s).

## Models
The API starts even with an empty `evade-models` bucket: rule-based beta models work, deep models answer as
placeholders. When Michael has trained folders, he uploads them with `scripts/fetch_models.py --push <folder>`
(write key on his machine only), then restart the container:
`curl -X POST https://<gateway>/__admin/restart` is only reachable with a public URL; with the service binding, just
redeploy the gateway or wait for it to sleep (1 h idle) and wake.

## Cost guard
`standard-1` (4 GiB) per Michael's guide, one instance, sleeps after 1 h idle. Add a billing notification:
Manage Account → Notifications → Billing / usage for Workers & Containers.
