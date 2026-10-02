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
6. **Check the stray holder.** The default fix leaves the stray in place; these checks decide whether its data needs engineering and whether the deletion exception is open. Compute the stray account's hash locally from its dashboard `user_id`. Search Loki for it as `ownerId` (`Device owner adopted`, `Foreign session on an owned device`, `Device owner relinked into a linked account`). If any device owns the stray, never delete it (that device would land on the wrong-account screen with only a reinstall as exit). In the dashboard read the stray's `created_at`, `last_login` and `logins_count`. If it has been used beyond creation, or the user had Cloud Backup or a purchase on it, treat it as holding data: rows under an `email|` sub do not follow a link, so escalate that part.
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

### Cause 1: correct the address in Auth0 and leave the stray (default)

**Pending Jenova's decision on the in-app path.** This is the support fix today.

1. **Read the typo account:** `GET /api/v2/users/{sub}`. Keep the before-state (email, `email_verified`, identities).
2. **Confirm ownership.** Confirm with the user which account is theirs. **Never edit or delete account A because B asked.** Before you set `email_verified: true`, confirm the user can read the corrected inbox: ask them to reply **from** that address.
3. **List the holders of the corrected address:** `GET /api/v2/users-by-email?email=user@example.com`. Expected in Cause 1: the stray `email|` account and nothing else.
   - Another `auth0|` (password) account holds it: Auth0 refuses a duplicate inside one connection. Stop and escalate.
   - A Google or Apple account holds it: that is Cause 2.
4. **Correct the typo account and leave the stray where it is.** Use the body from [tools](../reference/tools.md#update-an-email-or-set-email_verified-password-users-only), with `connection`:
   ```json
   {
     "email": "user@example.com",
     "email_verified": true,
     "verify_email": false,
     "connection": "Username-Password-Authentication"
   }
   ```
   `PATCH /api/v2/users/{sub}` on `auth0|` accounts only. Our API's `email_in_use` refuses an address that any other user holds; Auth0 documents email uniqueness per connection only, so this PATCH should succeed while the stray (connection `email`) holds the same address. **Confirm that once on `bad-bitch-tenant` before first use on prod.** If Auth0 refuses, stop and escalate. `email_verified: true` only after step 2's check. `verify_email: false` stops Auth0 sending its own mail. The sub does **not** change, so no server rows and no RevenueCat customer move.
5. **What happens to the stray: nothing, until its next code login.** It has exactly one identity, so at its next code login the Link Action looks up every account on the address, skips the stray itself, keeps the ones whose root identity is `auth0`, `google-oauth2` or `apple`, and links into the **oldest**. In Cause 1 that is the corrected password account: it becomes the primary, and the login lands in the user's real account with their data (`link-passwordless-identity.js`). If a device owns the stray, that device shows the wrong-account screen once and then relinks on the next code entry (the same sequence as the [code-owner wrong tap](../reference/account-linking.md#code-owner-and-a-googleapple-wrong-tap-inferred-from-code); inferred from code, not device-tested). Rows the stray pushed to the server stay under its sub (none expected for an unused stray).
6. **Trade-off of leaving the stray:** while it exists, the in-app verify on the corrected address still answers `email_in_use`, so device step (a) below is not available. The user relies on step (b), or on a code sign-in once they reach the Login screen.
7. **Exception: delete the stray** only to unlock device step (a), and only if **all** hold: no device owns it (Diagnose 6), `logins_count` and `last_login` show it was never used beyond creation, the user had no Cloud Backup or purchase on it, the user controls it and agrees. `DELETE /api/v2/users/{stray_sub}` is irreversible and deletes no server data or RevenueCat customer ([tools: delete a user](../reference/tools.md#delete-a-user)). If any check fails, leave it.

### Cause 2: the other holder has data, decide first

The PATCH in Cause 1 step 4 would succeed here too (different connections), but then two real accounts share the address. The next code login on that address links into the **oldest** of them: if the Google or Apple account is older than the password account, it becomes the primary and code logins land there, not in the password account. Provider logins never link, so the two accounts' data stay apart either way, and no link moves server rows. Agree with the user which account is canonical before editing anything. If both hold data the user wants, escalate.

### Device steps after the fix (Causes 1 and 2)

Tell the user what to do **on the device**, in this order:

1. **(a) Confirm in the app, when no other user holds the corrected address** (the stray was deleted under the exception, or never existed). On the verify screen: "Not my email? Change it", type the corrected address, "Send code", enter the code. The API finds no other holder, sets `email_verified`, and the app closes the screen, updates the account address **and** the device owner's "Send code to {{email}}" address, and renews the token (`VerifyEmailGate.tsx`; code-derived, not device-tested). It also proves the inbox.
2. **(b) Force-quit and reopen, once the phone's token has renewed.** Only works when Auth0 says `email_verified: true`. When the renewal happens depends on the tenant's token lifetimes, so it may take hours; ask the user to try again later rather than repeatedly.
3. **(c) Airplane mode, likely to fail for this user.** A mandatory screen closes while the device is offline, so Settings is reachable. But only password sessions see this screen, and a password session's "Logout" opens a browser to clear the Auth0 session, which cannot load offline. Closing that browser most likely aborts the logout (`Logout cancelled by user`), and the screen returns once online. Not device-tested; try it only before a reinstall.
4. **(d) Reinstall, last.** Loses unsynced local data. A reinstall also clears the device owner, so the next sign-in adopts.

**At the Login screen afterwards.** For a password owner the Login screen shows "Send code to {{email}}" with the **old (typo) address**, a "Use a different email" link and "Can't get a code? Sign in with your password". A dashboard edit and a password sign-in do not change that stored address (only a code sign-in or an in-app verify does). Tell the user: sign in with the password, or tap **"Use a different email"** and type the corrected address. Do **not** tap "Send code to …": that code goes to the typo. A code to the corrected address signs in to the password account (through the automatic link, same sub, same data), and code sessions are never asked to verify.

If the phone shows the wrong-account screen afterwards (the device owns the stray), see [wrong-account-screen](wrong-account-screen.md). Settings and report addresses may keep the old address until the next token renewal: see [email-change-not-showing](email-change-not-showing.md).

Re-check: the Auth0 user's email and **Email verified**; Loki `Verify email shown` stops for the hash.

### Cause 4
Do not edit anything. Escalate.

**Old app versions.** Builds that have not applied the OTA have no verify screen and no code login; a user on such a build signs in with the password and is not locked out by the typo. The lock-out begins when the new JS arrives.

## Escalate

When the stray holder has data, when the corrected address belongs to another person's account, when the account is Google or Apple (address cannot be changed in Auth0), or when the user cannot be proven to control the corrected inbox and insists on the change. Attach: the hash of the typo account, the hashes of every holder of the corrected address (computed locally), the `user_id` prefixes and creation dates, `appVersion`, platform, timestamps (timezone), the `email_in_use` Loki lines, whether the user is on the mandatory screen. No addresses, no raw subs.

## Reply

See [../replies/mistyped-email-locked-out.md](../replies/mistyped-email-locked-out.md). Expected variants:

- `fix-in-app`: Cause 3; change the address on the screen.
- `we-fixed-it-confirm-in-app`: Causes 1 and 2 after the Auth0 fix, when no other user holds the corrected address (device step a).
- `we-fixed-it-sign-in-again`: Causes 1 and 2 after the Auth0 fix, with the stray left in place (device step b, then the Login screen).
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
