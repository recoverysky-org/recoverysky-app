# "It says the code is wrong or expired"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or a code into a ticket, a Loki query or a log. Examples are fake.

## Symptoms

- "That code didn't match. Check the email and try again." (login)
- "That code has expired. Tap Resend to get a new one." (login)
- "Too many attempts. Please wait a few minutes and try again." (login)
- "That code isn't right. Check it and try again." (verify-email screen)
- "That code has expired. Send a new one." (verify-email screen)
- "Too many wrong codes. Send a new one." (verify-email screen)

Two systems, two sets of messages. The copy tells you which: "Tap Resend" is the **login** screen (Auth0), "Send a new one" is the **verify-email** modal (our API). See [no-code-email](no-code-email.md#0-which-code-does-the-user-mean).

## Diagnose

### Login code (Auth0)

1. **Loki:** what exactly was shown?
   ```
   {service_name="recoverysky-app", module="LoginScreen"} |= "Auth error displayed to user"
   {service_name="recoverysky-app", module="LoginScreen"} |= "Verify code failed"
   ```
   `Verify code failed` carries `key`: `wrongCode`, `codeExpired`, `tooManyAttempts`, `networkError`, `unclassified`. (On the wrong-account screen the module is `WrongAccountScreen`; it does not log `Auth error displayed to user`.) Add `| userId="<hash>"` if the user was signed in on this install before; a signed-out user has no `userId`, so use `deviceId` or the time window.
2. **Auth0 dashboard, Monitoring, Logs**, same time. A successful code login is `sepft` (connection `email`) followed by `s`; a refresh is `sertft`; a code send is `cls`. No failed code-login event has been observed, so do not look for a specific code: filter the tenant log to the user (or `connection=email`) around the time and read any event whose type starts with `f`, using its description text. The repo script's `fcoa`/`feacft` labels are unverified guesses (`fcoa` is likely Auth0's cross-origin-auth failure). Record the real code after reproducing one wrong code on the dev tenant. Compare with `cls` (code sent) to see how many codes were sent and when.
3. Read the `key`:
   - `wrongCode`: Cause 1 or 2.
   - `codeExpired`: Cause 2 or 3.
   - `tooManyAttempts`: Cause 4.

Ambiguity: Auth0 reports "wrong" and "expired" the same way (`invalid_grant`); the app calls it expired when the description contains "expir". The match is deliberately loose, so an "expired" message can really be a wrong code.

### Verification code (our API)

1. **Loki, app side:**
   ```
   {service_name="recoverysky-app", module="Api"} |= "Email verification confirm failed" | userId="<hash>"
   ```
   Read `code` and `status`: `invalid_code`, `code_expired`, `too_many_attempts`, `rate_limited` (HTTP 429), `unavailable`, `email_in_use`.
2. **Loki, API side** (`{service_name="app_api"}`, strip ANSI):
   ```
   {service_name="app_api"} |= "POST /auth0/email/verify" |= "<hash>"
   ```
   - `POST /auth0/email/verify: too many wrong codes` (WARN): the fifth wrong try (Cause 4).
   - `Per-minute rate limit exceeded`, `Per-hour rate limit exceeded` or `Concurrency limit exceeded` (search `limit exceeded`) with `bucket=auth0-email-verify`: Cause 5. A double-tapped Verify gives a concurrency 429.
   - `POST /auth0/email/verify: Auth0 refused the update` (ERROR, `status`): Cause 6.
   - **A wrong code writes no API log line at all**, so absence of a line is consistent with `invalid_code`.
   - `POST /auth0/email/start: code sent` shortly before shows how many codes were requested.
3. Count the `Starting email verification` lines for the user in the last 15 minutes: more than one means earlier codes were replaced.

## Causes

### 1. Typed wrong
Login: `wrongCode`. Verification: `invalid_code`. Also true for verification when the right code is sent with a **different address** than the one the code was issued for (the app sends the address in the target field; counts as a wrong try).

### 2. An older code
Both systems accept only the **latest** code. Verification: one live code per user; a new Start replaces the old code and resets the counter, so the previous mail is dead. Login: Auth0's behaviour for several codes is a tenant setting; assume only the newest works. The user typed the first mail's code after tapping Resend.

