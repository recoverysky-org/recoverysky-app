# Passwordless email login with direct-to-provider Apple and Google

**Date:** 2026-09-12
**Status:** Spec approved; not started. Blocked on Auth0 tenant access (MFA lockout as of this
date). Develop on a feature branch or worktree; ship only after the tenant runbook (§3) is fully
executed. JS-only on the app side — no `runtimeVersion` bump.
**Repos touched:** `app` (login screen, auth wrapper, i18n). Auth0 tenant configuration (dashboard,
not code). No API change.
**Origin:** the 2026-09-12 brainstorm on "user logs in as A, accumulates data, later logs in as B".
This is spec 1 of 2. Spec 2 (device owner record + wrong-account recovery + API link endpoint for
accounts the tenant Action cannot match by email) builds on the screens defined here and is
written separately.

## Why

1. **Passwords are the one login method whose secret lives in the user's head.** For a population
   whose phones, numbers and emails churn, a forgotten password is a lost account. An emailed
   six-digit code proves control of the inbox every time, with nothing to remember.
2. **Every login method then proves an email address**, which makes the "same person, two
   identities" problem uniform: it is always "do these two logins prove the same email?", and
   Auth0 can answer that at login time without app code (§3.5).
3. **The email path never opens a browser.** The queued
   `2026-09-12-react-native-auth0-5.11-upgrade-design.md` spec exists because Android kills the
   app while the user is in the Custom Tab, most likely when they switch to Mail for a code. An
   in-app code entry removes that whole class for the email path. Apple and Google still use the
   browser and still benefit from that upgrade.

## Decisions (settled in the brainstorm — do not re-derive)

- **Three ways in, no password field.** Continue with Email (in-app, OTP code), Continue with
  Apple, Continue with Google (browser, direct to the provider, Universal Login never shown).
  Login and sign-up are one path; the separate Sign Up button is removed.
- **Not multi-user.** One device, one owner. This spec does not touch that; spec 2 does. It is
  recorded here so the login screen is not designed as if two people share a phone.
- **The Auth0 post-login Action does the whole password migration.** An existing password (or
  Google, or non-relay Apple) user who signs in by code is linked into their existing account
  *before the token is issued*, so their first code login already returns the sub the app has
  always seen. No migration screen, no relogin, no API endpoint. Existing users never learn their
  password is now irrelevant.
- **The Action links regardless of the old account's `email_verified` flag.** ACCEPTED RISK:
  if someone had pre-registered a specific user's email with a password and never verified it,
  the code login would link the real user into that squatter's account. Requiring verification
  would not help (it proves the inbox, which the code already proved) and requiring a password
  reset was rejected as a one-time-migration aggravation the user does not deserve. We judge the
  trap far-fetched for this app. Mitigation (§3.5): the Action sets a random password on the
  linked database account, which evicts anyone else who knew it.
  CHANGED 2026-09-30 (Jenova): **no password randomisation, for now.** Old native builds and
  first-launch embedded bundles still sign in with a password through Universal Login on the
  shared prod client, so randomising would lock those users out. That removes the mitigation
  above: until randomisation returns, a squatter who knows the password keeps access. Revisit
  once old builds have aged out (the same gate as §3.7).
- **The Action links the NEW identity into exactly one existing account** (the oldest match) and
  never links two pre-existing accounts to each other — that would change a sub some device
  already treats as its owner.
- **No feature flag, no staged rollout.** The tenant runbook completes first; then the OTA ships.
  A `PASSWORDLESS_LOGIN` config flag was considered and rejected as unnecessary process.
- **Apple private relay.** An Apple user may have a per-app relay address they do not recognise.
  For that reason nothing in this design ever shows a social user "the email you used"; the
  provider name is the identifier. A relay user who types their real email into the email box
  gets a fresh account — that is spec 2's wrong-account case, not a bug here.
- **Anonymous login stays commented out**, plumbing intact, exactly as today.

## 1. Login screen (`app/screens/LoginScreen.tsx`)

One screen, three states, a local `step: "choose" | "email" | "code"`. The legal-agreements
modal (`showEuaModal`, `pendingLoginType`, the disclaimer/EULA tabs, `TERMS_ACCEPTED_KEY`) is
unchanged and gates every method exactly as it gates the two buttons today: the first tap on any
method opens the modal if terms are not yet accepted; acceptance proceeds with the pending method.

### 1.1 `choose`

