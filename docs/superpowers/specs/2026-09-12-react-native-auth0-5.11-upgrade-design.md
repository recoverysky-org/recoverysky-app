# Upgrade react-native-auth0 5.6.0 → 5.11.1 and recover Android logins interrupted by process death

**Date:** 2026-09-12
**Status:** Spec approved for the TODO queue; not started. Native change — ships only with the
next store build (see "Release" below). Queued in `TODO.md`.
**Repos touched:** `app` only. No API change; the Auth0 tenant is untouched.
**Origin:** the 2026-09-12 investigation of "The browser window was closed by a new instance of
the application" on Android sign-up. That error turned out to be a launcher relaunch (three of four
sessions were the Play pre-launch crawler; one real user on 4.8.0) and got a JS-only friendly
message (`app/services/auth/authErrorLogic.ts`, OTA). Checking the SDK for updates during that
work surfaced the two reasons for this spec.

## Why

1. **We are four minor versions behind and the latest carries security fixes.** Installed
   `react-native-auth0` 5.6.0 (2026-05-14) bundles Auth0.Android 3.15.0 and Auth0.swift 2.19.0.
   5.11.1 (2026-09-08) bundles Auth0.Android 3.21.0 and Auth0.swift 2.25.0 and its changelog lists
   "security fixes" under Fixed with no further detail. `npm audit` reports nothing for the auth0
   packages as of 2026-09-12, so there is no advisory to cite, but an auth SDK is the one dependency
   we should not let drift.
2. **5.8.0 added `resumeSession()`**, which recovers a web login when Android kills the app's
   process while the user is in the Custom Tab. Samsung One UI and Xiaomi MIUI do this readily,
   and it is most likely exactly when a user switches to their mail app for a verification code
   during sign-up. Today that login is silently lost: the app cold-starts on the callback and lands
   on the login screen with no error. We have no telemetry for this case because nothing fails
   client-side, so its frequency is unknown; the fix is cheap enough not to need a number.

What this does **not** fix: the launcher-relaunch case from the investigation. That is the
`onNewIntent` path (MainActivity is `singleTask`, so a fresh launch intent pops the tab off the
task and the SDK rejects the pending promise). The SDK's FAQ says it is "not addressable by the
react-native-auth0 library" and offers a `LaunchActivity` trampoline workaround. That is a native
change to Expo-generated files (would need a fourth config plugin) for a case that hit one real
user in 14 days and already has a working retry plus a friendly message. Out of scope; recorded
under "Non-goals" so nobody re-derives it.

## What changes

### 1. Dependency bump (native)

- `package.json`: `"react-native-auth0": "^5.4.0"` → `"^5.11.1"`. The lockfile currently pins
  5.6.0; `npm install react-native-auth0@5.11.1` updates both.
- Peer deps are unchanged (`react >= 19`, `react-native >= 0.78`); we are on React 19.1 /
  RN 0.81.5 / Expo 54.0.36.
- The Expo config plugin (`src/plugin/withAuth0.ts`, `generateCode.ts`) is **byte-identical**
  between 5.6.0 and 5.11.1 (diffed 2026-09-12), so `npm run prebuild:clean` produces the same
  `AndroidManifest.xml` / `Info.plist` edits as today: `RedirectActivity` with the
  `recoverysky-app://auth.recoverysky.app/android/live.meetingmaker.app.prod/callback` filter,
  broad scheme stripped from MainActivity. Verify with a manifest diff anyway (checklist below).
- Android: Auth0.Android 3.15.0 → 3.21.0. `androidx.browser` stays 1.2.0. The 5.11.1 Gradle fix
  (skip `kotlin-android` when AGP 9 already registered the extension) is for AGP 9; Expo 54 is on
  AGP 8, so it is a no-op for us now and a future-proofing win later.
- iOS: Auth0.swift 2.19.0 → 2.25.0, plus an explicit `SimpleKeychain 1.3.0` pod dependency.
  Minimum iOS 14 both before and after; Expo 54's floor is 15.1. `pod install` runs inside
  `prebuild:clean`.
- **`runtimeVersion` bump is mandatory** (native dependency upgraded). Bump `version` and
  `runtimeVersion` together; this is a minor (`npm run minor` → 4.11.0).

### 2. Wire `resumeSession()` into cold start (JS, but only meaningful on the new native)

Location: `app/services/auth/useAuth0Wrapper.ts`, the hook that already owns cold-start auth
hydration. Pull `resumeSession` from `useAuth0()` alongside `getCredentials` / `clearSession`.

