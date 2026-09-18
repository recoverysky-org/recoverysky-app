# Next native build (4.11.0): native dependency refresh + Android login recovery

**Date:** 2026-09-12
**Status:** Spec approved for the TODO queue; not started. Every item here changes the
native shape of the app, so none of it can ride an OTA — it all ships together in the
next store build (see "Release" below). Queued in `TODO.md` under "Next native build".
**Repos touched:** `app` only. No API change; the Auth0 tenant is untouched.
**Supersedes:** `2026-09-12-react-native-auth0-5.11-upgrade-design.md` (folded in as §A).

**Origin.** Two 2026-09-12 threads landed on the same conclusion:

1. The investigation of "The browser window was closed by a new instance of the
   application" on Android sign-up. That error turned out to be a launcher relaunch
   (three of four sessions were the Play pre-launch crawler; one real user on 4.8.0) and
   got a JS-only friendly message (`app/services/auth/authErrorLogic.ts`, OTA). Checking
   the SDK for updates during that work surfaced the two reasons for §A.
2. The routine dependency review that shipped the JS-only set on `chore/deps-2026-09-12`
   (commit `7c76118`). It deliberately left every native-module bump behind — §B and §C —
   because per CLAUDE.md a native dependency upgrade means a `runtimeVersion` bump, and a
   `runtimeVersion` bump means a store build. Batching them into one build is the whole
   point of this document.

## Why one build

The rule in CLAUDE.md ("Runtime Version & OTA Updates") is the constraint: an OTA only
reaches users whose installed binary advertises a matching `runtimeVersion`, and any
native change forces a new one. Cutting a store build per native bump would strand OTA
series behind each one. So native changes queue here and go out as a single minor
(`npm run minor` → 4.11.0) with one manual test pass on both platforms.

## Scope at a glance

| # | Package | From → To | Why it is in this build |
|---|---------|-----------|-------------------------|
| A | `react-native-auth0` | 5.6.0 → 5.11.1 | Unspecified "security fixes"; `resumeSession()` recovers Android logins killed mid-Custom-Tab |
| B1 | `expo` | 54.0.36 → 54.0.37 | `expo install --check` alignment; Android `expo-fetch` chunk-ordering race fix; faster `TextDecoder` |
| B2 | `expo-updates` | 29.0.19 → 29.0.20 | Alignment; rejects update assets whose key/extension contains a path separator (OTA pipeline hardening) |
| B3 | `expo-file-system` | 19.0.23 → 19.0.24 | Alignment only; the one fix (iOS `copyAsync` on edited `ph://` assets) does not affect us |
| C | `@maplibre/maplibre-react-native` | 11.3.6 → 11.3.10 | Android: two map ANR deadlocks + camera NPE fixed; iOS: heap corruption in style-image loading, GeoJSON source recycling, NaN edge insets |
| D | *(new config plugin)* `withAuth0LaunchTrampoline` | — | Android: a launcher-icon tap during sign-in no longer kills the Custom Tab (RS-005). Added 2026-09-15 — was a §A non-goal; see §D for why that changed |

Not in this build, on purpose: `@sentry/react-native` 8.x, React Native 0.87, Expo SDK 57,
`react-native-mmkv` 4, `react-native-purchases` 10, and the other majors from the
2026-09-12 review. Each is its own upgrade project with its own spec. The Sentry bump is
tracked separately under TODO.md "Background-ANR hygiene" and may be pulled in if someone
scopes it before this build is cut — it is a native dep, so it would need to be here or
in the build after, never an OTA.

---

## §A. `react-native-auth0` 5.6.0 → 5.11.1 and Android process-death login recovery

### Why

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

   NOTE 2026-09-17: with passwordless login (spec
   `2026-09-12-passwordless-login-design.md`) the email path never opens a
   browser, so this scenario — a Custom Tab killed mid-login while the user
   is in their mail app for a code — now applies only to the Apple and
   Google buttons, which still go through `authorize()`.

