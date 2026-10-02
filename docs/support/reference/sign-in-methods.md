# Sign-in methods

How a user can sign in to the app, what each method does on the Auth0 side, what the app records, and every error the login screen can show. Privacy rule first (see the [README](../README.md#privacy-rule-for-support)): logs carry `hashUserId(sub)` only. Never paste a user's email or raw sub into a ticket, a Loki query or a log. Compute the hash locally ([tools](tools.md#hash-an-auth0-sub-into-the-log-userid)).

## At a glance

| Method | What the user taps | Auth0 connection | Sub prefix | `loginMethod` | Browser opens | Logout |
| --- | --- | --- | --- | --- | --- | --- |
| Email code | "Continue with Email" | `email` (passwordless) | `email\|` | `email` | No | Clear credentials only |
| Password | "Can't get a code? Sign in with your password" | `Username-Password-Authentication` | `auth0\|` | undefined | Yes (Auth0 password page) | Browser session cleared |
| Google | "Continue with Google" | `google-oauth2` | `google-oauth2\|` | `google` | Yes | Browser session cleared |
| Apple | "Continue with Apple" | `apple` | `apple\|` | `apple` | Yes | Browser session cleared |

Two caveats apply to the "Sub prefix" column:

- After [account linking](account-linking.md), one Auth0 user holds several identities and **every** login returns the primary's sub. A user who signs in by code can therefore carry an `auth0|`, `google-oauth2|` or `apple|` sub. Do not infer the method from the prefix on a linked account. The app's own "which method is active" logic uses `loginMethod`, not the prefix.
- `loginMethod` is written **only for an accepted session** (one the [ownership gate](device-owner.md#ownership-outcomes) did not refuse). It is cleared on logout. A password sign-in records **no** `loginMethod` by design, and neither does a session restored by an old build. Several behaviours key off "no `loginMethod`": the logout branch, and who the verify-email screen asks (see [email verification](email-verification.md)).

## Common to every method

- **Legal agreements.** The first time, every method is gated by a modal titled "Legal Agreements" with "Accept" and "Cancel". Acceptance is stored in SecureStore and not asked again (Delete User Data clears it, so it is asked again afterwards). If the text cannot load, the modal says "We couldn't load the legal agreements. Please check your connection and try again." with "Try Again". Accept is blocked, and `EUA accept blocked — legal content not displayed` is logged, if the content was not displayed.
- **Login screen steps.** `choose`, `email`, `code`.
- **Button order.** iOS: Apple, Google, Email. Android: Google, Apple, Email.
- **Intro text.** iOS: "Log in to access app subscriptions and premium features. An account is required by Apple for apps with interactive services like video conferencing." Android: "Log in to access app subscriptions and premium features. Subscriptions require a logged in account." followed by "You may login and logout at any time in Settings."
- **No guest button on the login screen.** The anonymous option is commented out of the UI. The old "Sign Up" and "Log In" buttons are retired.
- **Browser flows** (password, Google, Apple) show "Opening browser for authentication..." while the browser is open.
- **Tokens.** Scopes are `openid profile email offline_access` and the app's API audience. Only the refresh token is persisted (MMKV). The access token, ID token and expiry live in memory.
- **Token shape check.** Every access token must pass `isUsableAccessToken()` before it enters the store. An audience-less login yields an opaque token, and the user is signed out one tick after signing in (see [signed out unexpectedly](#signed-out-unexpectedly)).
- **Which accounts exist.** There is no "no account for that email" outcome. Passwordless creates the account on first use, so any address is accepted.

## Email code (Continue with Email)

**What the user sees**

1. Choose step: "Continue with Email".
2. Email step: label "Email address", placeholder "you@example.com", button "Send Code", link "Back". The button is disabled until the address looks like `x@y.z`. There is no error text for a malformed address; a mistyped address simply never receives a code.
3. Code step: header "We sent a code to {{email}}" (the address is masked, for example `u***@example.com`), field "6-digit code", button "Verify", link "Resend code" (or "Resend in {{seconds}}s" while it cools down), link "Wrong email? Go back".

**Returning owner.** If the device owner's sub starts with `email|` or `auth0|`, the Email button is replaced by "Send code to {{email}}" (masked) plus a link "Use a different email". Tapping the first sends a code to the stored owner address and goes straight to the code step. Owners who signed in with Apple or Google get the plain buttons.

**What happens**

- The app calls the Auth0 SDK `sendEmailCode` (`send: "code"`) and then `authorizeWithEmail` with the app's `audience` and `scope`. The address is normalised with `trim().toLowerCase()`. No browser opens. Logs: `Sending passwordless code`, `Verifying passwordless code` (neither carries the address or the code).
- The code is a **6-digit** number. The field accepts 6 digits and **auto-submits** the moment 6 digits are present.
- **Who sends the email.** Auth0's own email provider (SMTP), not Postmark. Diagnose a missing code in the Auth0 tenant log (`cls` = code sent; `fcls` = send failed, a label from our script that has not been observed on our tenants; see [tools](tools.md#tenant-log-event-codes)). The verification codes on the verify-email screen are a different thing and do go through Postmark.
- **Sub.** First use creates an `email|` user. If another account with the same address already exists and is linkable, the post-login Action links the new identity into it and the token carries that account's sub (see [account linking](account-linking.md)).
- **Logout.** Clears credentials only; logs `Email session credentials cleared`. No browser and no iOS "Sign In" system dialog, because no browser session was ever created.

**Timings**

| Item | Value | Where it comes from |
| --- | --- | --- |
| Code length | 6 digits | App |
| Code lifetime | Set on the Auth0 tenant (the design spec says 180 s; not in app code, verify in the tenant's passwordless settings) | Auth0 |
| Resend cooldown | 30 s, starts at each successful send; re-armed to the full 30 s after a rate-limit refusal | App (`RESEND_COOLDOWN_MS`) |
| Auth0's own send limit | Stricter than the cooldown over an hour; a second refusal after waiting 30 s is normal | Auth0 |
| SDK per-request timeout | 30 s (SDK default is 10 s) | App (`AUTH0_CONFIG.timeoutMs`) |
| Verify-email screen cooldown | 60 s (different screen, different system) | App |

The 30 s timeout exists because `/passwordless/start` answers only after Auth0 has handed the email to its mailer (5 to 9 s measured on the dev tenant, which has no email provider, and up to 19 s through a VPN). Builds before 2026-09-30 aborted at 10 s and showed "We couldn't reach the sign-in service" while the code email was already on its way. The tenant log shows `cls` in that case.

## Password

**What the user taps.** A small link under the sign-in buttons: "Can't get a code? Sign in with your password" (accessibility hint "Opens the password sign-in page in a browser"). On the wrong-account screen the link reads "Sign in with your password instead". It was added on 2026-10-01 for legacy accounts that cannot receive a code (a dead or mistyped address). It used to be dev-only.

**What happens**

- The app calls the SDK `authorize` with connection `Username-Password-Authentication`. Auth0's Universal Login password form opens in a browser. This is the only method that shows Universal Login.
- Sub prefix `auth0|`.
- **`loginMethod` is not recorded.** Consequences: logout takes the browser branch (`clearSession`); Settings, Account derives the row from the `auth0|` prefix and shows "Email"; the verify-email screen is eligible to ask an unverified `auth0|` account (see [email verification](email-verification.md)).
- If the stored owner sub is `auth0|`, the wrong-account screen shows both "Send code to {{email}}" and the password link. `email|` owners get no password link.
- Telemetry: the Umami `login_completed` event carries `method: "password"`. It fires after the provider login call returns, even if the user cancelled or the login failed (that call swallows errors), so it over-counts password sign-ins.
- Password accounts keep working after the user later signs in by code and gets linked: the link Action deliberately does not randomise the password, because old app builds still sign in with it.

## Google

- Button "Continue with Google". The app calls `authorize` with connection `google-oauth2`; Universal Login is never shown, the browser goes straight to Google.
- Sub prefix `google-oauth2|`, `loginMethod` `google`.
- Logout: `clearSession` with the app's custom scheme (`recoverysky-app`). On iOS the system shows a "Sign In" dialog; if the user cancels it, logout is aborted (`Logout cancelled by user`) and they stay signed in.
- Declining consent or closing the browser is not an error: INFO log `Provider login cancelled or declined by user`, nothing shown (RS-022).
- Failure log: `Provider login failed` with the connection and the raw SDK message.

## Apple

- Button "Continue with Apple". Same flow as Google with connection `apple`. Sub prefix `apple|`, `loginMethod` `apple`. Logout is the same browser branch.
- **Hide My Email.** The relay address (`...@privaterelay.appleid.com`) never matches the user's real address, so automatic linking cannot match it. Settings shows "Hidden by Apple" instead of the address, and the wrong-account screen never shows an owner address for an Apple owner. A relay user who types their real address on the email step gets a fresh `email|` account. That is the wrong-account case, not a bug (see [device owner](device-owner.md#the-wrong-account-screen)).

## Login error messages

All shown in one red strip at the top of the Login screen and the wrong-account screen. Mapping: `classifyAuthError` (`app/services/auth/authErrorLogic.ts`) decides the class, `authErrorMessage` picks the copy. `Auth error displayed to user` (Loki, module `LoginScreen`) carries the exact text shown, and (level ERROR) is the best single query for "what error did they see". It is logged by the Login screen only, not by the wrong-account screen. The `Send code failed` and `Verify code failed` warnings carry a `key` (classification) and never the address or the code.

| Shown text (verbatim) | Trigger | Notes |
| --- | --- | --- |
| "That code didn't match. Check the email and try again." | SDK error `invalid_grant` whose message does not contain "expir" | Code field is cleared. `key`: `wrongCode`. |
| "That code has expired. Tap Resend to get a new one." | `invalid_grant` whose message contains "expir" | Field cleared. `key`: `codeExpired`. Auth0 reports wrong and expired the same way; only the description differs, and the match is deliberately loose. |
| "Too many attempts. Please wait a few minutes and try again." | `too_many_attempts` (Auth0 brute-force protection) | Field cleared and the step returns to email (on the wrong-account screen, back to its prompt step). `key`: `tooManyAttempts`. |
| "We've sent several codes to that address recently. Please wait before requesting another." | `too_many_requests`, or HTTP 429 | On the email step the user stays there. If already on the code step the user stays with the typed code intact, since the code already delivered is still valid. `key`: `sendRateLimited`. |
| "We couldn't reach the sign-in service. Check your connection and try again." | Network failure: SDK type `NETWORK_ERROR`; message matching "network error" or "network request"; iOS `NSURLErrorDomain` text such as "network connection was lost" or "appears to be offline"; code `network_error` or `timeout` | Also shown for `unauthorized_client`, which means the Passwordless OTP grant is missing on the Auth0 application (tenant misconfiguration, see below). `key`: `networkError` or `passwordlessNotEnabled`. |
| "The sign-in window closed before you finished. Tap the button again and stay in the browser until it brings you back to the app." | SDK type `BROWSER_TERMINATED` (Android: the browser window was closed by a new instance of the app) | Browser methods only. A plain retry works. Also seen from Google's Play pre-launch crawler. |
| "You were signed out because your session could not be restored on this device. Please sign in again." | A forced logout (see [signed out unexpectedly](#signed-out-unexpectedly)) | Shown once on the Login screen, only if no other error is showing; cleared when the user taps a sign-in button. Log: `Showing forced-logout notice`. |
| The SDK's raw message | Anything unclassified | Fallback text is "Authentication failed" or "Login failed" when the SDK gave no message. The raw text lands in `Auth error displayed to user`. |
| Nothing | The user cancelled, or declined consent (`USER_CANCELLED`, `ACCESS_DENIED`, or a message containing "did not authorize") | INFO log only (`Auth0 operation cancelled or declined by user` or `Provider login cancelled or declined by user`). |

**`unauthorized_client` on a prod ticket.** The user sees the generic network copy. The tell is the ERROR log `Passwordless OTP grant missing on the Auth0 application — see spec 1 §3.2`. The user can do nothing; fix the Auth0 application's grant settings or escalate.

**"Code never arrives" and the network message together.** If the user saw "We couldn't reach the sign-in service" on a build older than 2026-09-30 and the tenant log has `cls` for the time, the email was sent; the 10 s SDK timeout fired first.

## Signed out unexpectedly

Every unexpected sign-out goes through one function, `performForcedLogout`. It logs ERROR `Performing forced logout after permanent refresh failure`, clears the auth state, raises the notice the Login screen shows (the "You were signed out because your session could not be restored..." line above), and clears both credential stores (ours and the SDK's keychain entry). **The device owner record is not touched**, so signing back in as the same account matches normally.

### What triggers it

The user lane (the token refresher in `app/services/auth/userTokenRefresher.ts`) classifies a refresh failure as **permanent** in exactly these cases. Anything else is treated as transient.

1. **A credentials-manager error type in the permanent list:** `NO_REFRESH_TOKEN`, `NO_CREDENTIALS`, `INVALID_CREDENTIALS`, `DPOP_KEY_MISSING`, `DPOP_KEY_MISMATCH`. A DPoP key that is gone from the Keychain after a restore or device transfer is one real-world cause.
2. **An unusable renewed token.** The SDK renewed into an access token that fails the shape check (reasons `not-jwt`, `wrong-audience`, `no-expiry`). Typical cause: an audience-less login (builds 3.12.1 to 4.1.6 shipped without the audience). Logs: ERROR `Auth0 SDK renewed into an unusable access token` (refresh path) or `Auth0 SDK returned unusable access token — signing out` (sign-in sync path), each with `reason`.
3. **A server 401 whose body code is `token_malformed`, `token_claims` or `token_signature`.** Log: ERROR `Server rejected the bearer as unusable` with `source: "server-401"`.

Logs for the decision itself: ERROR `Access token refresh failed permanently — forcing logout`. Duplicate ERROR lines are expected in the immediate-logout path.

### What does NOT trigger it

- `token_expired`, `token_invalid`, a 401 with no code, and a 503 `auth_unavailable` (JWKS timeout) never sign the user out.
- `RENEW_FAILED` and any unknown code are transient on purpose (the SDK also uses `RENEW_FAILED` for network-ish failures). The refresher logs WARN `Access token refresh failed transiently — proceeding with current token` and backs off 15 s, 60 s, 5 min, 15 min. Consequence to keep in mind: an ordinary revoked or expired refresh token may **not** sign the user out; they can stay "logged in" while requests return 401. Support seeing "the app is signed in but nothing loads" should read the 401 pattern, not expect a forced logout. (Inferred from the classification code; not observed in a ticket.)

### Timer deferral

If an attendance timer session is running (`isTimerSessionActive()`), the eject is held. Log: WARN `Refresh dead but timer is live — deferring logout`; `pendingLogout` is set. Meanwhile the user lane sends no bearer. When the timer is saved or cancelled, a reaction runs the forced logout. `pendingLogout` is in memory only, so a cold start clears it. A user who says "it signed me out right after I saved my meeting" is likely this.

### Other ways a session ends

- The user taps Logout (confirmation "Are you sure you want to log out?"), or Delete User Data (see [device owner](device-owner.md#delete-user-data)).
- `isAuthenticated` also turns false when the stored access token's expiry passes; the app is designed to refresh on the next gated request, which would turn it back on (inferred from a setup comment, not observed).
- Android clearing app data, or the DPoP key being lost, can end a session with no log. (Inferred.)

### Banners that are NOT sign-outs

These sit above every screen. The user is still signed in. Do not troubleshoot them as auth problems.

| Banner text (verbatim) | Meaning |
| --- | --- |
| "You're offline. Showing saved data." | The device interface is down. Wins over the other variants. |
| "Network issues — can't reach RecoverySky. Showing saved data." | Every failed attempt was a connect failure or timeout (dead Wi-Fi backhaul, captive portal, one bar). |
| "Network issues — your connection isn't reaching the internet. Showing saved data." | Same, and the internet oracle (a 3 s probe of 1.1.1.1 and 8.8.8.8) also failed. |
| "Connecting to RecoverySky… Your saved data is available." | Device attestation is degraded. The app opened and keeps retrying. `/config` can return 401s in this state. |
| "Maintenance in progress. Some features disabled." | Runtime maintenance. API features pause, the navigator is not gated. |

Two alerts are also not sign-outs: "Device Not Supported" (device attestation unsupported) and "Verification Rejected" (the server refused attestation). A full-screen takeover is the cold-start outage screen (`MaintenanceScreen`), not a sign-out either.

## Old app versions

The passwordless sign-in, linking and email verification JS ships as an OTA on runtime version 4.10.1. Treat as an **old build** any install that has not applied it: older native versions with other runtime versions, 4.10.1 installs before the OTA is applied, and first-launch embedded bundles. No list of old version numbers exists; "old" means pre-OTA. (Check Loki `appVersion`, which is `{version}-{update}`.)

- Old builds sign in with a **password through Universal Login** on the shared prod client. The prod rollout enabled the `email` connection but deliberately did not change the Universal Login page those builds use, so they cannot be sent a code from it.
- The password stays valid for linked database accounts for exactly this reason.
- A user already linked (a password user who later used a code) who signs in with the password on an old build gets the database user, which is the primary, so the same sub. (Inferred from how linking works.)
- Old builds ignore unknown token claims, so the identities claim is harmless to them.
- A session restored by an old build records no `loginMethod`, so it counts as "asked" by the verify-email screen on a build that has it.

## Sources

- `app/i18n/en.ts` (`loginScreen`, `wrongAccountScreen`, `common.*Banner`, `settingsScreen`)
- `app/services/auth/useAuth0Wrapper.ts`
- `app/services/auth/authErrorLogic.ts`
- `app/services/auth/loginFlowLogic.ts`
- `app/services/auth/auth0.ts`
- `app/services/auth/ownerLogic.ts`
- `app/services/auth/tokenFreshnessLogic.ts`
- `app/services/auth/userTokenRefresher.ts`
- `app/services/api/bearerRejectionLogic.ts`
- `app/services/auth/accountMethodsLogic.ts`
- `app/screens/LoginScreen.tsx`
- `app/screens/login/LoginSteps.tsx`
- `app/screens/WrongAccountScreen.tsx`
- `app/app.tsx` (`performForcedLogout`)
- `app/models/AuthenticationStore.ts`
- `app/models/helpers/setupRootStore.ts`
- `auth0/README.md`
- `docs/superpowers/specs/2026-09-12-passwordless-login-design.md` (history only; code wins)
- `docs/PROD_AUTH0_ROLLOUT.md`
