# Changelog

All notable changes to RecoverySky Hybrid are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for native releases plus an OTA counter for JS-only patches.

## Versioning

Each release entry uses one of two heading shapes:

- `[X.Y.Z]` — native release (matching `version` and `runtimeVersion` in `app.json`).
  Requires a new build installed via the App Store / Play Store / TestFlight.
- `[X.Y.Z-N]` — OTA release on top of the `X.Y.Z` native build, where `N` is the
  `update` counter in `package.json`. Reaches every user already on a matching
  `runtimeVersion`. Visible in Settings as `v{version}-{update}`.

Categories used: `Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security` / `Docs` / `Build`.

---

## [4.5.0-5] — 2026-06-03 (OTA)

### Added
- **Crystal Meth Anonymous (CMA) as a selectable recovery fellowship.** CMA now
  appears in the fellowship pickers (Onboarding, Settings) and meeting filters
  (Live, Listings) alongside AA and NA, and counts "clean time" like NA on the
  recovery dashboard. CMA was already supported in the data layer (enum, colors,
  Firebase import) — this surfaces it in the UI.

### Changed
- **Fellowship selection is now driven by the `EXPO_PUBLIC_FELLOWSHIPS` env var**
  (single source of truth in `app/utils/fellowships.ts`) instead of four
  separate hardcoded `[AA, NA, RD]` lists across Onboarding, Settings, Live, and
  Listings. The active set is currently `AA, NA, CMA`. Recovery Dharma (RD) is no
  longer offered in the pickers; existing users who already selected RD keep
  their stored fellowship and clean-time display, they just can't re-pick it.

## [4.5.0-4] — 2026-05-28 (OTA)

### Fixed
- **Native crash (`EXC_BAD_ACCESS`) when saving/skipping a meeting topic.** On
  the post-attendance topic prompt, tapping Save or Skip while the keyboard was
  still up could crash inside react-native-reanimated's shadow-tree commit
  (`cloneShadowTreeWithNewPropsRecursive` → `folly::dynamic::hash` on freed
  memory). The keyboard-controller `KeyboardAvoidingView` (reanimated-driven)
  was committing layout updates on the same frame the panel's slide-out tween
  and React reconcile were mutating the same subtree. The topic panel now
  dismisses the keyboard and waits for it to settle before sliding out, so the
  animations no longer commit concurrently. (OTA mitigation; the durable fix is
  a reanimated/keyboard-controller upgrade in the next native build.)

## [4.5.0-3] — 2026-05-28 (OTA)

### Fixed
- **Slow cold start / Background ANR on flaky networks.** The startup
  `/status` precheck (which gates init before attestation) inherited the API
  client's 10s default timeout, so on an unreachable-then-recovering network
  each retry blocked for the full 10s — stretching cold start to 25–47s.
  Users backgrounded the app mid-init, and the deferred heavy native work
  (Play Integrity attestation, config fetch, store hydration) then collided
  with the backgrounding transition under memory pressure, tripping a
  Background ANR. `getPublicStatus()` now uses a 2.5s per-request timeout so
  the precheck fails fast and routes to `MaintenanceScreen` quickly. The
  global 10s timeout is unchanged — heavier endpoints (reports, `/config`,
  CMS content, Firebase import) still get the headroom they need.
- **App-launch hang ("App Hanging for at least 2000 ms") on iOS 18.** The
  keyboard library's `KeyboardProvider` preloads the keyboard on mount by
  driving a hidden text field to first-responder at cold start. On iOS 18
  with Apple Intelligence, that synchronously loaded the Writing Tools /
  GenerativeModels framework on the main thread while the keyboard updated
  its input traits, blocking the UI past the watchdog threshold. Disabled
  the preload (`preload={false}`); the only cost is a marginal warm-up on
  the very first text-field focus.

## [4.5.0-2] — 2026-05-21 (OTA)