Three buttons, in this order on iOS: **Continue with Apple**, **Continue with Google**,
**Continue with Email**. Apple above Google on iOS because App Store guideline 4.8 requires the
Apple button to be at least as prominent as other third-party logins. On Android the order is
Google, Apple, Email. `testID`s: `login-apple`, `login-google`, `login-email`.

**Owner-aware email button (inert until spec 2).** The screen takes an optional
`ownerEmailMasked?: string` (e.g. `j***@proton.me`) and an optional `ownerEmail?: string`. When
present and the owner's `loginMethod` is `email`, the Email button reads **"Send code to
j***@proton.me"** and tapping it skips the `email` step: it sends to `ownerEmail` and goes straight
to `code`. A small **"Use a different email"** link beneath it goes to the `email` step with an
empty field. In this spec nothing supplies those props, so the button is plain "Continue with
Email"; the props exist so spec 2 is a one-line wiring change. The masked form is what is shown,
never the full address — the device may be visible to others.

Existing copy `loginScreen:enterDetails` / `enterDetailsAndroid` stays. `loginButton` and
`signupButton` are removed with their buttons. `openingBrowser` is kept and shown only while an
Apple/Google browser flow is open.

### 1.2 `email`

- One `TextField` (`@/components`): `keyboardType="email-address"`, `autoCapitalize="none"`,
  `autoCorrect={false}`, `textContentType="emailAddress"`, `autoComplete="email"`,
  `accessibilityLabel` from i18n. `testID="login-email-field"`.
- **Send Code** button (`testID="login-send-code"`), disabled until the field contains something
  that passes a permissive syntactic check (`x@y.z`); we do not attempt real validation, Auth0 does.
- **Back** returns to `choose`.
- Tapping Send calls `sendCode(email)` (§2). On success → `code` step with the email carried in
  local state. On failure the classified message (§2.3) shows inline under the field.
- There is no "no account for that email" outcome: passwordless creates the account on first use.
  Do not add one.

### 1.3 `code`

- Header line: "We sent a code to j***@proton.me" (masked; the user typed it seconds ago, but the
  screen may be glanced at). Pure `maskEmail()` in `loginFlowLogic.ts` (§4).
- One `TextField`: `keyboardType="number-pad"`, `textContentType="oneTimeCode"`,
  `autoComplete="one-time-code"` (iOS offers the code from Mail; Android from Gmail/Messages),
  `maxLength={6}`, `accessibilityLabel` from i18n. `testID="login-code-field"`.
- **Verify** button (`testID="login-verify"`), disabled until six digits are present. Auto-submit
  the moment six digits are present, whether autofilled or typed — the bank-app convention, and
  autofill cannot be told apart from typing reliably. A mistyped digit yields `wrongCode`, which
  clears the field; brute-force protection (§3.6) bounds the cost of repeated mistakes.
- **Resend code** link: calls `sendCode(email)` again without leaving the step; disabled for
  30 s after every send, with the remaining seconds shown. Cooldown decision is pure
  (`resendAllowedAt()` in `loginFlowLogic.ts`). Auth0's own per-address send limit is stricter
  than ours over an hour; the classified `sendRateLimited` message covers that.
- **"Wrong email? Go back"** returns to `email` with the field prefilled.
- Verify calls `verifyCode(email, code)` (§2). Success: the SDK sets `user`, the wrapper's existing
  `syncUserToStore` effect populates MST and SecureStore, `AppNavigator` routes as today. Nothing
  new is written to the store from the screen.
- `wrongCode` → inline message, field cleared, focus kept. `codeExpired` → inline message with the
  Resend link highlighted. `tooManyAttempts` / `sendRateLimited` → message, then back to `email`
  (the only remedy is waiting; keeping the user on `code` invites more failed attempts and a lockout).

### 1.4 Apple / Google

Call `loginWithProvider("apple")` / `loginWithProvider("google-oauth2")` (§2). While the browser is
open, the existing `openingBrowser` loading text shows. Cancel, `BROWSER_TERMINATED` and network
outcomes are exactly today's (`authErrorLogic.ts` + `loginScreen:errorBrowserTerminated` /
`errorNetwork`). No Sign in with Apple native capability is needed — the flow is Auth0's web
authorize with the connection preselected, as today, minus the Universal Login page.

### 1.5 Structure

The three states are three small components in the same file (`ChooseStep`, `EmailStep`,
`CodeStep`), each taking callbacks and no store access, so the jest test can mount them with the
wrapper mocked. The screen remains the `observer` shell that owns `step`, the email/code local
state, the legal modal, and the wrapper hook. The file is already 641 lines; if it crosses ~800
after this, split the steps into `app/screens/login/`.

