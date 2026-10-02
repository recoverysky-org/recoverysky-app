# "Google or Apple sign-in just hangs" / "nothing happens"

Privacy rule (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Examples are fake.

Background: [sign-in methods: Google and Apple](../reference/sign-in-methods.md#google) and [login errors](../reference/sign-in-methods.md#login-error-messages).

## Symptoms

The user taps "Continue with Google" or "Continue with Apple" (a browser sheet opens, or briefly opens) and:
- the screen says "Opening browser for authentication..." and never moves on;
- a Google or Apple page loads, they finish, and the app stays on Login;
- the browser closes and nothing happens, with no error shown;
- the sheet appears and disappears;
- (iOS) a system dialog asks to sign in and they are unsure;
- Apple finished but Settings shows "Hidden by Apple" and no address.

## Diagnose

1. **Platform and build.** iOS or Android? Store build, TestFlight or a developer build? Ask for the app version (Loki `appVersion`, `{version}-{update}`). Hangs on Android that begin right after a *developer* or local build are almost always Cause 1; store builds come from EAS and get the prod domain.
2. **Is a visible error shown?** A red strip is not a hang:
   - "The sign-in window closed before you finished. Tap the button again and stay in the browser until it brings you back to the app." (Android, `BROWSER_TERMINATED`): Cause 4.
   - "We couldn't reach the sign-in service. Check your connection and try again.": network; or `unauthorized_client` on the Auth0 application ([sign-in methods](../reference/sign-in-methods.md#login-error-messages)).
   - Nothing at all: the user cancelled or declined (Cause 3) or the app never got the callback (Cause 1, 2).
3. **Loki: how far did the app get?** These lines come from the user **while signed out**, so they carry no `userId`. Narrow with `appVersion` and a short time window around the report, and with `deviceId` or `sessionId` if you have one from an earlier line of the same user:
   ```
   {service_name="recoverysky-app", module="useAuth0Wrapper", appVersion="<version-update>"} |~ "Starting provider login|Provider login flow completed|Provider login cancelled or declined by user|Provider login failed|Browser session clear"
   ```
   (Filter on `| connection="google-oauth2"` or `"apple"` — `connection` is structured metadata.)
   | Sequence | Meaning |
   | --- | --- |
   | `Starting provider login` (`connection`, `clearFirst`) then `Provider login flow completed` then `Syncing Auth0 user to MST store` | Login worked in the app. If the user still sees Login, the problem is after sign-in: the ownership gate ([wrong-account-screen](wrong-account-screen.md)) or a forced logout ([signed-out-unexpectedly](signed-out-unexpectedly.md)) |
   | `Starting provider login` then `Provider login cancelled or declined by user` (INFO) | Cause 3: the user closed the sheet or declined consent. Nothing is shown by design |
   | `Starting provider login` then `Provider login failed` (ERROR; `connection`, `error`) | A real SDK error; read `error`. Cause 4 or a network problem |
   | `Starting provider login` and **nothing after it** | The call never returned: Cause 1, 2, or the user left the browser open |
   | `Browser session clear cancelled by user — proceeding` | iOS "Sign In" dialog dismissed ([Cause 5](#5-ios-system-dialog)) |
   | `Auth error displayed to user` (module `LoginScreen`) | The exact text the user saw |
   On a local/dev build, only logs sent to Loki exist; a developer build may not report at all.
4. **Tenant log: how far did Auth0 get?** Dashboard, Monitoring, Logs ([event codes](../reference/tools.md#tenant-log-event-codes)), around the time, `connection` `google-oauth2` or `apple`:
   | Tenant log | Meaning |
   | --- | --- |
   | `s` (login OK) followed by `seacft` | Auth0 finished and the app exchanged the code. The user is signed in server-side; look at the app side (Diagnose 3, first row) |
   | `s` but **no** `seacft` | Auth0 completed the browser login but the app never received the callback (Cause 1), or the app was killed/backgrounded before exchanging the code (Cause 4), or the exchange failed on the network (`f*` event; read its description) |
   | No `s`, an `f` event | The provider or Auth0 refused; read `description` (consent denied, provider error) |
   | Nothing | The browser never reached Auth0 (no network, blocked page, closed sheet, the user stopped early) |
5. **Android: does the tenant match the build?** Only for developer/local builds. The Android redirect intent filter is baked at prebuild from the `react-native-auth0` plugin's `domain`; the callback is `recoverysky-app://<auth0 domain>/android/<package>/callback`. If the baked host differs from the tenant the JS talks to (`EXPO_PUBLIC_AUTH0_DOMAIN`), Android never hands the callback back and the login "hangs on Auth0's page". iOS matches on the scheme alone and does not care. Store builds get `auth.recoverysky.app` from `eas.json`. A prod tenant `s` event with no `seacft` from a developer build is the signature.
6. **Apple relay?** If Apple signed in and Settings shows "Hidden by Apple", the address is a Hide My Email relay. That is not a hang; see [account linking](../reference/account-linking.md#apple-hide-my-email) and [empty-account-after-sign-in](empty-account-after-sign-in.md).
7. **Noise: Google's Play pre-launch crawler.** Emulator sessions that spam login within seconds after an AAB upload are Google's robo test, not users. Not a ticket.

## Causes

### 1. Android redirect domain does not match the tenant (developer/local builds)
See Diagnose 5. The browser completes at Auth0 but the app never gets the callback. Not seen in store builds; a plugin or `.env` change needs `npm run prebuild:clean` and a native rebuild.

### 2. The callback was lost (task killed, browser app problem)
The OS killed the app while the browser was open, the user switched away, or no usable browser handled the sheet. Tenant log: `s` without `seacft`. A retry normally works. (Likely; the app code cannot distinguish these.)

### 3. The user cancelled or declined consent
Closing the sheet, tapping Cancel, or refusing Apple/Google consent is `USER_CANCELLED` or `ACCESS_DENIED`. Nothing is shown (RS-022); the INFO line is the only trace. To the user it looks like "it just stopped".

### 4. The sign-in window was closed
Android's `BROWSER_TERMINATED` ("The sign-in window closed before you finished..."): the browser window was closed by a new instance of the app. Usually a retry works.

### 5. iOS system dialog
On iOS the system can show its own "Sign In" prompt around the browser session (the OS's dialog, not ours; the exact timing is not documented in our code, so hedge). When it appears at **logout** or on the wrong-account screen's "clear first" step and is cancelled, the app logs `Logout cancelled by user` or `Browser session clear cancelled by user — proceeding`; the login continues but the old browser cookie may hand the foreign account straight back ([wrong-account-screen](wrong-account-screen.md)).

### 6. Network or the 30-second SDK timeout
The browser part needs the network; the code exchange afterwards is an SDK request with a **30 s** timeout (`AUTH0_CONFIG.timeoutMs`). A weak connection can look like a long spin and then end in "We couldn't reach the sign-in service...". On builds before 2026-09-30 the timeout was 10 s.

### 7. Wrong account came back
The sign-in succeeded, but the device belongs to a different account, so the user sees the wrong-account screen instead of the app: [wrong-account-screen](wrong-account-screen.md).

## Solution

1. **Cause 3, 4 and 2:** the user taps the button again and stays in the browser until it brings them back to the app. Do not open other apps meanwhile. If the user has the legal-agreements modal ("Legal Agreements", "Accept"), they must accept it first.
2. **Cause 5:** have the user go through the system prompt rather than cancel it. A cancelled prompt at login ends as Cause 3 (nothing shown).
3. **Cause 6:** move to a stable network and retry. Use the email code as a fallback ("Continue with Email"): it needs no browser, so it avoids Causes 1 to 5. If the Google or Apple account has the **same address**, an email code links to it (the older account wins, [automatic linking](../reference/account-linking.md#path-a-automatic-linking-on-an-email-code-login)); with Hide My Email it will not, so use the Apple button. If the user has **no** Google or Apple account with us yet (a first sign-in), the code creates an `email|` account that then owns the phone; a later successful Google or Apple tap on the same address is the code-owner wrong tap ([wrong-account-screen](wrong-account-screen.md), Cause 2), whose cloud rows do not follow ([account linking](../reference/account-linking.md#code-owner-and-a-googleapple-wrong-tap-inferred-from-code)). Tell the user: once you use the email code on this phone, keep using it.
4. **Cause 1 (developer build):** tell the developer to check `EXPO_PUBLIC_AUTH0_DOMAIN` (including a stale value exported in the shell, which wins over `.env`) and run `npm run prebuild:clean`, then rebuild. Plugin edits are native-shape changes and need a `runtimeVersion` bump before shipping. Support cannot fix this for a store user: if the user is on a store build, **escalate**.
5. **Cause 7:** [wrong-account-screen](wrong-account-screen.md).
6. For an Apple user surprised by "Hidden by Apple" or an empty account: [empty-account-after-sign-in](empty-account-after-sign-in.md).
7. Do not tell the user to delete the account, Delete User Data, or reinstall for a hang. None of them touch the cause, and Delete User Data and reinstall discard unsynced local records.

**Old app versions.** Old builds do not have the provider buttons: they show Auth0's Universal Login with a password form on the shared prod client. A user who says "Google hangs" on an old build is describing something else; see [forgot-password-or-old-app](forgot-password-or-old-app.md). Builds before 2026-09-30 timed out SDK requests at 10 s.

## Escalate

When a **store** build hangs on Android with `s` and no `seacft` in the tenant log (suspect the redirect domain in that build); when a hang reproduces for one user on a stable network; when `Provider login failed` carries an unexplained `error`; when `Passwordless OTP grant missing on the Auth0 application` appears (tenant configuration). Attach: platform, `appVersion`, the user's `connection`, timestamps (timezone), the tenant-log events with their types and `description` (no email), the app log sequence from Diagnose 3 with the `error` text, and `deviceId` or `sessionId` if known.

## Reply

See [../replies/sign-in-hangs-google-apple.md](../replies/sign-in-hangs-google-apple.md). Expected variants:

- `try-again-stay-in-browser`: Causes 2 to 4 and 6; try again, then try the email code.
- `allow-the-ios-prompt`: Cause 5.
- `we-are-looking-into-it`: Cause 1 on a store build; escalated.

## Sources

- `app/services/auth/useAuth0Wrapper.ts` (`loginWithProvider`, log lines)
- `app/services/auth/authErrorLogic.ts` (`isUserAbandonedAuth`, `classifyAuthError`)
- `app/services/auth/auth0.ts` (`AUTH0_CONFIG`, `timeoutMs`)
- `app.config.ts`, `app.json` (`react-native-auth0` plugin `domain`), `eas.json` (`EXPO_PUBLIC_AUTH0_DOMAIN`)
- `CLAUDE.md` ("Expo Config: `app.json` + `app.config.ts` + `plugins/`")
- `app/i18n/en.ts` (`loginScreen`)
- `docs/support/reference/sign-in-methods.md`, `account-linking.md`, `tools.md`
