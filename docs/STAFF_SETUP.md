# EVAde staff sign-in

## Configure Cloudflare Access

1. In Zero Trust, create a second **Self-hosted** Access application for `api.evade.health/auth/access/staff`. Keep the existing astronaut application on `api.evade.health/auth/access` and leave the rest of the API available to the website and service clients.
2. Select **One-time PIN** as the login method. Create an **Allow** policy with an **Emails** include rule for the approved staff only. Set the application session duration to **30 minutes**. For staff access to real health data, also require an independent second factor. [Cloudflare Access independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/)
3. Copy the staff application's Audience (AUD) Tag into `ACCESS_STAFF_AUD` in `cloud/worker/wrangler.jsonc`. Use a different audience from `ACCESS_AUD`. A blank staff value disables staff sign-in. Deploy the backend using the documented procedure before testing the staff application.
4. Have each approved staff member open [Staff sign-in](https://api.evade.health/auth/access/staff?redirect=https%3A%2F%2Fevade.health%2Fadmin) and enter their own allowlisted email and one-time PIN. The staff route creates an EVAde account if needed and records the verified staff enrollment. Pending enrollment shows the verified email and account reference without opening a staff session.
5. If Access is already signed in under someone else's email, choose **Use a different email** on the website login page, or start the staff sign-in in a fresh private browser window. Confirm that the pending page shows your own email before sharing the account reference.

## Assign a D1 role

Confirm the account reference with the approved staff member using a trusted channel. The reference is their `users.user_id`. The crew identity uses `cloudflare_access`. Verified staff sign-in also records a `cloudflare_access_staff` identity with the same Access subject and user ID. The promotion query requires the staff record.

Send a parameterized query with the [D1 API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/). Use the EVAde account and `evade-db` IDs from the dashboard. Use an existing D1 Write token in the current shell and keep its value private. Choose `flight_surgeon`, `therapist`, or `admin` for the assigned role.

```powershell
$accountId = Read-Host 'EVAde account ID'
$databaseId = Read-Host 'evade-db database ID'
$userId = Read-Host 'Verified EVAde account reference'
$role = Read-Host 'Staff role (flight_surgeon, therapist, or admin)'

$sql = @'
UPDATE users
SET role = ?
WHERE user_id = ? AND role = 'astronaut'
  AND EXISTS (
    SELECT 1 FROM auth_identities AS identity
    WHERE identity.user_id = users.user_id AND identity.provider = 'cloudflare_access_staff'
  )
'@
$payload = @{ sql = $sql; params = @($role, $userId) } | ConvertTo-Json -Compress
$result = Invoke-RestMethod -Method Post `
  -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/d1/database/$databaseId/query" `
  -Headers @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" } `
  -ContentType 'application/json' -Body $payload
if (-not $result.success -or $result.result[0].meta.changes -ne 1) {
  throw 'Expected exactly one approved account to be updated.'
}
```

Have the staff member open staff sign-in again. `GET /auth/me` should show the assigned role, and `/admin` should open. Verify that crew and demo accounts receive HTTP 403 on the staff API. The Worker rechecks the D1 role on each API request and before sending live feed data to a signed-in user. Revoke the D1 role and remove the user from the Access allow policy to remove staff access.

Use synthetic accounts and data for judging. The emergency control sends alerts to the EVAde staff console. Use the established emergency channel for urgent help. A real deployment with health data needs a separate privacy and clinical safety review.
