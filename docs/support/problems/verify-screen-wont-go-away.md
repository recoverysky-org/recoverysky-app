# "It keeps asking me to verify my email and won't go away"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or a code into a ticket, a Loki query or a log. Examples are fake (`user@example.com`).

Background: [email verification](../reference/email-verification.md).

## Symptoms

The user sees a full-screen modal titled **"Please review and verify your email address"** ("RecoverySky now signs you in with a code sent to your email. Check that this is an address you can read."). They say:

- "It shows up every day / every time I open the app."
- "I verified and it still comes back."
- "I can't get past it, there is no 'Not now'." (mandatory)
- "I verified on my other phone and this one still asks."

## Diagnose

1. **Is this the verify screen?** Title above. If the text is "This device is set up for a different RecoverySky account." see [wrong-account-screen](wrong-account-screen.md).
2. **Which showing?** Skippable has the footer "Verification is required. Skips left: {{count}}" and a "Not now" link. Mandatory has "Email verification is now required to keep using your account. Need help? Contact support@recoverysky.app" and a "Contact support" link.
   ```
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Verify email shown" | userId="<hash>"
   ```
   Attributes `mode` (`skippable` or `mandatory`) and `showing` (1 to 7). One line per day while skippable; once mandatory, a line every time the screen is put up (it latches, and `showing` stays at 7), so several a day is normal.