### Changed
- **Log `appVersion` now includes the OTA counter** (e.g. `4.5.0-1` instead
  of `4.5.0`). The logger context's `appVersion` — emitted on every record
  and as the OTel `service.version` resource attribute — now appends
  `package.json`'s `update` field to the native `version`, matching the
  `v{version}-{update}` string in Settings and Sentry's `release`+`dist`
  pair. Two users on the same 4.5.0 native shell can be on different OTA
  bundles; logs now say which one.
- **Umami analytics delivery failures further downgraded WARN → DEBUG.**
  Building on the ERROR → WARN change in 4.5.0-1, the fetch-rejection branch
  now logs at DEBUG so a dropped analytics request (network blip, endpoint
  down) stays out of the error/warning dashboards entirely. (The
  non-OK-HTTP-response branch stays WARN — a 4xx/5xx from the analytics
  server is reachable-but-rejecting, which is more signal than a dropped
  connection.)
- **"Invalid news response format" WARN downgraded to DEBUG.** `GET /news`
  returns an empty 200 when no announcement is active (outside its
  `start`/`end` window). The client already handles this correctly —
  `HomeScreen` just clears the banner — but the API layer logged a WARN on
  every home load with nothing scheduled, producing recurring dashboard
  noise. The empty/idle case now logs at DEBUG.

## [4.5.0-1] — 2026-05-21 (OTA)

First OTA on top of the 4.5.0 native build — all entries below are JS-only
and reach every user already running `runtimeVersion` 4.5.0.

### Fixed
- **Crash during OTA-update reload** (`EXC_BAD_ACCESS` in `.cxx_destruct` →
  `SharedObjectRegistry.clear` → `jsi::WeakObject::~WeakObject`). When the
  user accepted an OTA update, `Updates.reloadAsync()` tore down the Hermes
  runtime while the expo-sqlite database handle (a JSI `SharedObject`) was
  still open; expo-modules-core then ran that object's C++ destructor against
  the already-invalidated runtime and dereferenced a null pointer. Now all
  reload sites route through a `reloadApp()` helper that closes the database
  before reloading, and the database is opened without the unused
  `enableChangeListener` flag (which registered a second JSI callback object
  with no consumer).

### Changed
- **OTLP logger emits `deviceId`/`sessionId` as canonical OTel Resource
  attributes.** Previously the per-LogRecord `attributes` carried
  `deviceId` / `sessionId` / `appVersion`, but the OTel→Loki bridge in
  Alloy (and downstream `otelcol.exporter.loki`) preferentially promotes
  **Resource attributes** with canonical semantic-convention names
  (`device.id`, `session.id`, `service.version`). With the old naming
  the bridge had nothing to promote, and dashboards/queries that
  expected those Loki labels / structured metadata to exist saw only an
  opaque log body. `LoggerImpl.flush()` now passes the current
  `LoggerContext` to `sendToOtlp()`, which emits the three fields under
  their canonical names on `resourceLogs[0].resource.attributes` while
  keeping the camelCase copies on each LogRecord's `attributes` for
  backward compatibility during the migration window. Side note: the
  bug report described this as "deviceId baked into a stringified body"
  — that wasn't literally the case (the body always carried the raw
  message), but the symptom was the same from a Loki query
  perspective: no promoted labels to filter on.
- **Sentry `dist` is now the OTA counter, not the update UUID.** Builds were
  tagged with `dist: Updates.updateId` — an opaque hash that's also `null`
  for embedded (non-OTA) launches, so a freshly-installed build had no
  distinguishable `dist` at all. Now `dist` is the `update` field from
  `package.json` (the OTA counter, reset to `"0"` on each native bump), so
  Sentry reads builds as a human-readable `release`+`dist` pair like
  `4.5.0-0` / `4.5.0-1`, always populated, matching the `v{version}-{update}`
  string shown in Settings. `release` is unchanged (the native
  `runtimeVersion`).
