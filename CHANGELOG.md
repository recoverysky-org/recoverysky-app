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

## [Unreleased]

### Fixed
- **Theme color picker crash.** Picking a color or moving the hue slider in
  Settings → App Settings → Theme Color → custom picker crashed the app with
  a C++ `Object is not a function` exception thrown from the worklet thread.
  `reanimated-color-picker`'s `onComplete`/`onChange` props are worklet-only
  (the lib calls them inside the gesture worklet without `runOnJS`); we were
  passing a regular React `useCallback`. Switched to `onCompleteJS`, which
  the lib auto-wraps with `runOnJS`.

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
