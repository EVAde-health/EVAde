# Auth0 setup for EVAde (default login)

The Worker (`api.evade.health`) runs the OIDC authorization-code flow with PKCE against Auth0.
New sign-ins create an astronaut in D1 (`users` + `auth_identities`, subject = Auth0 `sub`).
Roles are managed in Auth0 and synced to `users.role` on every login.

## 1. Tenant + application
1. Create a tenant (e.g. `evade`).
2. Applications → Create Application → **Regular Web Application**.
3. Settings:
   - **Allowed Callback URLs:** `https://api.evade.health/auth/callback/auth0`
     (add `http://localhost:8787/auth/callback/auth0` for `wrangler dev`)
   - **Allowed Logout URLs:** `https://evade.health`
   - **Allowed Web Origins:** `https://evade.health`
   - Advanced → Grant Types: **Authorization Code**. Use **RS256** for ID tokens and **Post** for the token endpoint authentication method.
4. Copy **Domain**, **Client ID**, **Client Secret** (step 4 below; never paste them into chat, code or git).

## 2. Connections (Authentication)
- **Database** → Username-Password-Authentication: on for the app. Password policy: Good or better.
- **Passwordless** → Email: enable the email one-time code connection for the app. Select **Identifier First** under Authentication → Authentication Profile for Universal Login. First-time users get created in D1 like any other login.
- **Social** → Google, GitHub: on for the app. Replace Auth0's dev keys with your own Google/GitHub OAuth apps before the demo.
- Branding → Universal Login: set logo/colors to match Ryan B's design.

## 3. Roles, Action, security
1. User Management → Roles → create `astronaut`, `flight_surgeon`, `therapist`, `admin`. Assign staff roles to the doctor/therapist accounts.
2. Actions → Library → Build from scratch → Post Login. Paste `auth0/post-login-action.js` and set its Action secret `EVADE_WEB_CLIENT_ID` to the web application's Client ID. Deploy the Action, add it to the **post-login** trigger, and Apply.
3. Security → Multi-factor Auth: enable at least one factor (e.g. One-time Password and WebAuthn). The Action enforces it for staff only.
4. Security → Attack Protection: turn on **Brute-force Protection**, **Suspicious IP Throttling**, **Breached Password Detection**, and **Bot Detection**.

## 4. Worker secrets
From `cloud/worker`, run each command and paste the value at the prompt (it is never shown or saved in git):

```powershell
npx.cmd wrangler secret put AUTH0_DOMAIN --name evade-api
npx.cmd wrangler secret put AUTH0_CLIENT_ID --name evade-api
npx.cmd wrangler secret put AUTH0_CLIENT_SECRET --name evade-api
```

Enter the Auth0 tenant or custom domain as a hostname with no scheme or path. If the Worker does not already have Turnstile, add both `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` with the same command. The widget needs to allow `evade.health` and `api.evade.health`. After the Auth0 Worker is deployed, check that `GET https://api.evade.health/auth/providers` lists `auth0` first.

## 5. Frontend (Ryan B)
- Sign in: form `POST https://api.evade.health/auth/start` with `provider=auth0`, `redirect=https://evade.health/dashboard` and a Turnstile response for the `login` action. The provider field defaults to Auth0 when configured.
- Sign up: same, plus `screen_hint=signup` (opens Auth0's sign-up screen).
- Current user: `GET /auth/me` with `credentials: "include"`.
- Sign out: submit a top-level form `POST /auth/logout` or use a credentialed POST with `Accept: application/json` and navigate to its `logout_url`. A direct fallback session returns `204`.

## Notes
- Auth0 role names are case-sensitive. When several staff roles apply, the order is `admin`, `flight_surgeon`, then `therapist`. The next Auth0 login synchronizes a role removal to D1. Older HTTP sessions then lose staff access.
- Google and GitHub direct logins remain crew-level fallbacks. Staff browser access requires Auth0 and the MFA Action.
- Existing direct-provider accounts and Auth0 identities are separate unless an authorized operator links the exact Auth0 subject to the existing D1 user. Perform verified linking before the user's first Auth0 login if they need their existing records. Keep the Auth0 application on the same tenant for this D1 database.