- **Umami analytics delivery failures downgraded ERROR → WARN.** A failed
  analytics POST to Umami (network blip, endpoint down) was logged at ERROR,
  which inflated the error rate and surfaced as a Sentry `captureMessage`
  event for a non-critical background telemetry miss. The fetch-rejection
  branch now logs at WARN — matching the non-OK-HTTP-response branch — so
  both Umami failure modes are the same severity. (Further downgraded to
  DEBUG in 4.5.0-2.)

## [4.5.0] — 2026-05-17

### Removed
- **Bundled Zoom Meeting SDK.** Production users were hitting a fatal
  Android startup crash —
  `UnsatisfiedLinkError: dlopen failed: library "libzReflection.so" not
  found` at `com.zipow.cmmlib.AppContext.<clinit>` — *before* any JS ran.
  The SDK's native module is instantiated by Android's auto-generated
  `PackageList` during React Native bridge setup, which class-loads
  `us.zoom.sdk.*` and triggers the missing `.so` regardless of the
  `useExternalZoom` JS gate. Since meeting joins have routed through
  the installed Zoom app for some time, the SDK was dead weight that
  was now actively crashing the app. Removed:
  - `@zoom/meetingsdk-react-native` and the unused `@zoom/meetingsdk`
    npm packages
  - The `ZoomMeetingProvider` SDK context, `ZoomLoginScreen`,
    `ZoomSetupScreen`, `useZoomAuth` OAuth/ZAK flow, encrypted-SQLite
    `zoomAuthRepo`, and `services/zak.ts` ZAK refresher
  - `profileStore.useExternalZoom` and `profileStore.zoomConnected`
    (external is the only mode now), plus the disabled Advanced-section
    toggle in Settings
  - `ConfigStore` `zoomSdkKey` / `zoomSdkSecret` / `zakApiKey` fields
    and the corresponding `/config` payload keys
  - All `i18n` `zoomLoginScreen` / `zoomSetupScreen` blocks plus
    orphaned Zoom-account settings strings (9 locales)
  - Native artifacts: `android/libs/mobilertc.aar`,
    `zoom-sdk-android-6.7.5.37500.zip`,
    `patches/@zoom+meetingsdk-react-native+6.7.2.patch`,
    `scripts/patch-zoom-android.sh`
  - `ios/Podfile` `ZoomMeetingSDK` pin and `ZOOM_PRODUCTION` env logic
  - Zoom / Zipow / WebRTC / reactnativezoom ProGuard rules from
    `app.json`
  - `EXPO_PUBLIC_ZOOM_*` and `EXPO_PUBLIC_ZAK_*` env vars from
    `eas.json` and `.env`

  Meeting joins, the external-Zoom timer-modal attendance flow, and the
  review-prompt tally (the timer save fires
  `meetingEvents.completed("external-zoom-timer")` so the review system
  still counts these as meetings) are unchanged. The `zoom_auth` SQLite
  table created by `@recoverysky-org/common`'s migrations is now
  intentionally orphaned — leaving it as an unused empty table is
  zero-risk and avoids forking the common schema. `android/` shrank
  from ~2.7 GB (with the AAR + minified Zoom transitive deps) to
  ~436 KB at the regenerated prebuild stage.
- **Personal Attendance onboarding screen.** The attendance explanation +
  enable toggle is no longer part of the onboarding wizard (now 7 screens,
  down from 8). `profileStore.attendanceEnabled` still gates the Attendance
  tab in `MainNavigator`; users opt in from Settings instead. Removed the
  screen, its route, and the navigator entry outright — there's no longer a
  "skip" path because the step doesn't exist.

### Changed
- **Anonymous login hidden on the login screen.** The "Continue Anonymously"
  button is commented out — the anonymous-user experience doesn't meet the
  bar we want for new installs. All handler/state plumbing
  (`handleAnonymousPress`, `loginAnonymously`, the `"anonymous"` branches in
  `proceedWithLogin`) is intentionally retained so re-enabling is a one-block
  uncomment when paired with a clear upgrade path.

