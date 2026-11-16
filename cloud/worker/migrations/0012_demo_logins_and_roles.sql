-- 0012: "Try the demo" logins and two account roles. Safe to re-run.
-- The demo signs into the seeded FAKE crew from 0011 only: Cmdr. Vega (astronaut, d001) or, with
-- "Switch to flight surgeon", Dr. Ortiz (flight surgeon, d002). The Worker looks these rows up by
-- (provider 'demo', subject) and never accepts a user id from the request.
INSERT OR IGNORE INTO auth_identities (provider, subject, user_id, email)
SELECT 'demo', 'vega', user_id, NULL FROM users WHERE user_id = '00000000-0000-4000-8000-00000000d001' AND role = 'astronaut';
INSERT OR IGNORE INTO auth_identities (provider, subject, user_id, email)
SELECT 'demo', 'ortiz', user_id, NULL FROM users WHERE user_id = '00000000-0000-4000-8000-00000000d002' AND role = 'flight_surgeon';

-- Roles for two existing accounts (matched by their verified sign-in email). New sign-ins are covered by
-- FLIGHT_SURGEON_EMAILS in wrangler.jsonc; astronaut is the default role.
-- Applied on the live D1 on 2026-11-15. The real addresses were replaced with placeholders afterwards, so a replay matches no account.
UPDATE users SET role = 'flight_surgeon'
WHERE user_id IN (SELECT user_id FROM auth_identities WHERE lower(email) = 'flight-surgeon@example.invalid');
UPDATE users SET role = 'astronaut'
WHERE user_id IN (SELECT user_id FROM auth_identities WHERE lower(email) = 'astronaut@example.invalid');
