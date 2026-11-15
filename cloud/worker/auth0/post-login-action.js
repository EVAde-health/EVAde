/**
 * EVAde Auth0 Post-Login Action
 * Auth0 dashboard → Actions → Library → Create Action → "Build from scratch",
 * Trigger: Login / Post Login, Runtime: Node 22. Paste this file, Deploy, then
 * Actions → Triggers → post-login → drag "EVAde roles + staff MFA" into the flow → Apply.
 *
 * (a) Puts the user's Auth0 RBAC role names into the ID token's https://evade.health/roles claim.
 *     The EVAde Worker maps them to users.role on every login.
 * (b) Requires MFA for staff (flight_surgeon, therapist, admin): they can see every astronaut's data.
 *     Astronauts are not forced into MFA.
 *
 * Roles are created under User Management → Roles with these exact names:
 *   astronaut, flight_surgeon, therapist, admin
 */
const NAMESPACE = "https://evade.health/roles";
const STAFF = new Set(["flight_surgeon", "therapist", "admin"]);

exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== event.secrets.EVADE_WEB_CLIENT_ID) return;
  const roles = event.authorization?.roles ?? [];

  api.idToken.setCustomClaim(NAMESPACE, roles);

  if (roles.some((r) => STAFF.has(r))) {
    // 'any' lets the user use whichever factor they enrolled (authenticator app, SMS, WebAuthn, email...).
    // Turn on at least one factor under Security → Multi-factor Auth for this to take effect.
    api.multifactor.enable("any", { allowRememberBrowser: false });
  }
};