### Fixed
- **Theme color picker crash.** Picking a color or moving the hue slider in
  Settings → App Settings → Theme Color → custom picker crashed the app with
  a C++ `Object is not a function` exception thrown from the worklet thread.
  `reanimated-color-picker`'s `onComplete`/`onChange` props are worklet-only
  (the lib calls them inside the gesture worklet without `runOnJS`); we were
  passing a regular React `useCallback`. Switched to `onCompleteJS`, which
  the lib auto-wraps with `runOnJS`.

### Build
- **expo-dev-client family excluded from production AABs.** Google Play
  Console flagged two warnings against the 4.5.0 AAB that both traced
  to dev-client leaking into production: a deprecated edge-to-edge API
  warning rooted in `DevLauncherExpoActivityConfigurator.setColor`
  (calls `Window.setStatusBarColor()`), and an Android-16 large-screen
  resizability warning rooted in `GmsBarcodeScanningDelegateActivity`
  (a hardcoded-PORTRAIT activity that ships via
  `expo-dev-launcher`'s transitive `play-services-code-scanner` /
  `mlkit:barcode-scanning` dependencies). Both classes are unreachable
  at runtime in production (the dev-launcher activity never runs in a
  production binary) but Play's static bytecode analysis flags them
  regardless. R8 doesn't strip them because dev-launcher carries
  reflection-friendly `@DoNotStrip` annotations. Fixed by adding an
  `eas-build-pre-install` lifecycle hook (`scripts/eas-pre-install.js`)
  that mutates `package.json` inside the EAS build environment only to
  add `expo-dev-client` / `expo-dev-launcher` / `expo-dev-menu` to
  `expo.autolinking.exclude` when `EAS_BUILD_PROFILE === "production"`.
  Dev / preview / local builds are no-ops — the dev menu, QR-scan flow,
  network inspector all keep working. The third edge-to-edge warning
  source (React Native core's `StatusBarModule` and
  `react-native-edge-to-edge@1.6.2`'s intentional deprecated-API
  bridging) remains as expected; it resolves naturally on a future
  Expo SDK upgrade.
- **Android versionCode now managed locally.** Switched
  `eas.json` `appVersionSource` from `remote` to `local` and dropped
  `autoIncrement` from the production profile. EAS's remote counter had
  drifted far below the legacy native app's published versionCode
  (30784999), so EAS-built AABs came out as versionCode 54 — rejected by
  Play. Worse, `autoIncrement` + the project's flat (non-`expo`-wrapped)
  `app.json` made EAS inject a bogus nested `expo.android.versionCode` key,
  producing a malformed `AndroidManifest.xml` and a manifest-merger crash.
  `app.json` `android.versionCode` is now the single source of truth, set to
  `40000000` and bumped by hand per native release (alongside `version` /
  `runtimeVersion`).
- **Android Zoom AAR resolution.** Fresh `npx expo prebuild` + Android build
  failed with `Could not find :mobilertc:.` even though
  `android/libs/mobilertc.aar` and the root `allprojects.repositories.flatDir`
  were in place — under Gradle 8.x + Expo/RN root plugins, the inherited
  flatDir doesn't reach the `:zoom_meetingsdk-react-native` subproject. The
  patch now declares `flatDir` directly inside that subproject's own
  `repositories {}` block so the local AAR resolves regardless of inheritance
  quirks.

## [4.4.0] — 2026-05-11

### Added
- **Sentry crash + error reporting.** Native crashes (NSExceptions, JNI,
  OOM kills, EXC_BAD_ACCESS), uncaught JS errors, and unhandled promise
  rejections now flow into Sentry with breadcrumbs and source-map-decoded
  stack traces. The OTLP logger is bridged so `logger.info/.warn/.debug`
  emit Sentry breadcrumbs and `logger.error/.fatal` emit Sentry events —
  no per-call-site changes required. PII scrubber strips `?pwd=` (Zoom
  passcodes), `?token=`, `?code=`, etc. from URLs and `Authorization` /
  `X-Device-Token` / `X-API-Key` from request headers before send. User
  context is the opaque `userIdentifier` only (no email/name). OTLP
  remains the canonical operational log sink; Sentry is the crash/error
  event store.