What this does **not** fix: the launcher-relaunch case from the investigation. That is the
`onNewIntent` path (MainActivity is `singleTask`, so a fresh launch intent pops the tab off the
task and the SDK rejects the pending promise). The SDK's FAQ says it is "not addressable by the
react-native-auth0 library" and offers a `LaunchActivity` trampoline workaround. That is a native
change to Expo-generated files (would need a fourth config plugin) for a case that hit one real
user in 14 days and already has a working retry plus a friendly message. Out of scope; recorded
under "Non-goals" so nobody re-derives it.
CHANGED 2026-09-15: that trampoline is now **§D of this build**. The paragraph above is kept
because it is still an accurate account of what `resumeSession()` covers; what changed is the
"one real user" arithmetic — see §D "Why" for the passwordless-email argument.

### A1. Dependency bump (native)

- `package.json`: `"react-native-auth0": "^5.4.0"` → `"^5.11.1"`. The lockfile currently pins
  5.6.0; `npm install react-native-auth0@5.11.1` updates both.
- Peer deps are unchanged (`react >= 19`, `react-native >= 0.78`); we are on React 19.1 /
  RN 0.81.5 / Expo 54.0.36 (54.0.37 after §B).
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

### A2. Wire `resumeSession()` into cold start (JS, but only meaningful on the new native)

Location: `app/services/auth/useAuth0Wrapper.ts`, the hook that already owns cold-start auth
hydration. Pull `resumeSession` from `useAuth0()` alongside `getCredentials` / `clearSession`.

```ts
// Recover a web login that Android process death interrupted. The native SDK
// finishes the code exchange on restart and buffers the result; this drains it.
// Android-only in effect — resolves null on iOS/web, so it is called unconditionally.
// ADDED <date>: see docs/superpowers/specs/2026-09-12-next-native-build-design.md §A2
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

### A3. Things to check in the tenant / SDK behavior, not code

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

### A. Non-goals

- ~~**`LaunchActivity` trampoline for the `singleTask` relaunch case.**~~ MOVED to §D on
  2026-09-15. The original bar was "revisit only if `BROWSER_TERMINATED` shows up from
  non-crawler sessions at a rate that matters"; the rate question was answered by a product
  decision (passwordless email sign-in) rather than by Loki — see §D.
- **Trusted Web Activity instead of Custom Tabs.** No evidence it helps any failure we see, and
  it changes how the sign-in surface looks. Not without a reason.
- **Passkeys, MFA, My Account API, actor tokens.** Product decisions, not upgrade hygiene.
- **Changing `launchMode`.** Expo's deep-link handling and the SDK FAQ both expect `singleTask`.

---

## §B. Expo SDK 54 patch alignment: `expo`, `expo-updates`, `expo-file-system`

### Why

`npx expo install --check` has asked for these three since the 2026-09-12 review (all three
were published to npm 2026-09-11). They are patch releases inside SDK 54 — no API change, no
config-plugin change, no new permissions — but each contains native code, so they are
`runtimeVersion`-gated exactly like a major would be. Taking them here keeps the "expected
version" nag out of every future `expo install` run and picks up three small fixes:

- **`expo` 54.0.37** — Android `expo-fetch` had a race that could deliver the first response
  chunks out of order. We use `expo/fetch` for streaming (the Sky agent's `useChat` transport
  and the OTLP logger's flush both go through fetch); we have not seen a symptom, but an
  out-of-order first chunk is the kind of bug that would look like a flaky agent stream. Also a
  rewritten `TextDecoder` (performance only).
- **`expo-updates` 29.0.20** — the updates client now rejects an update whose asset key or file
  extension contains a path separator. Pure hardening of the OTA download path; it should never
  trigger for our EAS-published bundles, and if it ever does that is a signal, not a regression.
  Also an iOS build-phase tweak (`always_out_of_date` on "Generate updates resources") that
  only affects Xcode incremental builds.
- **`expo-file-system` 19.0.24** — one fix, iOS `copyAsync` on `ph://` Photos assets with
  edits. We never copy from the Photos library (journal export reads a SQLite file; the
  90-in-90 certificate writes its own PDF). Taken for alignment only.

