# Email verification

The verify-email screen asks legacy **password** users to confirm that the address on their account is one they can read. RecoverySky now signs people in with a code sent to that address, so a typo or a dead mailbox on an old password account locks the owner out. Verification catches that while the user can still sign in with the password.

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or a verification code into a ticket, a Loki query or a log. Examples here are fake (`user@example.com`, `typo@exmaple.com`, `auth0|65f0000000000000000000aa`).

The verification code mail is sent by **our API through Postmark**. Login codes ("Continue with Email") are a different mail, sent by Auth0's own email provider; see [sign-in methods](sign-in-methods.md#email-code-continue-with-email) and [tools: Postmark](tools.md#postmark-activity).

## Who is asked, and who never is

`needsEmailVerification` (`app/services/auth/emailVerifyLogic.ts`). **All four** must hold:

1. The sub starts with `auth0|` (a password-type account).
2. This install has no local "verified" record for that sub.
3. `loginMethod` is undefined: a password sign-in, or a session restored by an old build that recorded none.
4. The ID token's `email_verified` claim is not `true`. A missing claim counts as unverified.

Never asked:

- Email-code, Google and Apple sessions, even when they land in a linked `auth0|` account (their `loginMethod` is set).
- Accounts whose sub does not start with `auth0|`.
- Accounts already verified on this install. The local record wins over the claim, because a cold start can restore a cached ID token that still says unverified.

Dashboard caution: a password account that later signs in by code probably still shows `email_verified: false`, because the token keeps the password identity's flag. That does not mean the app will ask: the gate looks at `loginMethod` first.

## Skips: six, one per local day, then mandatory

- `MAX_SKIPS` is 6. Showings 1 to 6 are **skippable**; the **7th showing is mandatory**.
- At most **one showing per local calendar day**. If it was already shown today it stays hidden. So the mandatory screen arrives on the seventh day of use at the earliest.
- Mandatory **latches**: from the seventh showing on, it shows on every check whatever the day.
- A showing counts when the screen is **displayed**, not when "Not now" is tapped, so killing the app does not dodge it.
- The day test is "not equal to today", not "before today", so setting the clock backwards does not hide the screen.
- Skippable footer: "Verification is required. Skips left: {{count}}" (6 on the first showing, 1 on the sixth) and a "Not now" link. On Android, Back acts as "Not now" on a skippable screen and does nothing on a mandatory one.
- Mandatory footer (no skip): "Email verification is now required to keep using your account. Need help? Contact support@recoverysky.app", plus a "Contact support" link that opens `mailto:support@recoverysky.app`.

The count lives in MMKV (`emailVerify.<hash of sub>`, per install and per account) as `{ count, lastDay, verified }`. **Delete User Data and a reinstall reset it**: the user gets six more skips and the local "verified" record is gone, so the ID-token claim decides again.

## When the screen is hidden and not counted

`verifyGateBlocked` (wired in `app/components/VerifyEmailGate.tsx`). While any of these hold, the screen does not appear and **no showing is counted**, so a user can be "mandatory" and still not see it:

| Blocked by | Why |
| --- | --- |
| Not authenticated | No account. |
| Anonymous (guest) session | Not a password account. |
| Onboarding not completed | Never interrupt setup. |
| Offline | The API cannot send a code. |
| Maintenance mode | Same. |
| Outage mode | Same. |
| An attendance timer is running | Never interrupt a meeting. |
| Device attestation degraded (the "Connecting…" banner) | API calls are failing. |

It also waits while an announcement is up (they share one overlay lock) and retries when that releases. A **mandatory** screen that is already up closes when one of the blocks begins and returns when it clears; a skippable one stays, because it has "Not now".

It is checked on mount, every time the app comes to the foreground, and whenever its inputs change (after a password sign-in, at the end of onboarding, when back online). If a user says "I am not being asked", check this table first.

## The three steps

Screen steps: `review`, `change`, `code`.

1. **Review.** Title "Please review and verify your email address". Body "RecoverySky now signs you in with a code sent to your email. Check that this is an address you can read." The account address is shown in full. Button "Send code"; link "Not my email? Change it".
2. **Change.** One address field. Sending goes to the new address and then to the code step.
3. **Code.** Heading "We sent a code to {{email}}". As of commit `42f989f` (2026-10-02) the address shown is the **full** address the code went to; before that it was masked (`j***@...`), which hid the typo the screen exists to catch. Login and the wrong-account screen still mask the address. Six digits, verifies automatically at the sixth digit. "Resend code" returns after a 60 s cooldown ("Resend in {{seconds}}s" while waiting). "Wrong email? Go back" returns to the change step.

