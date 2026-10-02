# Support tools reference

Everything support uses to investigate sign-in problems. Privacy rule first (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Compute the hash locally.

## Auth0 dashboard

Two tenants: `meetingmaker` (prod, domain `auth.recoverysky.app`, one client shared by every app build) and `bad-bitch-tenant` (dev). Canonical API domain is `<tenant>.us.auth0.com`. Use prod only for real tickets.

### Find a user by email

1. Dashboard, User Management, Users. Search by email.
2. The same address can map to several rows before linking (`auth0|`, `google-oauth2|`, `email|`, `apple|`). After linking there is one user, and the others sit under its Identities.
3. Open the user. The user's `user_id` is the **primary sub**. Copy it only to hash it (see below).
4. Read **Identities**: `identities[0]` is the root identity; a linked `email` secondary shows provider `email`.
5. Read the **Email verified** flag. Caution (from the verification spec, not independently verified): a password account that later signed in by code likely still shows `email_verified: false`, because the token keeps the password identity's flag. That does not mean the app will ask for verification: the verify screen is only shown to sessions with no `loginMethod` (see [email verification](email-verification.md)).

### Tenant log event codes

Monitoring, Logs. Open an event for `connection`, `user_id`, and `description` (on a failure the description is the reason). The codes below are the ones our tooling labels (`auth0/scripts/diagnose-linking.mjs`, `TYPE_LABELS`). For anything else use Auth0's official list of log event codes (Auth0 docs, "Log Event Type Codes").

| Code | Our label | Use it for |
| --- | --- | --- |
| `s` | login OK | A successful login. Check `connection` and `user_id`. |
| `f` | login FAILED | Generic failure; read the description. |
| `fp` | wrong password | Password sign-in with a wrong password. |
| `fu` | unknown user | Password sign-in for an address that does not exist. |
| `ss` | signup OK | An account was created. |
| `fs` | signup FAILED | Signup failed. |
| `cls` | code sent | A login code (Continue with Email) was mailed by Auth0. Proves the send reached Auth0 even if the app timed out. |
| `fcls` | code send FAILED | Auth0 could not send the code. |
| `sepft` | password grant OK | **A successful email-code login** (seen on the dev tenant 2026-10-02: description "Successful exchange of Password for Access Token", connection `email`; Auth0 records the passwordless code grant under this type). Usually followed by `s`. |
| `seacft` | (none) | Successful exchange of authorization code for access token: the browser-based logins (password form, Google, Apple). |
| `sce` | (none) | Successful email change, e.g. after a verify-email change of address ("You can now login to the application with the new email."). |
| `sertft` | refresh OK | A refresh-token exchange worked. |
| `fertft` | refresh FAILED | A refresh failed. The app only signs out on permanent failures. |
| `slo` | logout | Logout. |
| `sdu` | user deleted | A user was deleted. |

**Failed code logins:** no failed email-code event has been observed on our tenants, so we cannot name its type code. Filter the log to the user (or connection `email`) around the time and read any event whose type starts with `f`, using its description text. Our script also labels `fcoa`, `scoa` and `feacft` as code events; those labels are unverified guesses (`fcoa` is most likely Auth0's cross-origin-authentication failure). Check Auth0's official log event type list before relying on them.

Our script hides `sapi`, `seccft`, `mgmt_api_read` and `fapi` as machine noise (our own Management calls and the Action's token mint). Do not treat them as user activity.

A login with `connection=email` whose `user_id` is **not** `email|...` means the link Action linked the new identity into an existing account and made that account primary. Every later code login for that user looks the same.

### Action execution results

Two post-login Actions run, in this order: **Link passwordless identity**, then **Identities claim**.

- Open the login event, then Action Details (Actions executions). As far as our tooling shows, this gives only a per-Action result: `ok` or an `ERROR` with its error. That is all `diagnose-linking.mjs` reads from it.
- The Link Action's own `console.log` strings are `linked email identity into <provider> primary` (`<provider>` is `auth0`, `google-oauth2` or `apple`) and `link skipped: <reason>` (for example `token grant <status>` or `GET /users-by-email 429`). Auth0 sends Action console output to Actions Real-time Logs or a log stream while it runs; whether the login event keeps it is not confirmed (unverified), so do not rely on finding these strings after the fact.
- Durable check that a link happened: compare the login event's `connection` with the sub it was issued for. A login with `connection=email` whose `user_id` starts with `auth0|`, `google-oauth2|` or `apple|` (not `email|`) means the identity was linked and the other account is primary. If an `email` login keeps issuing an `email|` sub for a user who should have linked, the Action did not link (it failed, or no account matched).
- The Link Action logs nothing for its silent early returns (not an `email` login, already linked, a refresh exchange, no matching account), so "no match" and "already linked" look the same.
- The Identities claim Action writes no log line; only its result (ok or ERROR) exists.

Logs never carry an email in these lines.

## Management API (support is trusted to write on prod)

Base URL `https://<tenant>.us.auth0.com/api/v2/`. Send `Authorization: Bearer <token>`. Get a token from Dashboard, Applications, APIs, Auth0 Management API, API Explorer. These tokens are broad and expire (the dev one for 24 hours, the prod one for about 30 days); refresh from the same page. Never print a token and never paste one into a ticket. Always do a `GET /users/{id}` first and keep the before-state of the fields you change.

Notes that apply to every write: the user id is the sub, URL-encode the `|` (`auth0%7C65f0000000000000000000aa`); a write on prod is immediate and affects a real person.

### Update an email or set `email_verified` (password users only)

`PATCH /api/v2/users/{sub}`

To change the address (this is exactly what our API sends after a successful verification):

```json
{
  "email": "user@example.com",
  "email_verified": true,
  "verify_email": false,
  "connection": "Username-Password-Authentication"
}
```

To only mark the current address verified:

```json
{ "email_verified": true }
```

Warnings:

- Password (`auth0|`) accounts only. Auth0 cannot change a Google or Apple address.
- `verify_email: false` stops Auth0 sending its own verification mail. Leave it out and the user gets one.
- Check first with `GET /api/v2/users-by-email?email=<address>` that no other user holds the new address. If one does, a change collides; that is the `email_in_use` case.
- The sub does not change, so no server rows and no RevenueCat customer move.
- After the address is right, the user must sign in again so the token claim updates. A code sign-in with the corrected address links into the password account.

### Link two accounts

`POST /api/v2/users/{primary_sub}/identities`

```json
{ "provider": "google-oauth2", "user_id": "1098000000000000000aa" }
```

`provider` is everything before the first `|` of the secondary's sub, and `user_id` is everything after it. The user in the path becomes the **primary**: Auth0 returns the primary's sub for every identity afterwards. Pick the older account, the one holding the data.

Warnings:

- This links in Auth0 only. It does **not** move server rows (attendance, attendance reports, reminders, notification deliveries, unsubscribes, push tokens, notification subscriptions). They stay under the old uid. The app's own link path (`POST /auth0/link`) sweeps those rows first and rolls back on failure; a hand link does not.
- A database (`auth0|`) secondary also needs a `connection_id`. The API refuses that form; do not hand-link a password account as the secondary without engineering.
- `link_with` (ID-token form) does not work across our apps: it fails with `JWT (link_with) contains an invalid aud claim`.
- A device whose owner was the secondary sees the primary's sub at the next sign-in; the app handles that through the identities claim.

### Unlink

`DELETE /api/v2/users/{primary_sub}/identities/{provider}/{secondary_user_id}`

This is Auth0's documented form. Our repo has no script or doc that unlinks, so nothing here has been exercised by us. Warnings: the secondary gets its original sub back as a separate user; a device owner recorded under the primary will then mismatch; the rows already moved by `POST /auth0/link` do not move back. Check Auth0's current API docs for the exact response and do this only when the reason is clear.

### Delete a user

`DELETE /api/v2/users/{sub}`

Warnings:

- Irreversible. The Auth0 account, its identities and its login history are gone. It does not delete server data (attendance, reports) or the RevenueCat customer.
- Never delete account A because account B asked. Confirm the user controls the account being deleted.
- Deleting a primary removes its linked identities with it.
- The log event is `sdu` (user deleted).

## Hash an Auth0 sub into the log `userId`

The app logs `userId` as the first 8 bytes (16 hex characters) of the SHA-512 of the UTF-8 sub (`hashUserId`, tweetnacl `nacl.hash`, which is SHA-512). Node's built-in crypto gives the same value and needs no repo checkout:

```bash
node -e 'const c=require("crypto");console.log(c.createHash("sha512").update(process.argv[1]).digest("hex").slice(0,16))' 'auth0|65f0000000000000000000aa'
```

On the fake sub above it prints `9a262f8faf59287c` (16 hex characters). Single-quote the sub: it contains `|`. The repo's own recipe (`docs/DIAGNOSTICS.md`) uses tweetnacl and prints the same value, but it needs `tweetnacl` resolvable, so run it inside the app repo. Do not use a web hashing page: that sends the sub to a third party.

For a linked account, hash the primary sub (the app logs the token's `sub`). Also hash each linked identity's sub when you suspect an older record: a device owner can still hold a previous sub.

## Loki

- URL `https://loki.intra.recoverysky.net`. Use `curl -sk` (the certificate is internally issued). `loki.rso:3100` and Prometheus are not reachable from a workstation.
- Use `GET /loki/api/v1/query_range` with `query`, `start` and `end` (nanoseconds), `limit` up to 5000.
- Query in windows of about 6 hours and loop; put the loop in a script file (long inline commands with `jq` get rejected).
- Retention: Loki 31 days, Tempo 72 hours.
- If every query says "no space left on device", check inodes on the Loki host (`df -i`) before assuming Loki is down.

### Labels

Index labels only: `service_name="recoverysky-app"`, `module`, `appVersion` (`{version}-{update}`, for example `4.10.1-15`). Everything else is **structured metadata**: `sessionId`, `deviceId`, `userId`, `kind`, `code`, `status`, `attempt`, `error`, `reason`. Filter it after the selector with `| key="value"`. A line filter (`|= "text"`) does **not** match structured metadata; for `error` or `reason` use `| error=~".*text.*"`. There is no device model or OS field.

API logs are `{service_name="app_api"}`: pino text with ANSI colour codes, one `container` label per replica. Postgres is `{service_name="databases_postgres"}`.

### Auth queries (replace `<hash>` and `<deviceId>`)

```
{service_name="recoverysky-app"} | userId="<hash>"
{service_name="recoverysky-app", module="VerifyEmailGate"} | userId="<hash>"
{service_name="recoverysky-app", module="Api"} |= "Email verification" | userId="<hash>"
{service_name="recoverysky-app", module="useAuth0Wrapper"} | userId="<hash>"
{service_name="recoverysky-app"} |= "Foreign session on an owned device" | deviceId="<deviceId>"
{service_name="recoverysky-app", module="linkForeignIdentity"} | userId="<hash>"
```

For windows that include builds before 4.10.1-9 add `or user_id="<hash>"` to the filter. On builds up to 4.10.1-4, module-level loggers (`Api`, `AuthStore`, `ConfigStore`, `sqliteKey`, `App`) carry no `userId`; find a line that does, then pivot with `| sessionId="<sessionId>"`. Judge coverage on `appVersion="4.10.1-5"` and later.

### Log lines worth knowing

| Message | Module | Attributes |
| --- | --- | --- |
| `Verify email shown` | `VerifyEmailGate` | `mode` (skippable or mandatory), `showing` (1 to 7) |
| `Email verified` | `VerifyEmailGate` | `changed` |
| `Credential renewal after verify failed` | `VerifyEmailGate` | `code` |
| `Starting email verification` | `Api` | none |
| `Email verification start failed` | `Api` | `code`, `status` |
| `Confirming email verification` | `Api` | none |
| `Email verification confirm failed` | `Api` | `code`, `status` |
| `Device owner adopted` | `useAuth0Wrapper` | `ownerId` (hashed) |
| `Owner stamped from hydration` | `RootStore` | none |
| `Foreign session on an owned device` | `useAuth0Wrapper` | `ownerId`, `loginMethod` (the foreign account is not findable in Loki; use the Auth0 tenant log) |
| `Foreign identity linked` | `linkForeignIdentity` | `linked`, `reason`, `moved` |
| `Foreign identity link failed` | `linkForeignIdentity` | `problem` |

`code` is structured metadata: filter with `| code="email_in_use"`, not `|=`. The app's 429 label `rate_limited` is invented by the app from HTTP 429; the API never sends it.

API side (`{service_name="app_api"}`, strip ANSI first): `POST /auth0/email/start: provider refuses that recipient`, `POST /auth0/email/start: send failed`, `POST /auth0/email/verify: address belongs to another account`, `POST /auth0/email/verify: Auth0 refused the update` (carries only the HTTP status), `Per-minute rate limit exceeded`. Rate limits are per API replica, so "3 per minute" is about three per replica.

## Tempo

Every app request carries a random W3C `traceparent`, and the app logs one debug line per response: message `API request`, module `Api`, with `method`, `url`, `status`, `durationMs`, `problem`, `traceId`.

1. Loki: `{service_name="recoverysky-app"} | module="Api" | status="401" | userId="<hash>"` and copy the `traceId`.
2. Tempo: `GET http://tempo.rso/api/traces/<32-hex traceId>` (plain http from a workstation). 404 means not found: older than 72 hours, or the route is ignored (`/config` and `/status` are never traced, by design).
3. Search: `http://tempo.rso/api/search?tags=service.name%3Drecoverysky-api&limit=8&start=<unix>&end=<unix>`.
4. Spans exist only if the API's OTLP trace exporter is configured; a 404 for a recent trace can mean that too. A healthy trace has a server root span (for example `GET /schedules/live`) whose parent is the app's span id.

The API's own log lines do not carry `traceId`; use `requestId` there.

## Postmark activity

Only mail sent by **our API** is in Postmark: the verification code mail (the verify-email screen). Login codes ("Continue with Email") are sent by **Auth0's own email provider (SMTP)**; diagnose those in the Auth0 tenant log (`cls`), not in Postmark.

- Server: shared with another RecoverySky product's mail. Filter message stream `outbound`, tag `email-verify`. Attendance reports use tag `attendance-report`.
- Subject: `<code> is your RecoverySky verification code`. The code is visible in Postmark Activity. Do not copy it into tickets.
- Inactive recipient (Postmark error 406): the address was deactivated after a hard bounce or spam complaint. Our API answers `inactive_recipient` (HTTP 400), and the app shows "We can't deliver email to that address. Try a different one." You can reactivate the address under the stream's Suppressions in Postmark if that is appropriate; this step is operational, not described in our code.
- A bounce of a verification mail is invisible to the user and the app: the bounce webhook ignores mail with this tag (it answers `matched:false`). The user just never gets the code.
- The app shows `invalid_email` from the API with the same "can't deliver" copy, so that message can also mean an address our API's own check rejected.

## What is never logged

Not in any field, at any level: the user's own email, the report recipient's email, the verification or login code, the raw Auth0 `sub`, `shortName`, raw coordinates, Wi-Fi SSID. Structured metadata counts. The check for a leak is `| email!=""`.

Exceptions: Sentry and Umami do receive the raw sub (their UIs group by it, so it matches the Auth0 dashboard). Postmark Activity holds the recipient and the code mail. Treat all three as personal data.

## Sources

- `docs/DIAGNOSTICS.md`
- `app/utils/logger/hashUserId.ts`
- `auth0/README.md`
- `auth0/scripts/diagnose-linking.mjs`
- `auth0/actions/meetingmaker/link-passwordless-identity.js`
- `auth0/actions/meetingmaker/identities-claim.js`
- `docs/PROD_AUTH0_ROLLOUT.md`
- `app/components/VerifyEmailGate.tsx`
- `app/services/api/emailVerifyProblem.ts`
- `api:src/routes/auth0Email.ts` (PATCH body, `PASSWORD_CONNECTION`, log lines)
- `api:src/routes/auth0.ts` (`linkIdentityFromSub`, `attemptLink`)
- `api:src/middleware/rate-limit.ts` (rate-limit log lines)
- `docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md` (the `email_verified` claim behaviour)
- `api:src/routes/reports.ts` (confirmation webhook)
- `api:src/services/email.ts` (Postmark stream and tags)
