# "I never got the code" / "the email with my code doesn't arrive"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or a code into a ticket, a Loki query or a log. Compute the hash locally ([tools](../reference/tools.md#hash-an-auth0-sub-into-the-log-userid)). Examples here are fake (`user@example.com`).

## Symptoms

- "I tapped Send Code and nothing came."
- "The code never arrives" after "Resend code".
- "It said it couldn't reach the sign-in service, then nothing."
- "The app asked me to verify my email, I sent the code, nothing came."

## Diagnose

### 0. Which code does the user mean?

Two different mails, sent by two different systems. Treat them as two problems.

| | Login code | Verification code |
| --- | --- | --- |
| Screen | The **Login** screen: "Continue with Email", then "We sent a code to {{email}}" with the field "6-digit code". The user is signed out. | The **modal** titled "Please review and verify your email address", then its code step. The user is signed in with a password. |
| Sent by | Auth0's own email provider (SMTP) | Our API, through Postmark (stream `outbound`, tag `email-verify`) |
| Where to look | Auth0 tenant log (`cls`, `fcls`) | Postmark Activity and the API log |
| Subject | Set by the Auth0 email template (not in our repo) | `<code> is your RecoverySky verification code` |
| Resend cooldown | 30 s | 60 s |

Ask: "Were you signed in already, or signing in?" If the user is on the wrong-account screen ("Send code to {{email}}"), it is a **login code** (same Auth0 mail). See [sign-in methods](../reference/sign-in-methods.md#email-code-continue-with-email) and [email verification](../reference/email-verification.md).

### A. Login code

1. **Auth0 dashboard, Monitoring, Logs.** Search around the time the user tapped Send. Look for `cls` (code sent) or `fcls` (code send failed) on connection `email`.
   - `cls` present: Auth0 handed the mail to its mailer. Go to Cause A1 or A2 (delivery).
   - `fcls` present: read the description. Go to Cause A3.
   - Neither: the request never reached Auth0. Go to step 2.
2. **Loki, the app side.** Compute the hash for the user. If you do not know the sub (the user never signed in), you cannot hash it; use the `deviceId` or ask the user for the approximate time and look for `Send code failed` lines near it.
   ```
   {service_name="recoverysky-app", module="LoginScreen"} |= "Send code failed"
   {service_name="recoverysky-app", module="LoginScreen"} |= "Auth error displayed to user"
   {service_name="recoverysky-app", module="useAuth0Wrapper"} |= "Sending passwordless code"
   ```
   `Send code failed` carries `key` (the classification: `networkError`, `sendRateLimited`, `passwordlessNotEnabled`, `unclassified`); it never carries the address. `Auth error displayed to user` carries the exact text shown.
3. Read the `key` / the text:
   - "We couldn't reach the sign-in service. Check your connection and try again." with `key=networkError`: Cause A4 (and see the old-build note if `cls` exists).
   - Same text with `key=passwordlessNotEnabled`, plus ERROR `Passwordless OTP grant missing on the Auth0 application — see spec 1 §3.2`: Cause A5.
   - "We've sent several codes to that address recently. Please wait before requesting another." with `key=sendRateLimited`: Cause A6.
4. **Is the address right?** The user types it; there is no "no such account" check and no format error beyond the button being disabled. In the Auth0 dashboard, search the address the user says they typed. The code step shows the address masked (`u***@example.com`); ask the user to read the masked form back to you.

### B. Verification code

1. **Loki, app side.**
   ```
   {service_name="recoverysky-app", module="Api"} |= "Email verification start failed" | userId="<hash>"
   {service_name="recoverysky-app", module="VerifyEmailGate"} | userId="<hash>"
   ```
   `Email verification start failed` carries `code` and `status`. Meanings are in [email verification](../reference/email-verification.md#every-error-api-to-app-copy). Key cases: `inactive_recipient` (Cause B2), `unavailable` (Cause B3), `rate_limited` (Cause B4), `email_in_use` (see [mistyped-email-locked-out](mistyped-email-locked-out.md)).
2. **No failure line and the user was shown "We sent a code to {{email}}":** the API said `sent: true`. Go to the API log.
3. **Loki, API side** (`{service_name="app_api"}`, strip ANSI colour codes). Search for the user's hash:
   ```
   {service_name="app_api"} |= "POST /auth0/email/start" |= "<hash>"
   ```
   - `POST /auth0/email/start: code sent`: our API handed it to Postmark. Go to step 4.
   - `POST /auth0/email/start: provider refuses that recipient`: Cause B2.
   - `POST /auth0/email/start: send failed` (ERROR, `kind`): Cause B3.
   - `POST /auth0/email/start: mailer not configured` (ERROR): Cause B3 (configuration; escalate).
   - `POST /auth0/email/start: address belongs to another account`: `email_in_use`, not a delivery problem.
   - `Per-minute rate limit exceeded` with `bucket=auth0-email-start`: Cause B4.
4. **Postmark Activity.** Server shared with another RecoverySky product. Filter stream `outbound`, tag `email-verify`, search the recipient and the time. Subject `<code> is your RecoverySky verification code`. The code is visible there: do not copy it.
   - Delivered: Cause B1 (user's side: spam folder, wrong mailbox, typo that is a real mailbox).
   - Bounced / not delivered: Cause B2. **The bounce is invisible to the app and the user** (the bounce webhook ignores `email-verify` mail), so only Postmark shows it.
   - No message at all although the API logged `code sent`: escalate.

## Causes

### A1. Login code delivered but not seen (spam, wrong mailbox)
`cls` in the tenant log, nothing wrong in Loki. The mail is in a spam or promotions folder, or the user typed a different address (a typo that happens to be a real mailbox, or a plausible different address).

### A2. Login code delayed
`cls` present and the user waited. Auth0's own send limit is stricter than the app's 30 s cooldown, so repeated Resend taps can make later mails slower or refused. Only the **latest** code matters; an earlier one may be dead.

### A3. Auth0 could not send the login code (`fcls`)
Read the log description. Typical: the recipient is refused by the mail provider, or the tenant's email provider is not configured or is down (the dev tenant has no email provider; prod does).

### A4. The app timed out before Auth0 answered
`/passwordless/start` answers only after Auth0 hands the mail to its mailer. The SDK timeout is 30 s since 2026-09-30; older builds aborted at 10 s and showed "We couldn't reach the sign-in service" while the code was already on its way (`cls` in the log). Or the device really has no route to the sign-in service (dead Wi-Fi, captive portal, VPN).

### A5. Passwordless grant missing on the Auth0 application
Tenant misconfiguration. The user sees the generic network text and can do nothing.

### A6. Rate limited
Auth0 refused further sends to that address. The user sees the "sent several codes" copy.

### B1. Verification code delivered but not seen
Postmark shows delivered. Same as A1. Also: the user changed the address on the change step and is checking the old mailbox.

### B2. Recipient inactive (hard bounce or spam complaint) or address refused
Postmark refused it (406 `inactive_recipient`) or the mail bounced later. The app shows "We can't deliver email to that address. Try a different one." for an `inactive_recipient` and also for `invalid_email` (the API's own format check), so that copy alone does not prove a bounce. The API log line `provider refuses that recipient` is what separates them.

### B3. Our mail send failed
API ERROR `send failed` or `mailer not configured`. The user sees "We couldn't reach the server. Please try again." The showing still counts toward the daily skip.

### B4. Rate limited
HTTP 429 (no `code` on the wire; the app labels it `rate_limited`). The user sees "Too many requests. Wait a minute and try again." Limits are per user and **per API replica**: about 3 sends a minute and 10 an hour per replica.

## Solution

**A1, B1:** have the user check spam and promotions and search for "RecoverySky" (verification) or the sign-in mail. Confirm the exact address with the user in the masked form. If it was a typo, go back and send a new code (login: "Wrong email? Go back"; verification: "Wrong email? Go back", which returns to the change step).

**A2, A6:** ask the user to wait a few minutes, tap Resend **once**, and use only the newest mail. Do not tell them to keep tapping.

**A3:**
1. Open the `fcls` event and read the description.
2. If it is a refused recipient, ask the user for another address, or let them sign in by another method (Google, Apple, or "Can't get a code? Sign in with your password" if they have a password account).
3. If it points at the tenant's email provider, check the provider in the Auth0 dashboard (Branding, Email Provider) and escalate.

**A4:** if `cls` exists in the tenant log for that time, the mail was sent: tell the user to wait and check their inbox, then enter the code (on a build older than 2026-09-30 they may have to retry the screen). If there is no `cls`, check the device's connection and whether a VPN is on; the user can retry on mobile data.

**A5:** escalate. Fix is in the Auth0 application's grant settings.

**B2:**
1. Postmark, Activity or the stream's Suppressions: confirm the address is inactive.
2. If the address is the user's real, correct address, you may reactivate it under Suppressions (operational, not described in our code). If it is a typo, do not reactivate.
3. Otherwise the user enters a different address on the change step.

**B3:** retry in a minute. If it repeats, escalate (mailer config, Postmark outage).

**B4:** wait one minute, then tap Resend once. If a 429 appears on the first tap, the user (or a loop) has hit the limiter on that replica; wait longer.

**Old app versions.** Builds that have not applied the passwordless OTA have no Continue with Email and no verify screen; they use a password through Auth0's page. A "no code" ticket from such a build means the user is not on the version this doc describes; ask for the app version (Loki `appVersion`) and point them to the update, or to [forgot-password-or-old-app](forgot-password-or-old-app.md).

## Escalate

Hand to engineering when: `fcls` points at the tenant's email provider, `unauthorized_client` (A5), `mailer not configured`, repeated `send failed`, or `code sent` in the API log with no message in Postmark. Attach: the user's hash, `appVersion`, platform, timestamps (with timezone), the Auth0 event code and time for login codes, the `traceId` from `Api` `API request` lines ([Tempo](../reference/tools.md#tempo)), and the API `requestId`. Never attach the address or the code.

## Reply

See [../replies/no-code-email.md](../replies/no-code-email.md). Expected variants (Task 6 should match):

- `A1-B1-delivered-not-seen`: check spam, confirm the address.
- `A2-A6-wait-and-resend-once`: slow or limited; use newest mail.
- `A3-B2-cannot-deliver`: try a different address or another sign-in method.
- `A4-connection`: connection problem or timeout.
- `B3-B4-try-again-shortly`: temporary problem on our side or too many requests.

## Sources

- `app/screens/LoginScreen.tsx`
- `app/screens/WrongAccountScreen.tsx`
- `app/services/auth/useAuth0Wrapper.ts`
- `app/services/auth/authErrorLogic.ts`
- `app/components/VerifyEmailGate.tsx`
- `app/services/api/emailVerifyProblem.ts`
- `app/i18n/en.ts` (`loginScreen`, `verifyEmailScreen`)
- `docs/support/reference/tools.md`, `sign-in-methods.md`, `email-verification.md`
- `api:src/routes/auth0Email.ts`
- `api:src/services/email.ts`
- `api:src/routes/reports.ts` (bounce webhook ignores `email-verify`)