Every step has a footer link "Why is verification required?" that opens `https://www.recoverysky.org/post/8/recoverysky-required-email-verification`.

A **send** failure keeps the user on the current step and shows the message. Only a **verify** failure can move the step (table below). After any verify failure the typed code is cleared.

## API routes and limits

Both routes need a signed-in user's bearer (not an API key) and answer 400 `not_password_account` to any sub that does not start with `auth0|`.

| Route | Request | Success |
| --- | --- | --- |
| `POST /auth0/email/start` | `{ email }` (trimmed, valid, max 254) | 200 `{ "sent": true }` |
| `POST /auth0/email/verify` | `{ email, code }` (six digits) | 200 `{ "email": "<normalised>" }` |

Code properties (`api:src/services/emailVerifyCode.ts`):

- Six digits, valid for **10 minutes**. The mail says "It expires in 10 minutes."
- **Five wrong tries** kill the code (per replica: with several API replicas on a shared store the real bound is about five times the replica count). A right code sent with a different address counts as a wrong try.
- **One live code per user** (per sub, not per address). A new `start` replaces the old one and resets the counter, so only the latest mail works.
- The code is stored hashed in Redis, or in process memory if `REDIS_URL` is unset. With memory storage and several API replicas, a code started on one replica fails with `code_expired` on another.
- Addresses are trimmed and lower-cased.
- Before sending (and again before applying), the API asks Auth0 whether **any other user** holds the address, across **all** connections (a Google-only account counts). If the lookup fails, the answer is 503, never "go ahead".

Rate limits (per user, **per API replica**, so "about" these numbers): `start` 3 per minute, 10 per hour, 1 concurrent; `verify` 10 per minute, 40 per hour, 1 concurrent. There is no per-IP or per-address limit. The 429 body is `{ error: "TooManyRequests", message, retryAfter }` with `Retry-After`; it has **no `code` field**.

## Every error: API to app copy

The app maps an API answer to one of eight problems (`app/services/api/emailVerifyProblem.ts`) and shows fixed copy (`verifyEmailScreen` in `app/i18n/en.ts`). Find the app's side in Loki as `Email verification start failed` / `Email verification confirm failed` (module `Api`) with the attribute `code` (the app's problem) and `status` (HTTP). `code` is structured metadata: filter with `| code="email_in_use"`.