## 2. Auth wrapper (`app/services/auth/useAuth0Wrapper.ts`)

The only file that talks to `react-native-auth0`; that stays true. `login` and `signup` are
removed from `UseAuth0WrapperResult`. Three calls are added:

### 2.1 `sendCode(email: string): Promise<void>`

Wraps `sendEmailCode({ email, send: "code" })` from `useAuth0()`. Rejects with the raw SDK error;
the screen classifies it (§2.3). Logs `Passwordless code sent` with no email (see "Identifiers in
logs" in `docs/DIAGNOSTICS.md`; the address is PII and never logged).

### 2.2 `verifyCode(email: string, code: string): Promise<void>`

Wraps `authorizeWithEmail({ email, code, audience: AUTH0_CONFIG.audience,
scope: AUTH0_CONFIG.scopes.join(" ") })`.

**The `audience` is load-bearing.** Without it Auth0 issues an opaque access token, the existing
`isUsableAccessToken()` check in `syncUserToStore` rejects it, and the user is signed out one tick
after signing in (see the 2026-09-10 opaque-token spec). `offline_access` in the scope string is
what yields the refresh token that keeps the session alive across cold starts. Both values are
the same ones `authorize()` passes today; add a comment at the call site pointing here.

The SDK's `authorizeWithEmail` runs through its internal `loginFlow` (verified in
`lib/module/hooks/Auth0Provider.js`): it saves credentials to the CredentialsManager and dispatches
`LOGIN_COMPLETE`, which sets `user`. The wrapper's existing `useEffect` on `user` then does
everything it does for a browser login. No new store plumbing.

### 2.3 `loginWithProvider(connection: "apple" | "google-oauth2"): Promise<void>`

Today's `login()` body with `connection` added to the `authorize` parameters. The `cancelWebAuth`
pre-call, `USER_CANCELLED` swallow, and `displayMessageFor` mapping stay.

### 2.4 `loginMethod` (AuthenticationStore, persisted)

New MMKV-persisted prop `loginMethod: "email" | "apple" | "google" | undefined` on
`AuthenticationStore`, set by the wrapper when a session is established (`sendCode`/`verifyCode`
→ `email`; `loginWithProvider` → by connection). Cleared by `logout()`. Two consumers:

- **Logout branch (this spec).** `clearSession()` opens the browser to end the Auth0 cookie
  session and, on iOS, shows the system "Sign In" dialog. An email session never created a browser
  session, so for `loginMethod === "email"` logout calls `clearCredentials()` and skips the
  browser. Without this branch every email user gets a pointless browser bounce and an iOS dialog
  on sign-out. Social sessions keep today's `clearSession` path unchanged, including the
  cancel-aborts-logout behaviour.
- **Owner record (spec 2).** The device owner record copies `loginMethod` so the wrong-account
  screen knows whether to send a code or show a provider button.

### 2.5 Error classification (`authErrorLogic.ts`, pure, vitest)

`classifyAuthError()` gains passwordless outcomes. The SDK surfaces Authentication API failures
as `AuthError` with `code` / `message` from Auth0's response. Map, in this order:

