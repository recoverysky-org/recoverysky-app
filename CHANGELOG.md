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

_(none)_

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