### What changes

- `package.json`: `"expo": "~54.0.36"` → `"~54.0.37"`, `"expo-updates": "~29.0.19"` →
  `"~29.0.20"`, `"expo-file-system": "~19.0.23"` → `"~19.0.24"`. Use
  `npx expo install expo@~54.0.37 expo-updates@~29.0.20 expo-file-system@~19.0.24` so Expo
  writes the tilde ranges it expects; then `npx expo install --check` must come back clean
  (only the four `expo.install.exclude` entries skipped).
- `npm run prebuild:clean` regenerates `ios/` and `android/`. Expect Podfile.lock movement for
  `EXUpdates`, `ExpoFileSystem`, `Expo`; expect **no** manifest or Info.plist change (verify —
  checklist).
- Nothing in app code changes. If `npm run compile` flags anything after the bump, that is a
  type-only change in a patch release and worth a line in the changelog, not a spec revision.

### Risk

Low. The one thing to actually watch is §B2: after the store build is live, the **first OTA on
top of it** is the real test that the new updates client still accepts our bundles. Publish a
trivial OTA promptly after release rather than letting the first one carry a big change.

---

## §C. `@maplibre/maplibre-react-native` 11.3.6 → 11.3.10

### Why

The In-Person map (see CLAUDE.md "In-Person Map") is a MapLibre GL surface inside a segment that
mounts and unmounts as the user toggles list/map and switches Meetings segments. Four patch
releases since we pinned 11.3.6 (2026-06-25) fix exactly that class of lifecycle bug:

- **11.3.8 (Android):** two map ANR deadlocks and a camera `NullPointerException`. TODO.md's
  "Background-ANR hygiene" section attributes our 4.5.0 ANRs to Sentry instrumentation and the
  idle Looper, not the map — but a map-side deadlock would be indistinguishable in Play vitals
  without a stack, and the In-Person map did not exist when that analysis was done (it shipped
  2026-08-07). Taking the fix removes a candidate cause before anyone has to bisect it.
- **11.3.9 (iOS):** style-image loading serialisation to prevent **heap corruption**. We load
  style images (venue pins) on every map mount. Heap corruption is the crash that shows up as a
  random unrelated stack later, so this one is worth the bump on its own.
- **11.3.10 (iOS):** `GeoJSONSource` recycling. Our venues layer is a GeoJSON source rebuilt from
  `inPersonMapLogic.ts` features on each result set.
- **11.3.8 (iOS):** NaN edge insets from clipped padding on a zero-sized map view — plausible
  during our `display: "none"` segment hiding while the map subtree tears down on `visible`
  going false.
- **11.3.9 (Android):** Kotlin plugin configuration with AGP's built-in support. Like the auth0
  Gradle fix, a no-op on AGP 8 and future-proofing for the SDK 57 move.
- 11.3.7 is a log-tag rename only.

### What changes

- `package.json`: `"@maplibre/maplibre-react-native": "^11.3.6"` → `"^11.3.10"`. Plain
  `npm install @maplibre/maplibre-react-native@11.3.10`.
- No JS API change across 11.3.x. `InPersonMapView.tsx` and `inPersonMapLogic.ts` are untouched.
  `InPersonMapView.web.tsx` stays the required stub (the two `TurboModuleRegistry.getEnforcing`
  call sites at module scope are still there in 11.3.10 — checked 2026-09-12).
- The privacy posture from the map spec is unchanged: still `NativeUserLocation` for the puck,
  never `UserLocation`; `getSearchCenter` remains the one sanctioned reader of `coordsRef`.
  A version bump is the moment someone "helpfully" swaps components — the checklist rechecks it.
- Native tile SDKs: the RN package's pinned MapLibre Native versions may move with these
  patches. Podfile.lock / Gradle output will say; there is nothing for us to configure.

### Risk

