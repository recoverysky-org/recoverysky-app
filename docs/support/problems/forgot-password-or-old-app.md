# "I forgot my password" / "I'm on an old version of the app"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email, raw sub or password into a ticket, a Loki query or a log. Examples are fake (`user@example.com`, `auth0|65f0000000000000000000aa`).

Background: [sign-in methods](../reference/sign-in-methods.md#password) and [account linking](../reference/account-linking.md#path-a-automatic-linking-on-an-email-code-login).

## Symptoms

- "I used to sign in with a password and I can't remember it."
- "The app asks for a code now, I just want my password."
- "I'm on an old version, there's no 'Continue with Email'."
- "It says my password is wrong." / "It says the account doesn't exist."
- "It says I'm blocked after too many tries." (see Diagnose 5)

## Diagnose

1. **Is the account a password account at all?** Dashboard, find the user ([tools](../reference/tools.md#find-a-user-by-email)). Only a row whose `user_id` starts `auth0|` (or a linked account whose root identity is `auth0`) has a password. A Google, Apple or code-only (`email|`) account has none: the user never had a password, so a "forgot password" ticket there is really "I forgot which method I used" ([empty-account-after-sign-in](empty-account-after-sign-in.md)).
2. **What build are they on?** Loki `appVersion` is `{version}-{update}` (for example `4.10.1-15`). "Old" means pre-OTA: older native versions, or 4.10.1 before the OTA applied ([old app versions](../reference/sign-in-methods.md#old-app-versions)). No list of old version numbers exists. Easiest: find a Loki line with their `userId` and read `appVersion`; otherwise ask whether the sign-in page has a "Continue with Email" button. An old build shows Auth0's Universal Login (a browser page with the password form) and has no "Continue with Email" button.
3. **Tenant log: what did the password attempt do?** Dashboard, Monitoring, Logs, around the time ([event codes](../reference/tools.md#tenant-log-event-codes)):
   - `fp` (wrong password): the address exists; the password is wrong.
   - `fu` (unknown user): no password account on the typed address. Check spelling, the other addresses they use, and step 1.
   - `seacft` after an `s`: it worked; the user is signed in and the problem is elsewhere.
   - Anything else beginning `f`: read its description.
4. **Where does a reset email go?** To the address on the Auth0 account. If that address is mistyped or dead, a reset cannot reach the user: [mistyped-email-locked-out](mistyped-email-locked-out.md). Note the address on the row and ask the user to read theirs back (do not paste either into the ticket).
5. **Blocked?** After repeated wrong passwords Auth0's brute-force protection can block the account (`fp` repeated for the same user, and the user's dashboard page may show it as blocked; the exact event code is not catalogued here, so read the event description). Unblocking is done on the user's page in the dashboard (inferred from Auth0's dashboard behaviour; not exercised by us).
6. **Can they receive a code on that address?** If yes, the simplest fix is not a reset at all (Cause 2). If the address on the account is the one they read back correctly, a code login will link into the password account.

## Causes

### 1. The user forgot the password and has a working address
A reset email will reach them. Or they can skip the password entirely by using the code.

### 2. The user can use an email code instead
On a current build, "Continue with Email" with the account's address sends a code, and the post-login Action links that code login into the older password account when the addresses match (same sub, same data). The code is the better route: no password to remember, and code sessions are never asked to verify their email. The password stays valid in case an old build needs it.

### 3. The address on the password account is wrong or dead
No reset email and no code can reach them. Support must correct the address: [mistyped-email-locked-out](mistyped-email-locked-out.md).

### 4. Old build: password is the only way in
Old builds sign in with the password through Universal Login on the shared prod client and cannot be sent a code from it. A forgotten password there needs a reset or an app update.

### 5. The user never had a password
Google, Apple or code-only account ([sign-in methods](../reference/sign-in-methods.md#at-a-glance)). Tell them which method, from the dashboard prefix and identities.

### 6. Account blocked by brute-force protection (Diagnose 5)
Several wrong passwords in a row.

## Solution

1. **Cause 2 (preferred):** on a current build the user taps "Continue with Email", types the exact address on the account, taps "Send Code", enters the 6 digits. If it lands on an empty account instead, the typed address differs from the password account's: [empty-account-after-sign-in](empty-account-after-sign-in.md). Warn: if the phone already belongs to a different account (device owner), they get the wrong-account screen ([wrong-account-screen](wrong-account-screen.md)).
2. **Cause 1 (they want the password back):**
   1. The password form is one tap from Login: the small link "Can't get a code? Sign in with your password" under the sign-in buttons (on the wrong-account screen, "Sign in with your password instead", only for password owners). It opens Auth0's password page in a browser.
   2. Whether that page shows a "Forgot password?" link is controlled by the tenant's Universal Login settings, which are not in this repo; **unverified**. Open the page and check before promising it. The app itself has no reset screen.
   3. If the page offers no reset link, send a reset from the dashboard: open the user, Actions, Change Password (Auth0 emails a reset link to the address on the account; the prod tenant has an email provider). The Management API equivalent is Auth0's password-change ticket; Auth0's standard feature, not exercised in our repo. Check Auth0's current docs for the exact request.
   4. **Do not set a password for the user** with a PATCH: support would then know it. Use the reset link.
3. **Cause 3:** [mistyped-email-locked-out](mistyped-email-locked-out.md).
4. **Cause 4 (old build):** tell the user to update the app from the store: the update brings "Continue with Email" and the code. Until then a reset (Cause 1, 2) is the only route on the old build. An old-build session restored on the new JS counts as having no recorded sign-in method, so a password account may be shown the email-verification screen once: [verify-screen-wont-go-away](verify-screen-wont-go-away.md).
5. **Cause 5:** tell the user the method (Google, Apple or email code); the Account row in Settings shows it once signed in.
6. **Cause 6:** unblock in the dashboard if appropriate, then follow Cause 1 or 2. Do not change the account's address to "help".

**Old app versions.** See Cause 4. Linked accounts keep working on old builds because the password is not randomised on link; an old build signing in with the password returns the primary's sub (inferred from how linking works, not tested).

## Escalate

When a reset email never arrives although the address is right and the Auth0 log shows it sent; when the user cannot receive anything at the address on the account and cannot prove ownership of another; when the account is a code-only or Google/Apple account whose owner insists they had a password. Attach: the hash, the user's `appVersion` and platform, timestamps (timezone), the tenant log `fp`/`fu`/other events with descriptions, and the account's identity prefixes (not raw subs).

## Reply

See [../replies/forgot-password-or-old-app.md](../replies/forgot-password-or-old-app.md). Expected variants:

- `use-an-email-code-instead`: Cause 2; no password needed.
- `reset-your-password`: Cause 1; we sent or you can request a reset.
- `update-the-app`: Cause 4; update from the store.
- `you-dont-have-a-password`: Cause 5; which method to use.

## Sources

- `app/screens/LoginScreen.tsx`, `app/screens/login/LoginSteps.tsx`, `app/screens/WrongAccountScreen.tsx`
- `app/services/auth/useAuth0Wrapper.ts` (`loginWithProvider`, password connection)
- `app/i18n/en.ts` (`loginScreen`, `wrongAccountScreen`)
- `auth0/README.md` (Universal Login unchanged; password not randomised)
- `auth0/actions/meetingmaker/link-passwordless-identity.js`
- `docs/PROD_AUTH0_ROLLOUT.md`
- `docs/support/reference/sign-in-methods.md`, `account-linking.md`, `tools.md`
