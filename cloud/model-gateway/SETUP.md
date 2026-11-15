# Model API on Cloudflare Containers

`evade-api` uses a service binding to reach `evade-gateway`. The gateway runs one Cloudflare Container for Michael's FastAPI model API and forwards authenticated requests. The container pulls SHA-256-verified models from the `evade-models` bucket using read-only credentials at startup.

Use [DEPLOY.md](../../DEPLOY.md) for deployment and model refreshes. The Dockerfile and build context come from the pinned `backend-models` submodule. Michael's [Cloudflare Containers setup](../../backend-models/docs/cloudflare-containers-setup.md) describes the underlying architecture.

The model service uses its own D1 database and the separate `evade-model-data` R2 bucket for data. Keep the data bucket credentials scoped to that bucket. Leave the existing Workers, storage, service binding, and secrets in place for routine deployments.

For separately approved setup or rotation, supply secret values only to `wrangler secret put` prompts. The gateway uses `EVADE_API_KEY` for the model API, `GATEWAY_CALLER_KEY` for the service binding, and `ADMIN_KEY` for internal restarts. The API Worker's `MODEL_GATEWAY_KEY` matches the gateway's caller key. The container gets its D1 and R2 configuration from the existing `CF_*` gateway secrets.
