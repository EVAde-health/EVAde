# Cloudflare Access login for EVAde

Sign-in starts at `https://api.evade.health/auth/access?redirect=https://evade.health/dashboard`.
Cloudflare Access authenticates the visitor and sends the Worker a signed application JWT.
The Worker checks its signature, issuer, audience and validity before using the Access subject
to look up the account in D1. The API uses its own `__Host-evade_session` cookie, which is
host-only, HttpOnly, Secure and SameSite=Lax.

## Cloudflare Zero Trust setup

1. Use team domain `evade-health.cloudflareaccess.com`. Configure One-time PIN or an approved identity provider.
2. Use a self-hosted Access application scoped to `api.evade.health/auth/access`. Keep the rest
   of the API available to the website and service clients. Use an Allow policy restricted to
   approved users or groups for environments that hold private data. Copy the application's
   Audience (AUD) Tag into `ACCESS_AUD` in `wrangler.jsonc`.
3. Every web sign-in opens an astronaut session on the signed-in user's own data. Accounts are
   never merged by email.

## Verification

- Sign in as an approved test crew user and check that `GET /auth/me` returns that D1 user.
  Check that a different astronaut's data is unavailable.
- The website uses `credentials: "include"` on its API requests. `POST /auth/logout` ends the
  EVAde session. Access manages its own login session, so signing in again may reuse it.