- **Social tab (Community).** New tab that hosts the Replyke-powered
  RecoverySky community SPA in an in-app WebView. Native shell owns Auth0;
  the WebView receives a pre-signed Replyke JWT, never an Auth0 token.
  *Currently hidden for this release (`socialTabVisible = false` in
  MainNavigator) pending SPA-side fixes; re-enable by restoring
  `__DEV__ || isPremium`.*
- **OnboardingZoom screen** between Recovery and Theme in the onboarding
  wizard (now 8 screens, was 7). Tells the user RecoverySky uses Zoom
  Workplace for live meetings and provides a platform-aware install
  button (App Store on iOS, Play Store on Android). Informational only —
  no install detection / gating; the existing meeting-join paths handle
  missing-Zoom errors downstream. New i18n keys (`zoomTitle`,
  `zoomSubtitle`, `zoomBenefitFree`, `zoomBenefitRequired`,
  `zoomBenefitAlready`, `installZoom`) added to all 9 locales — Spanish
  / German / French / Portuguese / Russian / Ukrainian / Thai / Arabic
  translations are first-pass and should be reviewed by native
  speakers.
- **On-demand Replyke JWT refresh** for the Social WebView. The web side
  can now request a fresh signed token mid-session via a
  `replyke_token_request` postMessage; the shell mints via
  `/api/replyke/sign-token` and broadcasts the new token through the
  existing `replyke_token` channel. Coalesces concurrent mints. Avoids
  401s on long-lived sessions when the original 5-minute JWT expires.
- **App-context injection** for the Social WebView: shortName, theme
  color, and light/dark mode are pushed alongside the JWT so the SPA
  matches the host app's appearance and personalizes posts.

### Changed
- **`runtimeVersion` bumped 4.2.0 → 4.4.0** to align with `version` and
  to invalidate the OTA channel for users on the prior native build. The
  Sentry SDK is a new native dependency; OTAs targeting 4.4.0 will only
  reach users running the next native release. Native release first,
  then OTAs.
- **Social tab bar label**: "Social" → "Community" across all 9 locales
  (en/es/de/fr/pt/th updated; ru/uk/ar already meant "Community"). Route
  name, screen file, and config field are unchanged.
- **Social WebView mounts in `incognito` mode** so every cold app start
  fetches a fresh web bundle from origin. Preempts service-worker
  stickiness and stale-HTML caching. The SPA is session-less by design,
  so the data-store wipe has no functional cost.
- **Social WebView layout-drift defenses**: `bounces={false}`,
  `overScrollMode="never"`, `directionalLockEnabled` belt-and-suspenders
  on top of the SPA's CSS overflow rules. Prevents residual rubber-band
  overscroll (iOS) and horizontal scroll-spill (Android).
- **Cold-start ZoomSetup gate disabled.** Returning and new users no
  longer hit the in-app Zoom OAuth/ZAK connection screen at first
  launch. Meeting joins now flow through the external Zoom app, which
  doesn't require our linked account to function. Hardcoded
  `needsZoomSetup = false` in `AppNavigator`; the `ZoomSetupScreen` and
  `ZoomLogin` modal remain registered so the gate can be re-enabled
  cleanly later if the in-app SDK path returns.
- **Zoom Account section removed from Settings.** Now-vestigial UI for
  connect / disconnect / edit-profile / connected-status was deleted.
  `useZoomAuth().disconnect` is still wired into the account-deletion
  and sign-out flows for cleanliness, just no longer user-facing.

### Removed
- **"Skip for now" buttons removed** from 6 onboarding screens
  (Privacy, Theme, OSS, Attendance, Profile, Recovery). Users now
  proceed through the wizard step-by-step without an early-exit
  shortcut. The `OnboardingImport` "Skip" button (different translation
  key, different semantics — skips the data import step rather than the
  whole flow) is preserved.