Low-moderate, only because the map is the one surface where a native regression would be
visual rather than a crash (pins missing, wrong camera fit). The manual checklist covers the
three states that matter: first open, segment switch away and back, and dark/light style swap.

---

## §D. `withAuth0LaunchTrampoline` — Android launcher tap no longer kills the sign-in tab

ADDED 2026-09-15. Tracks **RS-005** (`git.rso` app#4). Android only; iOS has no equivalent
failure (`ASWebAuthenticationSession` is not an activity in our task).

### Why

**Root cause, confirmed from the SDK source, not inferred.** `A0Auth0Module.onNewIntent`
(`react-native-auth0/android/.../A0Auth0Module.kt`, 5.6.0 line 544 — unchanged through 5.11.1)
rejects any pending web-auth promise with `a0.session.browser_terminated` on **any** new intent
reaching `MainActivity`. `MainActivity` is `singleTask` (Expo default; §A Non-goals explains why
it stays). A launcher-icon tap while the Custom Tab is open therefore does two things at once:
Android clears every activity above `MainActivity` in the task (the Custom Tab and Auth0's
`AuthenticationActivity` are both in our task, so the tab vanishes) and delivers the launch
intent via `onNewIntent`, which the SDK turns into the error. Nothing else can be the trigger:
the Auth0 callback URI is owned by `RedirectActivity` and the plugin already stripped the broad
`recoverysky-app` scheme from `MainActivity` (it keeps only `exp+recoverysky-app`); push taps
require a signed-in user. So this is a user coming *back to the app by tapping its icon* —
which is exactly what "one user tried seven times in four minutes" looks like, and what the
Play pre-launch crawler does.

**Why the 2026-09-12 non-goal no longer holds.** The bar was "one real user in 14 days". That
was measured on Universal Login with password sign-up, where nobody has a reason to leave the
Custom Tab. The recorded auth direction (spec `2026-09-12-passwordless-login-design.md`,
memory `auth-direction-passwordless-email`) is **email-code sign-in**: every sign-up and every
sign-in on a device without a stored session sends the user to their mail app for a code, and a
large share of them come back by tapping the RecoverySky icon rather than via Recents. On
passwordless this error is not an edge case; it is the default path failing for anyone who
doesn't know the Recents gesture. The trampoline has to be in the binary **before** passwordless
ships as an OTA on top of it, and 4.11.0 is the last native build before that.

Also relevant, found on 2026-09-15: the RS-005 fingerprint (`module="LoginScreen" |
error=~".*closed by a new instance.*"`) went blind on 4.10.1-1, because `LoginScreen` logs the
*displayed* message and that became the friendly copy. The raw SDK text still lands in
`useAuth0Wrapper`'s `Auth0 signup failed` / `Auth0 login failed` lines. Re-point the fingerprint
to `module="useAuth0Wrapper"` (a `recoverysky-loki` task; the master record carries the note) —
otherwise this build's fix can never be seen to work.

### How it works

Auth0's FAQ ("Auth0 web browser gets killed when going to the background on Android") is the
reference. The idea: the launcher no longer targets `MainActivity`. It targets a throwaway
`LaunchActivity` in `standard` launch mode. When the app's task already exists, Android brings
the task forward and stacks `LaunchActivity` on top of whatever is there — the Custom Tab
included — and `LaunchActivity` simply `finish()`es, revealing the tab. No intent ever reaches
`MainActivity`, so `onNewIntent` never fires and the tab is never cleared. On a true cold start
`LaunchActivity` is the task root, starts `MainActivity`, and finishes.

Two deliberate departures from the FAQ text:

1. **`isTaskRoot()` instead of `MainApplication` back-stack bookkeeping.** The FAQ tracks
   `MainActivity`'s existence in a list on the `Application`. `isTaskRoot()` answers the same
   question ("is there already a task with our activities in it?") without touching
   `MainApplication.kt` or `MainActivity.kt`, so the plugin edits one generated file fewer and
   cannot drift from an Expo template change to either. `singleTask` `MainActivity` launched
   from `LaunchActivity` joins `LaunchActivity`'s task (same affinity), so after the trampoline
   finishes on cold start the task is `[MainActivity]`, exactly as today.
2. **Forward the launch intent on cold start.** `expo-notifications` opens the app from a
   notification with `getLaunchIntentForPackage()` plus the response in extras
   (`ExpoHandlingDelegate.openAppToForeground`); on a cold start it reads those extras from the
   activity's intent. When the app is already running the response is delivered in-process
   (`NotificationForwarderActivity` → `NotificationsService` → `NotificationsEmitter`) and the
   launch intent is only there to bring the task forward, which is the case where we finish
   without forwarding. So: **root → `startActivity(Intent(this, MainActivity::class.java).apply
   { action = intent.action; data = intent.data; intent.extras?.let(::putExtras) })`; not
   root → `finish()` only.** Verify both notification cases in the checklist.

### D1. The plugin (`plugins/withAuth0LaunchTrampoline.ts`)

Same shape as the other four: `withDangerousMod("android")` to write a file, `withAndroidManifest`
to edit the manifest. Register it in `app.config.ts` after `withRestrictedResizability`.

- **Write `android/app/src/main/java/<package path>/LaunchActivity.kt`** (package from
  `config.android.package`, i.e. `live.meetingmaker.app.prod`):
  `class LaunchActivity : Activity()` whose `onCreate` does the root/not-root branch above and
  `finish()`es unconditionally. No layout, no `setContentView`. Kotlin, matching the Expo
  template's `MainActivity.kt`.
- **Manifest:** add `<activity android:name=".LaunchActivity" android:exported="true"
  android:theme="@style/Theme.App.SplashScreen">` carrying the `MAIN` + `LAUNCHER` intent-filter,
  and **remove** that filter from `.MainActivity` (leave its `VIEW exp+recoverysky-app` filter
  alone). Same splash theme so a cold start is visually identical — `LaunchActivity` is on
  screen for one frame with the splash drawable, then `MainActivity` draws the same drawable.
  Do **not** give `LaunchActivity` `noHistory` or `excludeFromRecents`; `finish()` handles it and
  those flags change Recents behaviour.
- Nothing about `launchMode`, `taskAffinity`, or `RedirectActivity` changes. The plugin must be
  idempotent (prebuild runs it on a fresh tree, but guard the manifest edit with a "filter
  already on LaunchActivity" check like `withUsesFeatures` does for its entries).

### D2. Things that reach the app through the launcher intent (audit, 2026-09-15)

| Caller | Path | After §D |
|---|---|---|
| Home-screen / drawer icon, Play "Open" | `MAIN`/`LAUNCHER` | `LaunchActivity` — the whole point |
| expo-notifications tap, app cold | `getLaunchIntentForPackage` + extras | `LaunchActivity` is root → forwards extras → `MainActivity` reads them (departure 2) |
| expo-notifications tap, app running | same intent, but response already emitted in-process | `LaunchActivity` not root → `finish()`; task comes forward with the response already delivered |
| Auth0 callback | `RedirectActivity` (`recoverysky-app://auth.recoverysky.app/android/…/callback`) | untouched |
| `exp+recoverysky-app://` dev-client links | `MainActivity` `VIEW` filter | untouched |
| App shortcuts, widgets, App Links (`https`) | none declared | n/a |

If a future feature adds an `https` App Link or a shortcut, it targets `MainActivity` directly
and does not go through the trampoline — that is fine, but such an intent **will** re-trigger
the SDK rejection if it arrives mid-sign-in. Don't add a launcher-style shortcut without
pointing it at `LaunchActivity`.

### D3. Risk

Moderate, and concentrated in one place: the manifest edit is the first plugin that *moves*
an Expo-generated intent-filter rather than adding to the manifest, so a future Expo template
change to `MainActivity`'s filters could leave two `LAUNCHER` filters (two icons in the drawer —
loud, not subtle) or none (app not launchable — the Play review catches that). The prebuild
manifest diff in the checklist is the gate. Runtime risk is low: the only behaviour the
trampoline changes is what happens when the launcher intent finds an existing task, and today
that behaviour is the bug.

---

## Cross-cutting risks

- The auth0 "security fixes" line is opaque. If a CVE lands for 5.6–5.11.0 before this ships,
  §A's priority jumps and it may go out alone; nothing else in this document changes.
- Three native SDK bumps on both platforms means the **full** manual pass below, not just the
  Android login recovery path. Nothing in CI exercises any of it.
- `bump-version.sh` resets the OTA counter; any JS fixes in flight (including the 2026-09-12
  friendly-message change and the `chore/deps-2026-09-12` refresh if either has not gone out
  as an OTA yet) ride along in the native build. Cut the changelog accordingly.
- Config-plugin edits are **not** part of this build. If one sneaks in, remember
  `expo run:*` will silently reuse the stale `ios/` / `android/` — `prebuild:clean` is
  mandatory anyway (CLAUDE.md "Expo Config").
  CHANGED 2026-09-15: §D **is** a config-plugin edit, so the warning now applies for real:
  `expo run:android` after adding the plugin will build the old manifest and the trampoline
  will silently not exist. `prebuild:clean` first, every time, and check the manifest diff.

## Verification (manual, both platforms — nothing in CI runs any of this)

Automated first: `npm run compile`, scoped `eslint` on touched files, `npm test`,
`npx expo install --check` (clean), `npm run lint:deps` (still exactly the pre-existing 47
undeclared-package errors — `@expo/vector-icons`, `dotenv`, `expo-constants` — and no new ones).
Then `npm run prebuild:clean` and a device build on each platform
(`build:android:device:debug`, `build:ios:device`).

**Build shape**
- [ ] `git diff` of the generated `android/app/src/main/AndroidManifest.xml` against the previous
      prebuild shows no Auth0-related change (RedirectActivity filter, MainActivity filters) and
      no new permissions or `uses-feature` entries from any of the five packages.
      CHANGED 2026-09-15 for §D: the **one** expected Auth0-adjacent change is the `MAIN`/`LAUNCHER`
      filter moving from `.MainActivity` to a new `.LaunchActivity`. Exactly one `LAUNCHER`
      filter in the whole manifest; `.MainActivity` keeps its `VIEW exp+recoverysky-app` filter;
      `RedirectActivity` byte-identical. `LaunchActivity.kt` exists under the package path.
- [ ] `ios/Podfile.lock` diff lists only the expected pods moving: `Auth0` / `SimpleKeychain`
      (§A), `EXUpdates` / `ExpoFileSystem` / `Expo*` (§B), `MapLibre` (§C).
- [ ] `runtimeVersion` matches `version` in `app.json` (`4.11.0`); Android `versionCode` is
      `41100000`; `package.json` `update` is `"0"`.

**§A — auth**
- [ ] Fresh sign-up and login on Android (device) and iOS. Logout via `clearSession`.
- [ ] **Process-death recovery (Android):** tap Sign Up → in the Custom Tab, press Home →
      `adb shell am kill live.meetingmaker.app.prod` → reopen the tab from recents and finish the
      login → app cold-starts and lands authenticated. Loki/Reactotron shows "Recovered login
      interrupted by process death" then "Auth state synced to MST store". Repeat with Login.
- [ ] **Launcher relaunch (Android):** tap Sign Up → tap the app icon from the launcher → the
      friendly "sign-in window closed" message shows and a second tap succeeds. (Confirms the
      2026-09-12 OTA change still behaves on the new SDK; the SDK's error code is unchanged.)
      CHANGED 2026-09-15: with §D in the build the expected result flips — see "§D — trampoline"
      below. This line now only applies if §D is pulled from the build.
- [ ] **Idle renewal:** sign in, wait past the access token TTL (or advance the clock), send an
      attendance report → refresher renews via `auth0Client.getFreshCredentials`, no 401.
- [ ] iOS `ASWebAuthenticationSession` cancel → "Login cancelled by user", no error banner.
- [ ] Anonymous login unaffected.

**§B — Expo patches**
- [ ] Sky agent (dev build, `agentTabVisible` flipped locally) streams a multi-chunk reply on
      Android with no garbled or reordered opening text.
- [ ] Cold start on a warm config cache still skips the fetch gate; OTLP logger flushes reach
      Loki (both are `expo/fetch` consumers).
- [ ] **After the store build is live:** publish a trivial OTA (`npm run update`) and confirm a
      device on 4.11.0 downloads and applies it. This is the §B2 hardening check.

**§C — map**
- [ ] Meetings → In-Person → map toggle: pins render, camera fits the result set, tap a pin opens
      `InPersonPopup` with the right venue (exercises `parseVenueIds`).
- [ ] Switch to Live, back to In-Person, toggle map again — no blank tile surface, no duplicate
      puck, no crash on the second mount (the recycling / zero-size fixes).
- [ ] Toggle system dark mode with the map open — style URL swaps, pins reload (style-image
      serialisation path).
- [ ] Background the app on the map for a minute, foreground — no ANR report in
      `adb logcat`, camera state intact.
- [ ] Grep confirms `InPersonMapView.tsx` still imports `NativeUserLocation`, not `UserLocation`.

**§D — trampoline (Android device, not emulator-only: Samsung One UI if one is to hand)**
- [ ] **The fix itself:** tap Sign Up → Custom Tab opens → press Home → tap the app icon from
      the launcher → the **Custom Tab is still there**, mid-form, and completing it signs the
      user in. No "sign-in window closed" message. Repeat from Recents (should already have
      worked; make sure it still does). Repeat with Login.
- [ ] Cold start from the icon: splash → app, no visible extra frame or flash, no
      `LaunchActivity` left in `adb shell dumpsys activity activities | grep -A3 LaunchActivity`
      once the app is up.
- [ ] `adb shell dumpsys package live.meetingmaker.app.prod | grep -B2 -A6 LAUNCHER` shows the
      filter on `.LaunchActivity` only; one icon in the drawer.
- [ ] **Push tap, app cold:** force-stop the app, send a test push, tap it → app opens **and**
      the JS click handler routes to the tab named in `data.screen` (departure 2 forwards the
      extras; if this fails the trampoline dropped them).
- [ ] **Push tap, app backgrounded:** app running, press Home, send + tap a push → app comes
      forward, handler routes, and the in-flight state (e.g. an open Custom Tab, or a running
      attendance timer) is still on screen — nothing above `MainActivity` was cleared.
- [ ] Auth0 callback still lands: complete a login normally; `RedirectActivity` handles the
      `recoverysky-app://auth.recoverysky.app/…/callback` URI (Loki shows the usual
      "Auth state synced to MST store" line, no `browser_terminated`).
- [ ] After a week on 4.11.0, the re-pointed RS-005 fingerprint (`module="useAuth0Wrapper"`)
      shows zero non-crawler matches on `appVersion=~"4.11.0.*"`.

## Release

Native. `npm run minor` (→ 4.11.0), then by hand in `app.json`: `runtimeVersion` → `"4.11.0"`,
`android.versionCode` → `41100000` (`bump-version.sh` rewrites only `version`). Then
`npm run release:ios` and `npm run release:android`.

Changelog, all under the new `[4.11.0]` heading: `Build` entries for the auth0 bump, the three
Expo patches, and the MapLibre bump (one bullet each — say what the fix protects, not the
version arithmetic); `Added` entry for the process-death login recovery; a `Security` line for
auth0 only if a CVE has been published by then, otherwise it stays under `Build`.
ADDED 2026-09-15: a `Fixed` entry for §D — "tapping the app icon during Android sign-in no
longer closes the sign-in window" — and, once the build is live, `release_record app 4.11.0` on
the issues MCP moves RS-005 (fix-committed, fix_release `app 4.11.0`) to fix-deployed.
