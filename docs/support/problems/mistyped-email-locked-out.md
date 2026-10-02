# "I typed my email wrong and now I'm locked out" / "this email is already in use"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or a code into a ticket, a Loki query or a log. Examples here are fake (`typo@exmaple.com`, `user@example.com`, `auth0|65f0000000000000000000aa`).

Background: [email verification](../reference/email-verification.md#the-mistyped-address-lock-out-d5).

> **Pending Jenova's decision on the in-app path.** Decision 1 of the email-verification device pass is still open; the in-app behaviour may change. The support fix below (correct the address in Auth0) does not depend on that decision.

## Symptoms

- "I made an account years ago with a typo in my email. Now the app asks me to verify and I can't."
- "It says 'This email is already in use. Contact support@recoverysky.app.'" (the verify-email screen)
- "I can't get a code, the address on my account is wrong."
- On the mandatory verify screen (no "Not now"): the user has a mistyped address, cannot receive a code, and typing the corrected address says it is already in use.
- "I typed my real email on the Login screen and it made a new empty account."

## Diagnose

1. **Which screen?** The verify modal ("Please review and verify your email address") with the copy "This email is already in use. Contact support@recoverysky.app." and the step back on the change field. Or the Login screen ("Continue with Email") with an address the user never received a code for.
2. **Loki, app side:**
   ```
   {service_name="recoverysky-app", module="Api"} |= "Email verification start failed" | userId="<hash>" | code="email_in_use"
   {service_name="recoverysky-app", module="Api"} |= "Email verification confirm failed" | userId="<hash>" | code="email_in_use"
   {service_name="recoverysky-app", module="VerifyEmailGate"} |= "Verify email shown" | userId="<hash>"
   ```
   `email_in_use` (HTTP 409) means another Auth0 user, on **any** connection, holds the address the user typed. `mode=mandatory` means the user has no "Not now".
3. **Loki, API side** (`{service_name="app_api"}`, strip ANSI): `POST /auth0/email/start: address belongs to another account` or `POST /auth0/email/verify: address belongs to another account` with the user's hash.
4. **Auth0 dashboard, find the user** (as in [tools](../reference/tools.md#find-a-user-by-email)) by the **old (typo) address**:
   - `user_id` must start with `auth0|`. A Google or Apple address cannot be changed in Auth0, and the verify routes refuse non-`auth0|` accounts.
   - Note **Email verified**.
5. **Search the corrected address too.** Who holds it? Usually one of:
   - **The stray `email|` account** the user created by typing the real address at Login (an empty account): the commonest holder.
   - A Google or Apple account of theirs on that address.
   - A different person's account (rare; do not touch it).
   Note each row's `user_id` prefix, `created_at` and whether it is the one with data. The one the user actually uses (the one they sign in to with the password, or the one the device owns) is the account to keep.
6. **Check the stray holder before touching it.** Compute the stray account's hash locally from its dashboard `user_id`. Search Loki for it as `ownerId` (`Device owner adopted`, `Foreign session on an owned device`, `Device owner relinked into a linked account`). If any device owns the stray, do **not** delete it (the device would land on the wrong-account screen with only a reinstall as exit): escalate. In the dashboard read the stray's `created_at`, `last_login` and `logins_count`. If it has been used beyond creation, or the user had Cloud Backup or a purchase on it, treat it as holding data (rows under an `email|` sub do not follow a link) and escalate.
7. **Does the device own the typo account?** Loki `Device owner adopted` / `Foreign session on an owned device` with the hash. If the user also sees the wrong-account screen, read [wrong-account-screen](wrong-account-screen.md).

## Causes

### 1. Typo address on a password account; the corrected address is held by a stray empty account
The user created a new account (code login at the Login screen with the right address) while the real, data-holding password account carries the typo. The API will not merge: the corrected address belongs to the stray `email|` user.

### 2. Typo address on a password account; the corrected address is held by another real account of the user's
Same, but the other holder is a Google/Apple/password account that has data. Needs a decision about which account is canonical before anything is edited.

### 3. Typo address on a password account; the address is free
The user can fix it in the app. If they cannot get a code (the typo address does not exist), the app's flow still works: on the review step "Not my email? Change it", type the correct address, receive the code there. This is not a lock-out. If it still fails, see [no-code-email](no-code-email.md).

### 4. The corrected address is held by another person's account
Treat as a possible account takeover or typo into someone else's address. Do not edit. Escalate.

## Solution

### Cause 3
Tell the user to use "Not my email? Change it", type the correct address and enter the code sent there.

### Cause 1 and 2: correct the address in Auth0 (support-trusted prod write)

**Pending Jenova's decision on the in-app path.** This is the support fix today.

1. Read the user: `GET /api/v2/users/{sub}` for the typo account. Keep the before-state (email, `email_verified`, identities).
2. Confirm with the user which account is theirs and which holder of the corrected address (the stray account) can be abandoned. **Never edit or delete account A because B asked.** Confirm the user controls the stray account (they should be able to open it with a code to the corrected address) before removing it, and confirm it holds no data they want.
3. Free the corrected address. Prefer the **non-destructive** route: escalate for engineering to decide, or have the user keep the stray as their account if it is the one they want. Only if **all** hold, delete the stray (`DELETE /api/v2/users/{stray_sub}`; irreversible, deletes no server data or RevenueCat customer; see [tools: delete a user](../reference/tools.md#delete-a-user)): no device owns it (Diagnose 6), it has never been used beyond creation (`logins_count`, `last_login`), the user had no Cloud Backup or purchase on it, and the user agrees. Otherwise **stop and escalate**; do not choose for the user.
4. Check nothing else holds the corrected address: `GET /api/v2/users-by-email?email=user@example.com`.
5. Correct the typo account. Use the body from [tools](../reference/tools.md#update-an-email-or-set-email_verified-password-users-only), with `connection`:
   ```json
   {
     "email": "user@example.com",
     "email_verified": true,
     "verify_email": false,
     "connection": "Username-Password-Authentication"
   }
   ```
   `email_verified: true` is correct **only** if you have confirmed the user can read that inbox (a code to that address works, or they replied from it). `verify_email: false` stops Auth0 sending its own mail; leave it out and the user gets one. `PATCH /api/v2/users/{sub}` on `auth0|` accounts only. The sub does **not** change, so no server rows and no RevenueCat customer move.
6. Tell the user what to do **on the device**:
   1. Open the app. The mandatory screen may still show because the phone holds a token that says unverified, and **it has no sign-out**. Try force-quit and reopen first. If it persists, switch on airplane mode: a mandatory screen closes while the device is offline, so Settings is reachable; sign out, reconnect, then sign in again with the **password** (fresh token carrying the corrected address and `email_verified: true`). Last resort: reinstall (loses unsynced local data).
   2. Alternatively, on the Login screen choose "Continue with Email" and enter the corrected address: the code login links into the password account through the automatic link (same sub, same data), and the screen stops asking because code sessions are never asked.
   3. If the phone shows the wrong-account screen afterwards (because the owner record is the stray account), see [wrong-account-screen](wrong-account-screen.md).
   4. Settings and report addresses may keep the old address until the next token renewal: see [email-change-not-showing](email-change-not-showing.md).
7. Re-check: the Auth0 user's email and **Email verified**; Loki `Verify email shown` stops for the hash.

### Cause 4
Do not edit anything. Escalate.

**Old app versions.** Builds that have not applied the OTA have no verify screen and no code login; a user on such a build signs in with the password and is not locked out by the typo. The lock-out begins when the new JS arrives.

## Escalate

When the stray holder has data, when the corrected address belongs to another person's account, when the account is Google or Apple (address cannot be changed in Auth0), or when the user cannot be proven to control the corrected inbox and insists on the change. Attach: the hash of the typo account, the hashes of every holder of the corrected address (computed locally), the `user_id` prefixes and creation dates, `appVersion`, platform, timestamps (timezone), the `email_in_use` Loki lines, whether the user is on the mandatory screen. No addresses, no raw subs.

## Reply

See [../replies/mistyped-email-locked-out.md](../replies/mistyped-email-locked-out.md). Expected variants:

- `fix-in-app`: Cause 3; change the address on the screen.
- `we-fixed-it-sign-in-again`: Causes 1 and 2 after the Auth0 fix; sign in with your password or a code to the corrected address.
- `need-to-confirm-which-account`: before editing; asks the user to confirm which account is theirs.
- `cannot-change-this-address`: Google/Apple address, or Cause 4.

## Sources

- `app/components/VerifyEmailGate.tsx`
- `app/components/VerifyEmailView.tsx`
- `app/services/api/emailVerifyProblem.ts`
- `app/services/auth/emailVerifyLogic.ts`
- `app/i18n/en.ts` (`verifyEmailScreen`)
- `docs/support/reference/email-verification.md` (the D5 section), `tools.md`
- `api:src/routes/auth0Email.ts` (`email_in_use`, `PASSWORD_CONNECTION`, PATCH body)
- `auth0/actions/meetingmaker/link-passwordless-identity.js`