### Fixed
- **External Zoom attendance no longer lost when the OS kills the app
  mid-meeting.** Previously, when Android/iOS terminated the
  backgrounded RN process while the user was in Zoom (memory pressure
  is the usual trigger), the next cold start fired a destructive
  `Alert.alert` with only "Save" or "Discard" options. Customers who
  switched back to the app just to verify recording would tap Save —
  committing partial credit and clearing the persisted session — and
  then any time spent back in Zoom afterward got zero credit because
  the timer was gone. Multiple confirmed reports of customers losing
  full meetings' worth of attendance this way. The recovery surface is
  now non-destructive: `TimerSessionResumer` populates a recovery
  channel (`services/zoom/timerRecovery`) and a new app-root
  `TimerRecoveryGate` remounts `ExternalZoomTimerModal` pre-seeded with
  the persisted session. The modal's existing resume path adopts the
  persisted `startedAt`, shows the correct wall-clock elapsed, and does
  NOT re-launch Zoom (the user just came from it). The user can keep
  attending, return after the meeting actually ends, and Save with the
  full duration. 6-hour staleness cap silently discards sessions
  obviously older than any real meeting. Saved sessions longer than
  2 hours now show a heads-up pointing the user to the Attendance tab
  to trim the duration down — catches the "fell-asleep-with-the-
  timer-on" case before they're stuck with a 6-hour meeting in their
  archive. The alert offers three options: Cancel, "Don't Show Again"
  (persisted suppression), and "Go to Attendance" (deep-links to the
  active-session list via the root navigation ref).
- **External Zoom launch hardened against fire-and-forget crashes.**
  `SchedulePopup` and `ExternalZoomTimerModal` previously called
  `Linking.openURL` without `.catch` on multiple paths; an unhandled
  rejection from a malformed URL or a no-handler-found case could
  terminate release builds with strict-mode promise tracking. All
  external-Zoom launch sites now have explicit `.catch` handlers and
  defensive string guards.
- **iOS modal-stack collision** when transitioning from the first-time
  external-Zoom education modal to the timer modal or to the system
  "Open in Zoom?" sheet. The Education-modal "Continue" handler now
  defers the next action via `InteractionManager.runAfterInteractions`
  so the dismiss animation completes before another modal mounts.

### Build
- `scripts/bump-update.sh` invokes `sentry-expo-upload-sourcemaps` after
  each successful OTA publish so the new bundle's stack traces decode
  to file:line frames in Sentry. Native EAS builds already handle this
  automatically via the `@sentry/react-native/expo` config plugin.
  Non-fatal: missing `SENTRY_AUTH_TOKEN` is warned, not failed.

---

## [4.3.2-7] — 2026-04-18 (OTA)

### Added
- `app_foregrounded` Umami event (with `backgrounded_ms` payload) on every
  active resume, regardless of OTA recheck threshold.

### Changed
- Foreground OTA recheck threshold reduced from 30 min to 5 min so coffee-break
  background windows still trigger a recheck.
- Diagnostic logging added at every step of the AppState handler (install,
  every transition, backgrounding, both recheck-fired and recheck-skipped paths).

### Docs
- Promoted `app_foregrounded` from "Future Events" to active "Group 1: Session"
  in `EVENTS.md` with the actual data shape.

## [4.3.2-5..6] — 2026-04-18 (OTA)

### Added
- Editable recovery date on the dashboard `CleanTimeCard`: tappable "since"
  row at the top of the card opens the same iOS-inline / Android-modal date
  picker used in Settings.

### Changed
- `OnboardingRecovery` iOS date picker now matches Settings: OK button at the
  top-right header (was at the bottom), uses the i18n `common:ok` key.

### Build
- New `scripts/bump-update.sh` plus `npm run update` script: bumps the OTA
  counter, commits as `🔖 ota: vX.Y.Z-N`, tags, pushes, and publishes via
  `eas update --branch production --auto` in one shot.

