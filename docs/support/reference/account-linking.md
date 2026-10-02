# Account linking

Linking folds several sign-in methods into one Auth0 user, so a person who signs in by code, Google, Apple or password lands in the same account with the same data. There are **two separate mechanisms**. They run in different places, link in different directions, move different things, and fail differently. Keep them apart when you read a ticket.

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Subs in this document are fake (`auth0|65f0000000000000000000aa`).

## The two paths at a glance

| | (a) Automatic | (b) Explicit |
| --- | --- | --- |
| Where it runs | Auth0 tenant, post-login Action "Link passwordless identity" | App wrong-account rescue (`linkForeignIdentity`), then our API `POST /auth0/link` |
| Trigger | An email-code login (connection `email`) | The user lands on the [wrong-account screen](device-owner.md#the-wrong-account-screen), proves they own the device's account, and the foreign session's address equals that account's address |
| Matching | Same email address, looked up in Auth0 | No lookup: the foreign ID token the app held in memory |
| Which account becomes primary | The **oldest** same-email account whose root provider is `auth0`, `google-oauth2` or `apple` | The **device owner's** account (the caller) |
| What gets linked in | The new `email` identity | The foreign identity (Google, Apple, or a code identity) |
| `email_verified` | Ignored | Not consulted |
| Moves server rows (attendance, reports, ...) | **No** | **Yes**, in one database transaction |
| Tells the user | No | No |
| On failure | Login continues unlinked; the next code login retries | Logged; nothing is retried or persisted; see [partial failure](#partial-failure-auth0-linked-rows-not-moved) |

After either path, Auth0 answers every login for the account with the **primary's sub**, whichever method was used. Do not infer the sign-in method from the sub prefix on a linked account.

## Path (a): automatic linking on an email-code login

Action file: `auth0/actions/meetingmaker/link-passwordless-identity.js` (identical in the dev folder `bad-bitch-tenant`). Deployed and bound on prod and dev. It runs first on the post-login flow; the Identities claim Action runs second.

### When it does nothing

It returns silently, in this order, if any of these hold:

1. The login did not come through the `email` connection. Google, Apple and password logins never run it.
2. The user already has more than one identity. This is also the idempotency check: an already-linked user arrives with two or more.
3. The login is a refresh-token exchange (`oauth2-refresh-token`). Linking mid-session would swap the sub under a running app; the next real login retries.
4. The user has no email.

Nothing is logged for these early returns, nor for "no matching account". "No match" and "already linked" look identical in the tenant log.

### How it matches and links

1. It mints its own Management API token (client-credentials, a dedicated machine app with only `read:users` and `update:users`, cached for the token's lifetime minus 60 s; each call has a 5 s timeout).
2. It looks up users by the lower-cased email (`GET /users-by-email`).
3. It drops the new user itself, and keeps only candidates whose **root identity** (`identities[0].provider`) is `auth0`, `google-oauth2` or `apple`.
4. It sorts by `created_at` ascending and takes the **oldest**. That account is the primary.
5. No candidate: the user stays a fresh `email|` account.
6. Otherwise it posts `{ provider: "email", user_id: <bare id> }` to `POST /users/<primary>/identities`, then calls `setPrimaryUser(primary)` so **this very login's tokens already carry the primary's sub**.

Properties that matter in tickets:

- **`email_verified` is not checked.** Candidates match on the address alone; the code login itself proves the inbox. Accepted risk: someone who registered an unverified legacy password account with a victim's address could be linked to whoever proves that inbox. The password is **not** randomised on link (decided 2026-09-30), because old app builds still sign in with it.
- **It never links two pre-existing accounts to each other.** Only the new `email` identity goes into one existing account. A person with a Google account and a separate password account on the same address keeps two accounts; a code login joins the older.
- **It never denies access.** Any exception (Management API 4xx, 5xx or timeout, token grant failure) is caught, logged as `link skipped: <reason>`, and the login completes unlinked.
- **Matching is on the root account's email only.** Auth0 finds a code user by the root account's address; it never sees a linked identity's address. That is why a link between *different* addresses cannot work (see [path (b)](#path-b-explicit-linking-from-the-wrong-account-rescue)).
- The identities claim on the linking login itself does not show the new link; it appears at the next refresh or login.

### How to tell in the tenant log that a login was linked

Auth0 Dashboard, Monitoring, Logs. See [tools: event codes](tools.md#tenant-log-event-codes) and [Action execution results](tools.md#action-execution-results).

- **Durable check.** A login event (`s`) with `connection` `email` whose `user_id` does **not** start with `email|` (it starts with `auth0|`, `google-oauth2|` or `apple|`) was linked. Every later code login for that user looks the same.
- **If it should have linked and did not.** A code login that keeps issuing an `email|` sub for a person with an older same-address account means no link happened: the Action failed or no candidate matched. Check that the older account's root provider is `auth0`, `google-oauth2` or `apple`, and that the address is identical (case aside).
- **Action console lines**, when you can see them (Actions real-time logs or a log stream while it runs; whether the login event keeps them is unverified):
  - success: `linked email identity into <provider> primary` (`<provider>` is `auth0`, `google-oauth2` or `apple`)
  - failure: `link skipped: <reason>`, for example `token grant <status>`, `GET /users-by-email 429` or `POST /users/<id>/identities 400`
- The Action's own Management API calls appear as `sapi` / `fapi` events. Our tooling hides them as noise; do not read them as user activity.

### What data follows an automatic link

An automatic link changes the **sub the user signs in with**; it does not move any server rows. This is an open product decision (R-D), not a bug in the Action.

| Data | Under an automatic link |
| --- | --- |
| Account and sign-in methods | Merged into the primary. |
| Server rows already pushed (attendance, attendance reports, reminders, notification deliveries, unsubscribes, push tokens, notification subscriptions) | **Stay under the old `email|` sub.** The new sub starts empty on the server. |
| RevenueCat subscription bought under the `email|` sub | Does **not** follow by itself. The app's RevenueCat identity is the Auth0 sub, so after a link it is the primary's. The app syncs store receipts once per identity per install, which has moved stranded subscriptions before (restore behaviour: transfer; verified 2026-09-17). Treat a missing subscription as "check, then escalate". |
| Local data on the device | See [relink](#relink-on-other-devices-relinked). |

How big is the gap in practice? A brand-new `email|` user is linked at its first login, before it has any data, so the common case (legacy account first, code login later) loses nothing. Rows end up under an `email|` sub when the person used the code login first (creating the `email|` user and pushing data), and **later** an older-style account with the same address becomes a link candidate (for example they add Google or create a password account on that address) and a later code login links the `email|` user into it. Then their cloud rows sit under the old `email|` sub and the new sub looks empty. This is a "data missing after sign-in" ticket; see [escalation](#escalate). The local copy on the device is not lost.

## Path (b): explicit linking from the wrong-account rescue

This path exists for "I tapped the wrong button once and ended up on a device that belongs to another account". It is a side effect of the rescue; the rescue's main job is to send the user back to their own sign-in.

### The exact condition (verified in code)

After the user proves they own the device's account, the app compares the **foreign** session with the **accepted** session. `decideForeignLink` in `app/services/auth/ownerLogic.ts`, called from `app/services/auth/useAuth0Wrapper.ts`:

| Result | When | Log (module `useAuth0Wrapper`, INFO unless noted) |
| --- | --- | --- |
| `same-session` | The foreign sub equals the accepted sub. Nothing to link. | `Accepted session matches the recorded foreign one — record dropped` |
| `skip-email-mismatch` | The two ID-token addresses differ (trimmed, compared case-insensitively), or **either address is missing**. | `Foreign identity not linked — address differs from the account's` with `foreignId` (hashed) and `foreignProvider` (the sub prefix, for example `google-oauth2`) |
| `link` | Both addresses exist and are equal. | Then, if the foreign ID token is gone: WARN `Foreign session had no ID token — nothing to link`; otherwise it calls the API (module `linkForeignIdentity`) |

The addresses compared are the `email` claim of the foreign ID token and the `email` of the accepted session's token. For a linked account the accepted session's address is the **primary's** address. The user is told nothing either way, and the foreign record is dropped whatever the outcome.

Why the rule exists (code comment, 2026-09-30): Auth0 finds code users by the root account's address only, so a linked identity on a *different* address can never sign in again. The next code login creates a fresh unlinked `email|` user and the device returns to the wrong-account screen, while Settings still lists the dead identity as "Linked". The app therefore no longer makes such links. Links of that kind made before 2026-09-30 may still exist.

### When (b) actually does something

Because (a) already links same-address code logins, (b) matters mainly when the foreign sign-in did **not** go through the Link Action:

- The foreign session is **Google** or **Apple** (sharing the real address) and the owner's account is a code or password account with that same address. Google and Apple logins never run the Action, so this is the main real case.
- A code login whose Action run failed (`link skipped`), so the foreign `email|` user stayed separate.

Foreign **password** (`auth0|`) sessions are refused by the API (`unsupported_identity`, below).

### What the app sends

`linkForeignIdentity` calls `POST /auth0/link` with body `{ "linkWith": "<foreign ID token>" }` and the **owner's** bearer. Transport failures retry at 500, 1500 and 4000 ms; any 4xx ends it. Nothing is persisted: a failure is only retried by the next mismatch, which produces a fresh token.

### What the API does

Route: `api:src/routes/auth0.ts` (`POST /auth0/link`). Rate limit: bucket `auth0-link`, 5 per minute, 20 per hour, 1 concurrent, per API replica.

1. Verifies the foreign ID token against the tenant keys: issuer, **audience = the Native app's client id**, RS256 only, `iat` required and **no older than 5 minutes**. A bearer is not accepted here.
2. Same sub as the caller: answers `linked: false, reason: same_user`.
3. Foreign sub is a database identity (`auth0|`, a password account) or malformed: 400 `unsupported_identity`.
4. Opens a database transaction and **sweeps the foreign sub's rows to the owner's sub**, then, if Auth0 does not already have the identity linked, posts `{ provider, user_id }` to `POST /users/<owner>/identities`, then commits. It does not use Auth0's `link_with` form (it fails across apps with `JWT (link_with) contains an invalid aud claim`).
5. If Auth0 refuses the link, the sweep is rolled back.

The **caller's account is the primary**, not the older or richer one.

### What `moved` covers

The response field `moved` holds row counts for these seven tables, all re-stamped from the foreign sub to the owner:

| Key | Data |
| --- | --- |
| `attendances` | Attendance records (also stamped updated-now, so the owner's devices pull them) |
| `attendanceReports` | Attendance reports (same) |
| `reminders` | Meeting reminders |
| `notificationDeliveries` | Notification delivery records |
| `unsubscribes` | Report unsubscribe records |
| `pushTokens` | Push tokens; foreign rows that duplicate one the owner already has are deleted, the rest move |
| `notificationSubscriptions` | Notification subscriptions; same duplicate rule |

The sweep is idempotent. The duplicate deletions are logged (`dropped`) but not returned. RevenueCat purchases are **not** part of the sweep. Only data that was backed up to the server exists there at all (Cloud Backup is opt-in); local-only data never reaches the API.

### Responses and what they mean

| HTTP | Body | App logs (module `linkForeignIdentity`) | Meaning |
| --- | --- | --- | --- |
| 200 | `linked: true`, `moved` | INFO `Foreign identity linked` (`linked`, `reason`, `moved`) | Linked and swept. |
| 200 | `linked: false`, `reason: already_linked` | same line | Auth0 already had it; the sweep still ran for stragglers. |
| 200 | `linked: false`, `reason: same_user` | same line | Nothing to do. |
| 400 | `code: invalid_link_token` | ERROR `Foreign identity link failed` (`problem`) | The foreign ID token failed any check: older than 5 minutes, wrong issuer or audience, bad signature, malformed. Typical cause: the user sat on the wrong-account screen too long. Deliberately 400, so the app does not mistake it for its own session being rejected. |
| 400 | `error: unsupported_identity` | same | The foreign side is a password account. Cannot be linked this way. |
| 400 | `Invalid request body` | same | Malformed request. |
| 503 | `code: auth_unavailable` | same | Key fetch failed; transient. |
| 503 | `Auth0 Management API is not configured` or `AUTH_MOBILE_CLIENT_ID is not configured` | same | API configuration; escalate. |
| 502 | `link_failed` | same | Auth0 lookup or link refused; rows rolled back. |
| 500 | `Failed to link identity` | same | Sweep, commit or unexpected failure. |
| 429 | `TooManyRequests` | same | Rate limited. |

The app logs only `problem` (a coarse kind, such as `rejected` for a 4xx); the HTTP detail is in the API log (`{service_name="app_api"}`, strip ANSI colour codes). API lines carry `userId` (the owner's hash) and `foreignUserId` (the foreign sub's hash), so you can find the foreign account **from the API log** even though the app log cannot name it. Useful messages:

- `POST /auth0/link: linked` and `POST /auth0/link: already linked — swept any straggler rows` (with `moved`, `dropped`)
- `POST /auth0/link: link token rejected` and `Auth: link token rejected`
- `POST /auth0/link: foreign identity cannot be linked by provider/user_id`
- `POST /auth0/link: Auth0 refused the link — sweep rolled back`
- `POST /auth0/link: sweep failed — rolled back`
- `POST /auth0/link: sweep/COMMIT failed while Auth0 already had the identity linked — rows may not have moved` (the bad one, below)

### Partial failure: Auth0 linked, rows not moved

Signal: ERROR `POST /auth0/link: sweep/COMMIT failed while Auth0 already had the identity linked — rows may not have moved` (attributes `userId`, `foreignUserId`, `error`).

What it means: the database step failed but Auth0 holds the link. A retry would normally heal this (the call is idempotent and sweeps stragglers), but a retry needs the foreign ID token to still be inside its 5-minute window. After that the foreign sub can no longer sign in on its own (it is now a linked identity), so there is no way to mint a fresh token, and its rows stay under the foreign sub.

There is **no support procedure in the repo** for this. Do not hand-edit rows and do not unlink to "retry". **Escalate to engineering** with:

- the two hashes from the log line (`userId` = owner, `foreignUserId` = foreign), the log timestamp and the API `requestId` if present;
- confirmation from the Auth0 dashboard that the foreign identity now sits under the owner's user;
- which data the user reports missing (attendance, reports, reminders) and whether Cloud Backup was on;
- the app version and platform.

Engineering finishes the move by hand (the API logs both ids "so support can finish by hand", and the repo calls this a deferred item). The same escalation covers "Auth0 linked but I see no `moved` log at all".

## Relink on other devices (`relinked`)

When an identity is linked into another account, Auth0 starts answering the old identity's logins with the **primary's** sub. A *different* install that still holds the old sub as its device owner would then look like a foreign account. The identities claim (`https://recoverysky.app/identities`, ID token only) lists every identity's own `sub`, so the ownership gate finds the owner's old sub in it and returns `relinked` instead of `mismatch`.

On `relinked` the app moves the owner to the new sub (keeping the old in `previousOwnerSubs`), rewrites the local `uid` column in `attendances`, `attendance_reports` and `reminders`, restamps (does not clear) the unpushed sync outbox, and signs in normally. The user sees nothing special. Details and logs: [device owner](device-owner.md#relink-after-another-device-linked-the-account).

Both paths cause a relink on the *other* devices: (a) and (b) each change the sub that Auth0 returns.

Two things to remember:

- It rewrites **local** rows only. For an automatic link, server rows under the old sub are not moved (above), and the app does not call the API to move them. Whether the restamped local rows are re-pushed under the new sub on the next sync has not been verified; do not promise the user that the server copy will catch up.
- It depends on the identities-claim Action emitting a per-identity `sub`. The deployed prod and dev files do. On a tenant without it the device loops on the wrong-account screen. See [tools](tools.md#action-execution-results).

## Settings, Account

Settings has an "Account" section with one row per sign-in method:

- Left: a method label, "Email", "Google" or "Apple". Both code (`email`) and password (`auth0`) identities are "Email".
- Right: the full address, and a badge: "Active" for the identity used this session, "Linked" for the other identities on the same account.
- "Hidden by Apple" replaces any address ending `@privaterelay.appleid.com` (compared case-insensitively).
- Screen-reader labels: "Signed in with {{method}}: {{email}}", "Linked {{method}} account: {{email}}", and the `NoEmail` forms "Signed in with {{method}}" and "Linked {{method}} account".

Rules for reading it:

- "Active" follows the session's `loginMethod`, not the sub prefix (a linked account returns the primary's sub). Password sessions have no `loginMethod`, so the row is derived from the `auth0|` prefix.
- The linked rows come **only** from the ID token's identities claim. No claim (unlinked account, or a token minted before the link) shows only the Active row. The claim is not persisted and is refilled at the next sign-in or refresh, so linked rows can be missing briefly after a cold start, and a link made by (b) appears at the next refresh or login.
- If the active method cannot be matched to a single claim entry, the Active row is shown **without** an address rather than a guess.
- A "Linked" row on a *different* address than the account's can be a dead identity (a pre-2026-09-30 link). It will not sign in; see [path (b)](#path-b-explicit-linking-from-the-wrong-account-rescue).
- The "Active" address for a linked account can differ from what the user typed. The device owner's offered "Send code to" address is the one typed at the last code sign-in.

## Apple Hide My Email

Apple can give the app a private relay address (`...@privaterelay.appleid.com`) instead of the user's real one. That address never equals the real address.

**Verified answer: neither path links a Hide My Email account today.**

- **(a) Automatic.** The Action matches on email. The relay address never matches the real address a user types into the email box, so no candidate is found and the code login becomes a fresh `email|` account.
- **(b) Explicit.** The rescue links only when the foreign address equals the accepted account's address (`decideForeignLink`: `a && b && a === b`). Both directions fail the test:
  - Owner is the Apple account (relay address in its token), foreign is the new code account (real address): addresses differ, `skip-email-mismatch`.
  - Owner is the real-address account, foreign is the Apple session (relay address): addresses differ, `skip-email-mismatch`.

  The Apple owner's rescue offers only "Sign in with Apple". Signing in that way ends the loop, but nothing is linked, so the stray code account stays a separate, empty account. The 2026-09-17 design spec says the rescue links relay users; that was superseded by the 2026-09-30 address rule. The code wins.

**Fresh-phone gap.** A Hide My Email user on a new phone who types their real address on the email step creates a new `email|` account. A fresh install has no device owner, so the app adopts that empty account as the owner and no wrong-account screen appears. Signing in with Apple afterwards is then a foreign session; the screen offers only a code for the empty account, and the rescue cannot link them (addresses differ). The only exits are Delete User Data or a reinstall, then "Sign in with Apple" first. Settings shows "Hidden by Apple" for the Apple row and the app never shows the relay address anywhere.

**Do not hand-link them as a workaround.** Linking the code account's `email` identity into the Apple account in the dashboard does not make the code login find it: Auth0 looks code users up by the root account's address (the relay), so the next code login still creates a fresh `email|` user. See [tools: link two accounts](tools.md#link-two-accounts) for the mechanics and the row-move warning.

**One theoretical edge.** If the user types the relay address itself, both paths could match (same address on both sides). That depends on Apple forwarding mail from the sender; it was not tested here, and a user would have to know their relay address (the app never shows it). Treat it as unconfirmed and do not offer it as a fix.

User-side advice: sign in with the same Apple button every time, on every device.

## Linking by hand

Tooling for support-initiated links, unlinks and deletes is in [tools: Management API](tools.md#management-api-support-is-trusted-to-write-on-prod). Two rules from this document: a hand link moves **no** server rows (path (a) behaviour), and a link across different addresses leaves a dead identity.

## Escalate

Hand to engineering when:

- the partial failure above (`sweep/COMMIT failed while Auth0 already had the identity linked`);
- the user lost cloud-backed data after a link and the sub they sign in with changed (automatic link, rows under the old `email|` sub);
- a subscription did not follow a link;
- a device loops on the wrong-account screen after a link (suspect the identities-claim Action).

Attach: the hashes of every sub involved (compute locally; never raw subs), the tenant log event time and `connection`, the app `appVersion` and platform, and the Loki or API log lines above.

## Old app versions

Builds that have not applied the passwordless OTA still use Auth0 Universal Login with the password and cannot send or enter a code, so they never trigger (a). They can still be signed in as a user that (a) or (b) already linked: an old build signing in with the password returns the primary's sub, since the primary is the database user in the usual case (inferred from how linking works, not tested). They never show the wrong-account screen, so they never run (b). The password stays valid for linked database accounts for exactly this reason.

## Sources

- `auth0/actions/meetingmaker/link-passwordless-identity.js`
- `auth0/actions/meetingmaker/identities-claim.js`
- `auth0/README.md`
- `docs/PROD_AUTH0_ROLLOUT.md`
- `docs/AUTH_LINKING_TESTS.md`
- `app/services/auth/ownerLogic.ts` (`decideForeignLink`, `decideOwnership`)
- `app/services/auth/useAuth0Wrapper.ts` (foreign-link branch, `Foreign session on an owned device`)
- `app/services/auth/linkForeignIdentity.ts`
- `app/services/auth/accountMethodsLogic.ts`
- `app/services/api/index.ts` (`linkIdentity`)
- `app/db/rewriteOwnerUid.ts`
- `app/components/AccountMethodRow.tsx`
- `app/i18n/en.ts` (`settingsScreen`)
- `api:src/routes/auth0.ts` (`POST /auth0/link`)
- `api:src/services/identitySweep.ts`
- `api:src/middleware/auth.ts` (`verifyIdToken`)
- `docs/superpowers/specs/2026-09-12-passwordless-login-design.md` (history only; code wins)
- `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md` (history only; code wins)