| API route and HTTP | API `code` | App problem (`code` in Loki) | Exact app copy | Step after (verify only) | What it means |
| --- | --- | --- | --- | --- | --- |
| start/verify, 400 | `not_password_account` | `not_password_account` | "This account doesn't need email verification." | stays | Sub is not `auth0\|`. Should not happen from the gate (it only asks `auth0\|` accounts); suggests a stale session or a mixed-up account. |
| start, 400 | `invalid_email` | `inactive_recipient` | "We can't deliver email to that address. Try a different one." | stays | The API's own stricter email check refused the address. **Shows the "can't deliver" copy**, so this copy does not prove a Postmark bounce. |
| start, 400 | `inactive_recipient` | `inactive_recipient` | same | stays | Postmark refused the recipient as inactive (hard bounce or spam complaint). The stored code is deleted. |
| start/verify, 409 | `email_in_use` | `email_in_use` | "This email is already in use. Contact support@recoverysky.app." | **change** | Another Auth0 user, on any connection, holds that address. No auto-merge. See [the lock-out](#the-mistyped-address-lock-out-d5). At `verify` the code is kept. |
| verify, 400 | `invalid_code` | `invalid_code` | "That code isn't right. Check it and try again." | stays | Wrong code, or the right code with a different address (counts toward the five). The API also answers `invalid_code` (text "Enter the six-digit code", not counted) for a malformed code or address, but the current app never sends one. |
| verify, 400 | `code_expired` | `code_expired` | "That code has expired. Send a new one." | **review** | **Ambiguous.** Any of: older than 10 minutes; never requested; already used; locked out after five wrong tries and cleared; the earlier send failed; or the request reached another API replica that has no copy (memory store). |
| verify, 400 | `too_many_attempts` | `too_many_attempts` | "Too many wrong codes. Send a new one." | **review** | The fifth wrong try; the code is deleted. API WARN `POST /auth0/email/verify: too many wrong codes`. |
| start or verify, **429** | none | `rate_limited` (invented by the app from the status) | "Too many requests. Wait a minute and try again." | stays | Per-user limiter. The API never sends a `rate_limited` code; do not search for one. On a `start` refusal the Resend cooldown restarts; a 429 on `verify` only clears the typed code. |
| start/verify, 503 | `unavailable` | `unavailable` | "We couldn't reach the server. Please try again." | stays | Mailer not configured; address lookup failed; mail send failed; Redis or Auth0 token trouble; verify failed unexpectedly. The showing still counts for the day. |
| verify, **502** | `update_failed` | `unavailable` (not recognised) | same as above | stays | Auth0 refused the profile update. The code is **kept** so a retry needs no new mail. Only the HTTP status is logged, not Auth0's reason. |
| any other 5xx, no connection, unrecognised body, or a 200 without a string `email` | | `unavailable` | same | stays | The app also logs WARN `Invalid email verification response format` for the last case. |

Two honesty notes for diagnosis:

- `code_expired` cannot tell you *why*. Ask the user whether they asked for a new code twice (the first one died), took longer than ten minutes, or typed five wrong codes. The fix is always "send a new one"; if it repeats immediately, suspect a multi-replica memory store (escalate).
- `invalid_email` and `inactive_recipient` look identical to the user. The API log tells them apart: `POST /auth0/email/start: provider refuses that recipient` means Postmark; its absence means the address failed the format check.

### API log lines (`{service_name="app_api"}`, strip ANSI colour codes)

All ids are hashed. The address, the code and Auth0's error text are never logged.

| Level | Message | Attributes |
| --- | --- | --- |
| ERROR | `POST /auth0/email/start: mailer not configured` | `userId` |
| ERROR | `POST /auth0/email/start: address lookup failed` | `userId` |
| INFO | `POST /auth0/email/start: address belongs to another account` | `userId` |
| INFO | `POST /auth0/email/start: provider refuses that recipient` | `userId` |
| ERROR | `POST /auth0/email/start: send failed` | `userId`, `kind` |
| INFO | `POST /auth0/email/start: code sent` | `userId` |
| ERROR | `POST /auth0/email/start: failed` | `userId`, `errorName` |
| WARN | `POST /auth0/email/verify: too many wrong codes` | `userId` |
| ERROR | `POST /auth0/email/verify: address lookup failed` | `userId` |
| INFO | `POST /auth0/email/verify: address belongs to another account` | `userId` |
| ERROR | `POST /auth0/email/verify: Auth0 refused the update` | `userId`, `status` |
| INFO | `POST /auth0/email/verify: email verified` | `userId`, `changed` |
| ERROR | `POST /auth0/email/verify: failed` | `userId`, `errorName` |
| WARN | `Per-minute rate limit exceeded`, `Per-hour rate limit exceeded`, `Concurrency limit exceeded` | `bucket` is `auth0-email-start` or `auth0-email-verify`; `userKey` is `user:<hash>` |

A wrong code (`invalid_code`) writes **no** log line on the API. If Auth0 refused the update, look at the tenant log at the same time for the reason (the API logs only the status).

## App log lines (module `VerifyEmailGate` unless noted)

| Level | Message | Attributes |
| --- | --- | --- |
| INFO | `Verify email shown` | `mode` (skippable or mandatory), `showing` (1 to 7) |
| INFO | `Email verified` | `changed` |
| WARN | `Credential renewal after verify failed` | `code` |
| INFO / WARN (module `Api`) | `Starting email verification`, `Email verification start failed`, `Confirming email verification`, `Email verification confirm failed` | failures carry `code`, `status` |

Umami events: `verify_email_shown` (`mode`), `verify_email_done` (`changed`), `verify_email_skipped`.

## What a successful verify does

1. The API issues one Management API `PATCH /users/{sub}`:
   - address changed: `email`, `email_verified: true`, `verify_email: false`, `connection: "Username-Password-Authentication"`;
   - address unchanged: `email_verified: true` only.

   `verify_email: false` stops Auth0 sending its own mail. The sub does not change, so **no server rows and no RevenueCat customer move**. The code is deleted; API INFO `POST /auth0/email/verify: email verified` (`changed`).
2. The app writes the local record `verified: true` **first** (stops a stale cached token re-asking), then sets `emailVerified`, `authEmail` (and `ownerEmail`, if this account is the device owner, so the login screen offers the working address) and updates the RevenueCat `$email`.
3. On a native build it fire-and-forgets a credential renewal so the cached ID token carries the new address. Without it, the next cold start would write the old (typo) address back over `authEmail`. A failure is only a WARN; the local record still prevents a re-ask.
4. The modal closes.

Afterwards, a code sign-in with the corrected address links into the password account through the [automatic link](account-linking.md#path-a-automatic-linking-on-an-email-code-login), so the same sub and the same data.

Verifying on phone A likely does not stop phone B asking until B's next token refresh carries `email_verified: true` (B has no local record; its skip count is independent).

## Postmark

The verification mail comes from `POSTMARK_FROM` (default `RecoverySky <noreply@recoverysky.org>`), message stream `outbound`, tag `email-verify`, subject `<code> is your RecoverySky verification code`. The live code is in the subject and the body, so Postmark Activity shows it. Do not copy it anywhere. The Postmark server is shared with another RecoverySky product's mail.

- Reports use tag `attendance-report`. The report unsubscribe list is **not** consulted for code mail (account-critical).
- The Postmark bounce webhook answers "not a report" for mail with this tag and ignores it. **A bounce of a code mail is invisible to the user and to the app**: the API said `sent: true` and the user just never gets the code. Check Postmark Activity for the recipient and the stream.
- Postmark error 406 (inactive recipient) is the one failure the API detects and surfaces (`inactive_recipient`). Spam-foldered mail and typo addresses that are real mailboxes cannot be detected.

See [tools: Postmark activity](tools.md#postmark-activity).

## The mistyped-address lock-out (D5)

**Pending Jenova's decision on the in-app path.** Decision 1 of the email-verification device pass is still open; the in-app behaviour below may change.

Situation: the account carries a mistyped address (for example `typo@exmaple.com`). The user cannot receive a code, so the screen is their only way to fix it. If they type the corrected address and it already belongs to another Auth0 user, the API answers `email_in_use`: "This email is already in use. Contact support@recoverysky.app." The screen moves back to the change step. On the **mandatory** screen there is no skip, so this is a lock-out. The app never auto-merges; `email_in_use` also reveals that the address has an account (a known trade-off).

Current support fix: **correct the address by hand in the Auth0 dashboard.**

1. Find the user in the dashboard (User Management, Users) by the old address, and check the `user_id` starts with `auth0|`. Auth0 cannot change a Google or Apple address, and the routes refuse non-`auth0|` subs.
2. Search the corrected address too. Usually the stray empty `email|` account the user created by typing the real address at Login holds it. Our API refuses an address any other user holds (`email_in_use`), but Auth0 documents uniqueness per connection only, so a support PATCH on the password account should succeed with the stray in place (confirm once on `bad-bitch-tenant` before first use). The default is to **leave the stray**: at its next code login the Link Action links it into the oldest linkable account on the address, which is the corrected password account when no older Google or Apple account shares the address. A Google or Apple account with data on the address needs a decision first, and another password account on it is a collision: escalate. Never delete or edit account A because B asked.
3. Edit the email on the user (or `PATCH /api/v2/users/{sub}`, see [tools](tools.md#update-an-email-or-set-email_verified-password-users-only)). Set `email_verified: true` (only once the user has shown they can read that inbox) and `verify_email: false` so Auth0 does not send a verification mail. Keep the before-state.
4. The phone still needs a fresh token, and the mandatory screen has no sign-out. The device steps, in order (in-app verify when no other user holds the address, wait for a token renewal, then the hedged airplane-mode and reinstall routes) and the Login-screen caveat (the "Send code to" button still offers the typo) are in [mistyped-email-locked-out](../problems/mistyped-email-locked-out.md#device-steps-after-the-fix-causes-1-and-2).

Related: a user who types the real address on the Login screen instead of verifying gets a new, empty account. That is a different ticket; see the [problems index](../README.md#symptom-to-problem-doc).

## Old app versions

Builds that have not applied the OTA do not contain the gate, so they never show this screen and never call these routes. Old sessions restored by a build that recorded no `loginMethod` count as asked once the new JS runs.

## Sources

- `app/services/auth/emailVerifyLogic.ts`
- `app/services/auth/emailVerifyState.ts`
- `app/services/api/emailVerifyProblem.ts`
- `app/services/api/index.ts` (`startEmailVerification`, `confirmEmailVerification`)
- `app/components/VerifyEmailGate.tsx`
- `app/components/VerifyEmailView.tsx`
- `app/utils/overlayGate.ts`
- `app/i18n/en.ts` (`verifyEmailScreen`, `loginScreen` code step)
- commit `42f989f` (full address on the code step)
- `api:src/routes/auth0Email.ts`
- `api:src/services/emailVerifyCode.ts`
- `api:src/services/email.ts`
- `api:src/middleware/rate-limit.ts`
- `api:src/routes/reports.ts` (confirmation webhook ignoring `email-verify`)
- `docs/superpowers/specs/2026-09-30-legacy-email-verification-design.md` (history only; code wins)