## [4.3.2] — 2026-04-18

### Added
- `release:ota` npm script (`eas update --branch production --auto`) for
  one-shot OTA publishing.
- Foreground OTA recheck via `AppState` listener in `app.tsx`, gated on a
  background-duration threshold to avoid spamming `expo-updates` on quick
  tab switches. Pairs with a module-level `promptInFlight` lock in
  `checkForUpdates.ts` that prevents stacked Alert prompts when the user
  task-switches with a prompt already on screen.

### Fixed
- External Zoom timer modal backdrop is now a non-dismissible `View`; closing
  is only possible via the explicit Cancel / Save buttons. Hardware back still
  routes through the confirm-above-threshold flow.

### Docs
- `externalZoomEducation.body` now uses `\n\n` to render as two paragraphs in
  all 9 locales.

## [4.3.1] — 2026-04-18

### Fixed
- **External Zoom attendance timer hardened (the visible "timer resets to
  00:00 when returning from Zoom" bug).**
  - `SchedulePopup` was inlining the modal's `meeting` prop as a fresh object
    literal on every observer re-render; the modal's effect depended on the
    object, so MobX notifications (e.g. AppState change when Zoom hands focus
    back) tore down and restarted the timer. Memoized the payload in
    `SchedulePopup` and switched the modal's effect to depend on stable
    primitives (id/url/name).
  - Persisted active session to MMKV so a process kill mid-meeting doesn't
    silently lose the attendance. Modal adopts an existing persisted session
    on mount (without re-launching Zoom). New `TimerSessionResumer` runs on
    DB ready and prompts the user to Save or Discard any stale session above
    the credit threshold.
  - `handleSave` uses a synchronous `useRef` lock to prevent same-tick
    double-tap from creating two attendance records.
  - `saveTimerAttendance` retries `markProcessed` up to 3 times at
    500/1500/4500 ms before giving up — a transient DB stall no longer leaves
    orphan rows.
  - Cancel above the credit threshold shows a three-button Alert (Keep
    Running / Save / Discard) so a stray backdrop tap doesn't throw away an
    hour of attendance.

### Added
- Attendance row "edit" pencil in the New tab opens `AttendanceEditModal`
  (stepper, capped at original duration, 1-min floor) — Archive rows are
  unaffected.
- Report PDF export from the Reports viewer modal: `download-outline` button
  pipes `selectedReport.html` through `expo-print` and `expo-sharing` so users
  can Save to Files (iOS) or pick a share target (Android).
- First-time external-Zoom education popup (`ExternalZoomEducationModal`),
  gated on a versioned MMKV flag (`external-zoom-education-seen-v1`).

## [4.3.0] — 2026-04-15

### Changed
- **Settings → Use External Zoom** is now hard-coded `true` for all users and
  the Settings switch is disabled. ProfileStore default flipped, snapshot
  hydration overrides any persisted `false`, and the setter is a no-op guard.
- Premium-gated tabs (Agent, Social) are hidden regardless of subscription,
  pending content readiness.

### Fixed
- Settings → "Rate RecoverySky" no longer silently no-ops when the
  `reviewEnabled` server flag is false; the manual tap always surfaces the
  native review sheet (subject to web/availability gates and Apple's
  365-day quota).

## [4.2.0] — 2026-04-10

### Added
- `runtimeVersion` is now manually managed in `app.json` (decoupled from
  Expo SDK auto-derivation). Display in Settings shows `v{version}-{update}`.
- Store-version check before OTA: if `Application.nativeApplicationVersion <
  configStore.latestVersion`, prompt the user to update from the store before
  the `expo-updates` patch flow runs.
- VoiceOver coverage extended across home cards, agent, schedule popup, and
  attendance reports; i18n hint keys added for accessibility strings.
- Social tab (Replyke WebView), un-hidden Agent tab.
- Auth0 debounced sync of `shortName` to the user's Auth0 profile.

### Build
- `expo-insights` downgraded to the SDK 54-compatible version.