| Auth0 response | classification | i18n key |
| --- | --- | --- |
| `invalid_grant` on `authorizeWithEmail` (Auth0's message is "Wrong email or verification code.") | `wrongCode` | `loginScreen:errorWrongCode` |
| `invalid_grant` whose description mentions expiry | `codeExpired` | `loginScreen:errorCodeExpired` |
| `too_many_attempts` (brute-force protection tripped) | `tooManyAttempts` | `loginScreen:errorTooManyAttempts` |
| HTTP 429 / `too_many_requests` on `sendEmailCode` | `sendRateLimited` | `loginScreen:errorSendRateLimited` |
| `unauthorized_client` on `authorizeWithEmail` | `passwordlessNotEnabled` | `loginScreen:errorNetwork` (shown to the user as a generic failure; logged at `error` level because it means the tenant runbook §3.2 was not done) |
| existing `networkError` / `browserTerminated` | unchanged | unchanged |

Exact `code`/`message` strings for the first two rows must be confirmed against the tenant when
access returns (§6); the table records the documented values.

### 2.6 Analytics

`trackEvent("login_completed", { method })` keeps its name; `method` gains `"email" | "apple" |
"google"` (today: `"oauth" | "anonymous"`). Add `trackEvent("login_code_sent")` with no
properties, so send-vs-complete funnel drop-off (deliverability) is visible in Umami.

## 3. Tenant runbook (Auth0 dashboard — execute in full before the OTA ships)

All of this is configuration, not code. The new screen calls these endpoints on its first tap;
none of it can be rehearsed until tenant access is restored. Run against the **dev application**
first, verify the manual checklist (§4.3), then repeat on production.

1. **Passwordless email connection.** Authentication → Passwordless → Email. Mode **OTP** (not
   magic link — links open in browsers and get eaten by mail clients), 6 digits, default 180 s
   lifetime. Enable for the mobile application. Leave sign-ups enabled (first use creates the
   account).
2. **Application grant types.** Applications → (mobile app) → Advanced → Grant Types: add
   **Passwordless OTP** alongside Authorization Code and Refresh Token. Missing this yields
   `unauthorized_client` on verify (§2.5, last row).
3. **Social connections.** Confirm Google (`google-oauth2`) and Apple (`apple`) are enabled for the
   mobile application. They are today's connections, reached by name instead of via the login page.
4. **Email delivery.** Branding → Email Provider → Postmark (API token; transactional stream,
   separate from the blog/marketing streams). SPF, DKIM, DMARC on the sending domain. Customise
   the **Verification Code** template: code in the subject line, short plain body, no images.
   Deliverability is now an auth dependency: a code in spam is a failed login. Alert on Postmark
   bounce rate.
5. **Post-login Action "Link passwordless identity into existing account".** Trigger: Login /
   Post Login. Logic:
   - Return immediately unless `event.connection.strategy === "email"` and
     `event.user.identities.length === 1` (already-linked users arrive with >1 identity — this is
     the idempotency guard). Consequence: an email user with no match to link stays at one identity
     and costs one Management API lookup per login. Acceptable; do not add a "checked" flag to
     app_metadata to avoid it — a match that appears later (user later signs in with Google) should
     still be found.
   - Management API `GET /api/v2/users-by-email?email=<event.user.email>`; drop `event.user`
     itself; keep candidates whose connection strategy is `auth0` (database), `google-oauth2`, or
     `apple`; pick the **oldest `created_at`**. No candidate → return (fresh account; spec 2's
     wrong-account screen handles a device that belongs to someone else).
   - `POST /api/v2/users/{primary.user_id}/identities` with `{ provider: "email",
     user_id: <event.user.user_id minus the "email|" prefix> }`.
   - If `primary` is a database user: `PATCH /api/v2/users/{primary.user_id}` with a random
     32-character password (see ACCEPTED RISK in Decisions). Passwords are being retired; the user
     never types it again.
     CHANGED 2026-09-30: **skip this step for now.** Old builds still use password login on the
     shared prod client (see Decisions). Without the PATCH, the Action needs only `read:users` +
     `update:users` for the link itself.
   - `api.authentication.setPrimaryUser(primary.user_id)` so the token for **this** login carries
     the primary's sub.
   - On any Management API failure: log and return without linking (the user gets a fresh account
     this login; the guard above means the next login retries). Never `api.access.deny` — a
     linking hiccup must not lock anyone out.
   - Secrets: Management API M2M client id/secret. Reuse the client the API already uses
     (`AUTH_MGMT_CLIENT_ID`) and add scopes `read:users`, `update:users` (linking and the password
     PATCH both require `update:users`).
6. **Attack protection.** Security → Attack Protection: Brute-force Protection **on** (this is what
   caps code guesses → `too_many_attempts`). Note the tenant's passwordless send limit so the
   in-app `sendRateLimited` copy matches reality.
7. **Retire password login — last, and only after checking.** Do **not** delete the database
   connection; the Action reads it and it holds the migrated accounts. Remove it from the
   **mobile application's** enabled connections only after confirming no other application on the
   tenant (web app, community/Agora site) still signs users in with a password.

## 4. Testing

Runner split per CLAUDE.md: `.test.ts` → vitest (pure only, no `@/` runtime imports),
`.test.tsx` → jest-expo.

### 4.1 Vitest

- `authErrorLogic.test.ts`: one case per row of §2.5, plus "unknown code stays unclassified".
- `loginFlowLogic.test.ts` (new pure module `app/services/auth/loginFlowLogic.ts`):
  - `maskEmail("jenova@proton.me") === "j***@proton.me"`; single-char local part; missing `@`
    returns the input unchanged.
  - `resendAllowedAt(lastSentAt, now)` → cooldown boundary at exactly 30 s.
  - `nextStep(step, event)` step transitions, including `tooManyAttempts` / `sendRateLimited`
    returning to `email`.
  - `isPlausibleEmail()` permissive check.

### 4.2 Jest

`LoginScreen.test.tsx` with `useAuth0Wrapper` mocked: each step renders its `testID`s; the
Email/Code fields carry the autofill props (`textContentType`, `autoComplete`); the Send button is
disabled on an empty field; the owner-aware button renders the masked form when `ownerEmailMasked`
is supplied and plain "Continue with Email" otherwise.

### 4.3 Manual checklist (dev application, after §3)

- Code autofills from Mail on iOS and from Gmail on Android; six autofilled digits auto-submit.
- Wrong code → inline message, stays on `code`. Expired code (wait >3 min) → message, Resend works.
- Resend disabled 30 s after each send; Auth0's send limit produces `sendRateLimited` and returns
  to `email`.
- Existing **password** user signs in by code → same sub as before (check the hashed `userId` in
  the sign-in log line matches the pre-migration one), attendance/profile intact, no prompt.
- Existing **Google** user types their Gmail into the email box → lands in the Google account.
- Apple and Google buttons open the provider directly; Universal Login never appears.
- Sign out after an email session: no browser, no iOS dialog, lands on `choose`.
- Sign out after a social session: unchanged from today.
- Cold start after each method restores the session (SecureStore + SDK CredentialsManager).
- `isUsableAccessToken` passes on the code-issued token (no "unusable access token" log line).

## 5. Rollout and paperwork

- **Branch.** Feature branch or worktree off `root`. Nothing merges until §3 is complete on the
  production tenant; the screen is unusable before that.
- **Release.** JS-only → OTA via `npm run update`. **No `runtimeVersion` bump.** If the 5.11
  upgrade spec ships first (native), this rides on top of it as an OTA; if not, order does not
  matter.
- **i18n.** New keys in all nine locale files (`en` authoritative; English placeholders in the
  other eight + a line in `docs/translation-review-2026-08-03.md`):
  `loginScreen:continueWithEmail`, `continueWithApple`, `continueWithGoogle`, `sendCodeTo`
  (`"Send code to {{email}}"`), `useDifferentEmail`, `emailLabel`, `emailPlaceholder`, `sendCode`,
  `codeSentTo` (`"We sent a code to {{email}}"`), `codeLabel`, `verify`, `resendCode`,
  `resendIn` (`"Resend in {{seconds}}s"`), `wrongEmailGoBack`, `back`, `errorWrongCode`,
  `errorCodeExpired`, `errorTooManyAttempts`, `errorSendRateLimited`. Removed:
  `loginButton`, `signupButton`.
- **CHANGELOG.** Added: passwordless email login; Apple/Google buttons that open the provider
  directly. Changed: sign-out for email sessions no longer opens a browser. Removed: Sign Up
  button (sign-up and login are one path).
- **CLAUDE.md.** "Auth, Attestation & Encryption Keys" §1: three methods, `loginMethod`, the
  logout branch, and a pointer to this spec. "Environment Variables": unchanged.
- **Cross-reference.** Add a note to
  `2026-09-12-react-native-auth0-5.11-upgrade-design.md` that its "switch to Mail for a code"
  scenario now applies only to the Apple/Google buttons.

## 6. Verify when tenant access returns (before implementation starts)

- Exact `code` / `message` values Auth0 returns for wrong and expired OTP codes (§2.5 rows 1–2).
- The tenant's passwordless send-limit numbers (§3.6) so `errorSendRateLimited` copy is truthful.
- Whether the mobile application already has Google and Apple enabled (§3.3) — assumed yes.
- Which other applications on the tenant use the database connection (§3.7).
- Count of existing database users with `email_verified: false` — informational only, given the
  accepted risk; it sizes how many accounts the random-password sweep will touch.

## Non-goals

- Device ownership, the wrong-account screen, the API link endpoint for accounts that differ by
  email (Apple relay, work-vs-personal, typos): **spec 2**.
- SMS codes. The SDK supports them; nothing here precludes adding a phone path later.
- Passkeys. Weaker fit for a population that loses devices; revisit when synced passkeys are
  boring.
- Native Sign in with Apple (`ASAuthorizationController`) with Auth0 token exchange. Nicer sheet,
  but a native dependency and a runtimeVersion bump for a path that works today via the browser.
- A "sign in with password instead" fallback on the main screen. Rejected: the Action makes it
  unnecessary for verified and unverified accounts alike.