```ts
// Recover a web login that Android process death interrupted. The native SDK
// finishes the code exchange on restart and buffers the result; this drains it.
// Android-only in effect — resolves null on iOS/web, so it is called unconditionally.
// ADDED <date>: see docs/superpowers/specs/2026-09-12-react-native-auth0-5.11-upgrade-design.md
useEffect(() => {
  resumeSession()
    .then((credentials) => {
      if (credentials) log.info("Recovered login interrupted by process death")
    })
    .catch((err) => log.warn("resumeSession failed", { error: String(err) }))
  // Runs once per mount by design — the buffer is drained on the first call.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

How it composes with what is already there, so the implementer does not add parallel plumbing:

- On recovery the SDK's provider does `saveCredentials` and dispatches `LOGIN_COMPLETE`, which
  populates the hook's `user`. Our existing "Sync Auth0 user state to MST store" effect then runs
  unchanged: it calls `getCredentials()`, applies `isUsableAccessToken()` (the 2026-09-10 opaque
  token gate), persists via `saveAuthCredentials`, and flips `authStore.isAuthenticated`, which
  is what moves `AppNavigator` off the Login gate. **No new store writes.**
- `authReady` ordering: the "Auth0 resolved without user, auth ready" effect may fire first (the
  SDK's initial Keychain check finds nothing because the interrupted login never got saved).
  That is fine: it sets `authReady`, the Login screen renders, then the recovered `user` arrives
  and the navigator re-gates to Onboarding/Main. A sub-second flash of the login screen on a
  recovered cold start is acceptable; do **not** try to hold `authReady` for `resumeSession`,
  because a hung native promise would then hold the splash forever.
- `isLoggingOut` guard: not needed. `resumeSession` only returns non-null when a login was
  actually mid-flight at process death, which cannot coincide with a logout in progress.
- Failure is logged and swallowed. Cold start must never depend on it.
- The rating engine and Umami "login_completed" event fire from `LoginScreen.handleAuthPress`
  today, so a recovered login will **not** emit `login_completed`. Accept that (it is a recovery,
  not a fresh press) and note it in `EVENTS.md` if anyone reads that counter closely.

### 3. Things to check in the tenant / SDK behavior, not code

- **5.11.0 added an IPSIE `session_expiry` ceiling with a new `SESSION_EXPIRED` error** on the
  credentials manager. Our refresher (`classifyRefreshError` in `tokenFreshnessLogic.ts`) maps
  unknown codes to `transient` on purpose, so if the tenant ever sets `session_expiry`, an expired
  session would back off forever instead of forcing re-login. Confirm the tenant does **not** set
  it (Auth0 dashboard → Settings → Advanced → session policies; default is unset). If it is set
  or ever gets set, add `SESSION_EXPIRED` → `permanent` to the classifier with a vitest case.
  Do not add the mapping speculatively; the transient default is documented as deliberate.
- **Deprecations in 5.11.1** (client-side Management API, legacy MFA methods on the auth client):
  grep confirms the app uses neither — Management API access goes through our API's proxy
  (`app/services/api/index.ts` ~line 1015). Nothing to migrate.
- `useTrustedWebActivity` (5.10.0) and passkeys/MFA additions are not adopted. See Non-goals.

## Non-goals

- **`LaunchActivity` trampoline for the `singleTask` relaunch case.** One real user in 14 days,
  retry works, friendly message shipped 2026-09-12. Revisit only if `BROWSER_TERMINATED` shows up
  in Loki from non-crawler sessions at a rate that matters (filter: `| error=~".*new instance.*"`,
  exclude sessions with `skipped on simulator` or Play Integrity `-9` binding failures).
- **Trusted Web Activity instead of Custom Tabs.** No evidence it helps any failure we see, and
  it changes how the sign-in surface looks. Not without a reason.
- **Passkeys, MFA, My Account API, actor tokens.** Product decisions, not upgrade hygiene.
- **Changing `launchMode`.** Expo's deep-link handling and the SDK FAQ both expect `singleTask`.

## Risks

- The "security fixes" line is opaque. If a CVE lands for 5.6–5.11.0 before this ships, this
  spec's priority jumps; nothing else changes.
- A native SDK bump on both platforms means the auth flow needs a full manual pass on both, not
  just the Android recovery path. The checklist below is the gate.
- `bump-version.sh` resets the OTA counter; any JS fixes in flight (including the 2026-09-12
  friendly-message change if it has not gone out as an OTA yet) ride along in the native build.

## Verification (manual, both platforms — nothing in CI runs any of this)

Automated: `npm run compile`, scoped `eslint`, `npm test`. Then `npm run prebuild:clean` and a
device build (`build:android:device:debug`, `build:ios:device`).

- [ ] `git diff` of the generated `android/app/src/main/AndroidManifest.xml` against the previous
      prebuild shows no Auth0-related change (RedirectActivity filter, MainActivity filters).
- [ ] Fresh sign-up and login on Android (device) and iOS. Logout via `clearSession`.
- [ ] **Process-death recovery (Android):** tap Sign Up → in the Custom Tab, press Home →
      `adb shell am kill live.meetingmaker.app.prod` → reopen the tab from recents and finish the
      login → app cold-starts and lands authenticated. Loki/Reactotron shows "Recovered login
      interrupted by process death" then "Auth state synced to MST store". Repeat with Login.
- [ ] **Launcher relaunch (Android):** tap Sign Up → tap the app icon from the launcher → the
      friendly "sign-in window closed" message shows and a second tap succeeds. (Confirms the
      2026-09-12 OTA change still behaves on the new SDK; the SDK's error code is unchanged.)
- [ ] **Idle renewal:** sign in, wait past the access token TTL (or advance the clock), send an
      attendance report → refresher renews via `auth0Client.getFreshCredentials`, no 401.
- [ ] iOS `ASWebAuthenticationSession` cancel → "Login cancelled by user", no error banner.
- [ ] Anonymous login unaffected.
- [ ] `runtimeVersion` matches `version` in `app.json`; `package.json` `update` is `"0"`.

## Release

Native. `npm run minor` (→ 4.11.0), manually set `runtimeVersion` to match, `npm run release:ios`
and `npm run release:android`. Changelog: `Build` entry for the SDK bump, `Added` entry for the
process-death recovery, both under the new `[4.11.0]` heading.