### 3. Genuinely expired
Login: lifetime is set on the Auth0 tenant (the design spec says 180 s; verify in the tenant's passwordless settings). Verification: 10 minutes.

### 4. Too many attempts
Login: Auth0 brute-force protection (`too_many_attempts`); the user is sent back to the email step. Verification: five wrong tries kill the code (per API replica; with several replicas the real bound is about five times the replica count).

### 5. Rate limited
Verification: 429, no `code` on the wire; the app labels it `rate_limited` and shows "Too many requests. Wait a minute and try again." Limits are per user and per API replica: about 10 verifies a minute and 40 an hour. Login: `too_many_requests` or HTTP 429 shows "We've sent several codes to that address recently. Please wait before requesting another." and keeps the typed code.

### 6. API `code_expired` that is not about time (R-C)
`code_expired` is the catch-all. It is returned when **any** of these is true: older than 10 minutes; no code was ever requested for that user; the code was already used; five wrong tries cleared it; the earlier send failed; or the request reached another API replica that has no copy of the code (when the code store is process memory because `REDIS_URL` is unset). Ask the user: did you tap Send twice, wait more than ten minutes, type five wrong codes, or already succeed once? If none apply and a fresh code fails at once, suspect the multi-replica memory store. Also in this group: `update_failed` (HTTP 502) shows as "We couldn't reach the server. Please try again." with the code **kept**, and `unavailable` (503) the same.

## Solution

1. **Causes 1 to 3 (both systems):** ask the user to request **one** new code, wait for the mail, and enter the newest code within the lifetime. Login: tap "Resend code" (wait out the 30 s countdown). Verification: after `code_expired` or `too_many_attempts` the screen returns to the review step; tap "Send code" (60 s resend cooldown on the code step). Auto-submit fires at the sixth digit, so paste or type slowly and check the digits.
2. **Cause 4:** login: wait a few minutes (the app says so) before asking for a new code. Verification: tap "Send code" for a fresh one. If Auth0 locked the user out (`too_many_attempts` repeatedly), wait; no support action clears it.
3. **Cause 5:** wait a minute (verification) or a few minutes (login). Tell the user to tap once.
4. **Cause 6:** the fix is always "send a new one". If a fresh code fails immediately more than once, escalate with the details below (suspect Redis / multi-replica).
5. For `update_failed` on verify: the code is kept server-side, but the app clears the field, so the user must re-enter the **same** code from the same mail and it will work (no new mail needed). For `unavailable`, retry once. If it repeats, check the Auth0 tenant log for the update reason at that time and escalate.
6. If the user's mail is slow so that the first code expires before they see it, see [no-code-email](no-code-email.md).

**Old app versions.** Builds that have not applied the passwordless OTA have no code entry; a "code" complaint from such a build is not this problem. Ask for `appVersion`.

## Escalate

When a fresh verification code fails immediately more than once with `code_expired` and the user did nothing unusual, when `update_failed` or `unavailable` repeats, or when a tenant log `f*` event for the login has a description that is not wrong/expired/limit. Attach: hash, `appVersion`, platform, timestamps (timezone), the app log `code` and `status`, the `traceId` from `Api` `API request` lines, the API `requestId`, the Auth0 event type and time. Never attach the address or the code.

## Reply

See [../replies/code-rejected-or-expired.md](../replies/code-rejected-or-expired.md). Expected variants:

- `wrong-or-old-code`: Causes 1 and 2; use the newest email.
- `expired`: Cause 3; request a new code.
- `too-many-tries`: Cause 4.
- `too-many-requests`: Cause 5.
- `keeps-failing`: Cause 6; ask for details and hand to engineering.

## Sources

- `app/services/auth/authErrorLogic.ts`
- `app/screens/LoginScreen.tsx`
- `app/screens/WrongAccountScreen.tsx`
- `app/services/api/emailVerifyProblem.ts`
- `app/components/VerifyEmailGate.tsx`
- `app/i18n/en.ts` (`loginScreen`, `verifyEmailScreen`)
- `docs/support/reference/sign-in-methods.md`, `email-verification.md`, `tools.md`
- `api:src/routes/auth0Email.ts`
- `api:src/services/emailVerifyCode.ts`
- `api:src/middleware/rate-limit.ts`