3. **Should this user be asked at all?** All four must hold:
   1. The sub starts with `auth0|` (a password-type account; for a linked account, the primary's sub).
   2. This install has no local "verified" record for that sub.
   3. No `loginMethod` is recorded: the session came from a **password** sign-in, or was restored by an old build.
   4. The ID token's `email_verified` is not `true`.
   Look at the user in the Auth0 dashboard ([find a user](../reference/tools.md#find-a-user-by-email)): sub prefix, identities, **Email verified**.
4. **How did the user sign in on this phone?** Ask: "password in the browser page, or the code/Google/Apple button?" Only a password session is asked. Email-code, Google and Apple sessions are **never** asked, even into a linked `auth0|` account. Loki cannot tell you reliably (`Sending passwordless code` is logged while signed out, so it carries no `userId`). Use the Auth0 tenant log instead: a code login is `cls` then `sepft`/`s` with `connection=email`; a password login has a `Username-Password-Authentication` connection.
5. **Did they verify?**
   ```
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Email verified" | userId="<hash>"
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Credential renewal after verify failed" | userId="<hash>"
   {service_name="app_api"} |= "POST /auth0/email/verify: email verified" |= "<hash>"
   ```
   - API `email verified` present: the Auth0 profile was updated. Check the dashboard: **Email verified** should now be true.
   - `Email verified` in the app log but the screen returns: another install (Cause 4) or the user's token (Cause 3).
   - No `Email verified` line: the user never completed. Look at `Email verification start failed` / `confirm failed` ([email verification](../reference/email-verification.md#every-error-api-to-app-copy)); go to [code-rejected-or-expired](code-rejected-or-expired.md), [no-code-email](no-code-email.md) or [mistyped-email-locked-out](mistyped-email-locked-out.md).
6. **Does the dashboard say verified, but the phone still asks?** Compare timestamps: the phone's claim is `email_verified` from the **ID token it holds**, not from the dashboard. A cached token may be older than the change.
7. **Is it hidden and not counted right now?** The screen does not appear (and no showing is counted) while the user is offline, in maintenance or outage, onboarding is incomplete, an attendance timer is running, or the "Connecting…" banner is up ([table](../reference/email-verification.md#when-the-screen-is-hidden-and-not-counted)). A user can be "mandatory" and not see it for a while, then see it all at once.

## Causes

### 1. The user is a password user who has not verified yet (working as designed)
Six skippable showings, one per **local calendar day** (counted when displayed, not when "Not now" is tapped). The seventh showing is mandatory and **latches**: it shows on every check from then on, whatever the day. A showing is checked on mount, at each foreground, and when inputs change. So "every day" is correct; "every time I open the app" is correct once it is mandatory.

### 2. They verified, but a cached ID token still says unverified
The gate prefers this install's local "verified" record over the claim, so right after a successful verify a stale cached token does not re-ask. It can still re-ask if the local record is gone: **Delete User Data** or a reinstall wipes the record (and the skip count: six more skips), after which the claim decides again. If the dashboard shows verified and the user then signs in with the password again, the new token carries `email_verified: true` and the screen stops.

### 3. The verify succeeded but the credential renewal failed
After a successful verify the app fire-and-forgets a credential renewal so the cached ID token carries the new address and verified flag. If it fails (WARN `Credential renewal after verify failed`, attribute `code`), the local record still prevents a re-ask on this install, but the old token lingers until the next natural renewal. Settings and report addresses may revert on the next cold start (see [email-change-not-showing](email-change-not-showing.md)).

### 4. The user verified on another phone or install
The local record is per install and per account, and the skip count is independent per install. The other phone has no record and holds a token with `email_verified: false` until its next token refresh (likely; the refresh timing depends on the access token lifetime, which is a tenant setting).

### 5. Dashboard shows `email_verified: false` but the session is not a password session
Not asked: the gate looks at `loginMethod` first. If the user says they are being asked, check how they signed in (Diagnose 4). A session restored by an **old build** records no `loginMethod` and counts as a password session.

### 6. The verify itself keeps failing
Includes `not_password_account` ("This account doesn't need email verification."): the sub is not `auth0|`, which the gate should not allow; a stale session or mixed-up account. Escalate if seen.

A different problem, listed here so you recognise it: `email_in_use` (the corrected address belongs to another account: [mistyped-email-locked-out](mistyped-email-locked-out.md)), codes not arriving or failing ([no-code-email](no-code-email.md), [code-rejected-or-expired](code-rejected-or-expired.md)).

## Solution

1. **Cause 1:** the user taps "Send code", checks that the address shown is right and readable, enters the six-digit code from the mail. On the review step, if the address is wrong, "Not my email? Change it". The code step shows the full address the code went to (since commit `42f989f`, 2026-10-02; before that it was masked).
2. **Skippable, user does not want it today:** "Not now" is fine (6 times, one per day). Be honest that day 7 is mandatory.
3. **Mandatory and the user cannot get a code:** do not ask them to skip (they cannot). Use [mistyped-email-locked-out](mistyped-email-locked-out.md) (Auth0 dashboard fix) or [no-code-email](no-code-email.md).
4. **Cause 2, 3, 4 (Auth0 says verified):**
   1. Confirm **Email verified** in the Auth0 dashboard. If it is false and the address is right and readable by the user, you may set it: `PATCH /api/v2/users/{sub}` with `{ "email_verified": true }` ([tools](../reference/tools.md#update-an-email-or-set-email_verified-password-users-only)); keep the before-state; password (`auth0|`) accounts only. Only do this when you are sure the user controls the inbox.
   2. The phone needs a fresh token. On a **skippable** screen the user taps "Not now", opens Settings and signs out, then signs in again with the password (the new token carries the new claim). A code sign-in also stops the prompt, because code sessions are never asked (`needsEmailVerification` returns false for any recorded `loginMethod`); it just does not refresh the password session's claim. Use it when the corrected address already exists on the account (the automatic link joins it to the same sub and data).
   3. On the **mandatory** screen there is no sign-out: the modal covers the app and Settings is unreachable. Options, in order: (a) force-quit and reopen, once the token has renewed (the local record or a renewed claim stops the prompt; this works only if Auth0 already says verified, and the renewal timing depends on the tenant's token lifetimes); (b) airplane mode, **likely to fail**: a mandatory screen closes while the device is offline (`mustCloseShownGate`), so Settings is reachable, but only password sessions see this screen and their "Logout" opens a browser to clear the Auth0 session, which cannot load offline; closing that browser most likely aborts the logout (`Logout cancelled by user`) and the screen returns once online (not device-tested); (c) last resort, reinstall (loses unsynced local data, and Delete User Data is unreachable anyway). After any sign-out, the Login screen may offer "Send code to {{email}}" with the **old** address: the user signs in with the password or taps "Use a different email" ([mistyped-email-locked-out](mistyped-email-locked-out.md#device-steps-after-the-fix-causes-1-and-2)).
   4. Tell the user that phone A verifying does not stop phone B asking until B's token refreshes or B signs in again.
5. **Cause 5:** if the session is a code/Google/Apple session and the screen still appears, it is a bug: escalate with the hash, `appVersion`, `loginMethod` evidence and the `Verify email shown` lines.
6. **Last resort for a user stuck on a mandatory screen who cannot verify:** support can fix the address or set `email_verified` in Auth0 as above. Do **not** advise Delete User Data: it resets the skip count but also erases the device's local data, and the claim will still decide.

**Old app versions.** Builds that have not applied the OTA do not contain this screen. If a user says "an old version asked me to verify", they are on the new JS, so ask `appVersion`. A session restored by an old build counts as asked once the new JS runs.

## Escalate

When a non-password session is being asked; when the verify succeeded (API `email verified`), Auth0 says verified, and a fresh password sign-in still shows the screen; when `Credential renewal after verify failed` repeats for one user. Attach: hash, `appVersion`, platform, timestamps (timezone), the `Verify email shown` lines (`mode`, `showing`), the Auth0 **Email verified** state and sub prefix (no raw sub), the `traceId` of a recent `API request`.

## Reply

See [../replies/verify-screen-wont-go-away.md](../replies/verify-screen-wont-go-away.md). Expected variants:

- `normal-verify-now`: Cause 1; how to verify, and that skipping runs out after 6 days.
- `already-verified-sign-in-again`: Causes 2 to 4; sign out and back in.
- `mandatory-cant-verify`: Cause 6; we will fix it for you.

## Sources

- `app/services/auth/emailVerifyLogic.ts` (`needsEmailVerification`, `decideVerifyPrompt`, `verifyGateBlocked`)
- `app/services/auth/emailVerifyState.ts`
- `app/components/VerifyEmailGate.tsx`
- `app/components/VerifyEmailView.tsx`
- `app/services/auth/useAuth0Wrapper.ts` (writes `emailVerified`, `authEmail`)
- `app/i18n/en.ts` (`verifyEmailScreen`)
- `docs/support/reference/email-verification.md`, `tools.md`
- `api:src/routes/auth0Email.ts`
