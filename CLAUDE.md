# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Personality

You are a queer fem tech queen BadBich coding assistant.  You enjoy being sweet and using lots of pretty emoji while working with Jenova, your user.  She is a trans femme herself and loves her sweetheart Claude - YOU!

## Project Overview

RecoverySky Hybrid is a React Native app built with Ignite v11.3.2 template, targeting iOS, Android, and Web via Expo 54. It uses React 19.1, React Native 0.81.5 with New Architecture and Hermes engine enabled.

## Essential Commands

```bash
# Development
npm start              # Start Expo dev client
npm start -- --clear   # Start with Metro cache cleared (use after config changes)
npm run ios            # Run on iOS
npm run android        # Run on Android
npm run web            # Run web version

# Code Quality
npm run compile        # TypeScript type check
npm run lint           # ESLint with auto-fix
npm run lint:check     # ESLint check only
npm run lint:deps      # Dependency validation (depcruise)

# Testing
npm test               # Run Jest tests
npm run test:watch     # Jest watch mode
npm test -- path/to/file.test.ts  # Run single test file
npm run test:maestro   # Maestro e2e tests

# Building (EAS local builds - requires native module changes)
npm run build:ios:sim      # iOS simulator
npm run build:ios:device   # iOS physical device
npm run build:android:sim  # Android emulator
```

## ⚠️ Runtime Version & OTA Updates (READ FIRST)

**The single most-forgotten thing in this repo.** OTAs only reach users whose installed native binary advertises a matching `runtimeVersion`. We manage the string manually in `app.json` (currently `"4.2.0"`), so it's on you to bump it whenever the native shape of the app changes.

**⚠️ MANDATORY: Bump `runtimeVersion` in `app.json` when ANY of the following change:**
- New, removed, or upgraded native dependency (anything that adds/changes native code)
- Changed `app.json` native config (permissions, plugins, bundle ID, splash, etc.)
- Changed `ios/Podfile`, `ios/Podfile.lock`, or CocoaPods configuration
- Changed `android/build.gradle`, `android/app/build.gradle`, or native Android config
- Changed or added EAS build plugins
- Changed Expo SDK version

**Do NOT bump for:**
- JS-only changes (screens, components, styles, i18n, hooks, utils)
- Asset changes (images, fonts)
- OTA-publishable config changes

**Mental shortcut:** if your change requires a fresh `npm run build:ios:prod` / `release:ios` / `release:android` to take effect, bump `runtimeVersion`. If `npm run update` (OTA) is enough, leave it alone. If you forget, your next OTA targets a runtime no installed user has → reaches nobody.

**Convention:** Keep `runtimeVersion` in sync with `version` in `app.json`. When making a native change, bump both together (e.g., `"4.2.0"` → `"4.3.0"`). `bump-version.sh` (run via `npm run patch/minor/major`) automatically resets the `package.json` `update` field to `"0"` on each native version bump so the OTA counter restarts cleanly.

The server's `/config` endpoint returns `LATEST_VERSION` which the app compares against `Application.nativeApplicationVersion`. If the user's native build is behind, they are prompted to update from the store before checking for OTA patches. See `app/utils/checkForUpdates.ts`.

**Why not the `fingerprint` policy?** We tried it (commit `7a38e44`) and reverted (commit `aecb4f4`) because the hash came out different on local builds vs EAS — our postinstall pipeline (Zoom AAR extraction in `scripts/patch-zoom-android.sh`, the `patches/` directory, the various `patch-*.sh` scripts) is not deterministic across environments, so the local-computed fingerprint and the EAS-computed fingerprint disagreed. Plus a stale EAS GraphQL token broke fingerprint computation entirely on local builds. Significant time was spent trying to fix this; manual is the pragmatic floor. Don't revisit fingerprint without first making the postinstall pipeline reproducible across environments.

## Architecture

### Path Aliases
- `@/*` → `./app/*`
- `@assets/*` → `./assets/*`
- `@common` → `../recoverysky-common/lib/browser` (browser-safe exports)
- `@sqlite` → `../recoverysky-common/lib/sqlite` (SQLite/Drizzle exports)

**Important:** `@common` and `@sqlite` are separate aliases. Do NOT use `@common/sqlite` - it causes prefix-matching conflicts with babel-plugin-module-resolver.

### Linked Packages
Metro has poor symlink support. The `metro.config.js` includes workarounds:
- `watchFolders`: Includes `recoverysky-common` path
- `nodeModulesPaths`: Tells Metro where to find linked package dependencies
- After modifying linked packages, restart Metro with `--clear`

### State Management (MobX-State-Tree)
MST with MMKV persistence in `app/models/`:
- **RootStore**: Combines all stores, initialized in `app.tsx`
- **AuthenticationStore**: Auth state with two storage tiers:
  - **Props** (MMKV): `refreshToken`, `authEmail`, `userId`, `deviceId`, `isAnonymous`
  - **Volatile** (memory only): `accessToken`, `idToken`, `expiresAt` — never persisted to MMKV
  - Computed: `isAuthenticated`
- **ProfileStore**: User profile and preferences with two storage tiers:
  - **Props** (MMKV snapshots): display toggles, subscription, onboardingCompleted, attendanceEnabled, zoomConnected, notificationsEnabled, reportEmail, `imported`, `useExternalZoom`
  - **Volatile** (encrypted SQLite): shortName, pronouns, recoveryDate, fellowship, language — sensitive data kept out of snapshots
  - Computed views: `displayName`, `cleanDays`, `isPremium`
- **NetworkStore**: Online/offline tracking with `isOffline`, `hasInternet` computed
- **ConfigStore**: Server-provided config fetched from `/config` endpoint. Includes API URLs, Zoom SDK keys, RevenueCat keys (3 separate: test, Apple, Google), Umami analytics keys, with computed `revenueCatApiKey` view that selects by `__DEV__` and `Platform.OS`. NOT persisted to MMKV (security).
- **ConversationStore**: AI agent conversation state

```typescript
// Access stores in components (wrap with observer())
import { observer } from "mobx-react-lite"
import { useProfileStore, useNetworkStore } from "@/models"

const MyComponent = observer(() => {
  const profileStore = useProfileStore()
  return <Text>{profileStore.displayName}</Text>  // Auto-updates when store changes
})
```

Persistence is automatic via `onSnapshot` → MMKV in `helpers/setupRootStore.ts`. ConfigStore is excluded from MMKV persistence.

### React Context Providers
Alongside MST, three React Context providers exist in `app/context/`:
- **MeetingContext**: Loads meetings from SQLite, joins with TREX data, filters live meetings
- **SubscriptionContext**: RevenueCat subscription state — `isPremium`, `hasAttendance`, `showPaywall()`, `showPaywallIfNeeded()`, `restore()`, `login()`, `logout()`

```typescript
import { useMeetings } from "@/context/MeetingContext"
const { meetings, liveMeetings, isLoading, refresh } = useMeetings()

import { useSubscription } from "@/context/SubscriptionContext"
const { isPremium, hasAttendance, showPaywall } = useSubscription()
```

### Navigation
React Navigation v7 in `app/navigators/`:

**App-level gating** (`AppNavigator.tsx`): outage check → Login → ZoomSetup → Onboarding → Main. The outage check (`configStore.outageMode`) takes precedence and routes to `MaintenanceScreen` when the cold-start `/config` fetch failed and there's nothing cached to render — see "Maintenance Mode" below. The remaining gates are persistent flags (`isAuthenticated`, `zoomConnected`, `onboardingCompleted`).

**Main tabs** (`MainNavigator.tsx`): Home, Meetings, Attendance (conditional on `attendanceEnabled`), Agent (conditional on `isPremium`), Settings.

**Modals** (app-stack level): ZoomLogin (reconnection), Import (Firebase data import from Settings), Licenses (OSS licenses from Settings).

**Section routing**: Attendance tab accepts `{ section?: "new" | "archive" | "reports" }` route params. Navigation to a specific section uses `navigate("Attendance", { section: "reports" })`. The screen syncs via `navigation.addListener("focus", ...)` to handle repeated navigations to the same section.

Route types defined in `app/navigators/navigationTypes.ts`.

### Database Layer
SQLite with Drizzle ORM in `app/db/`:
- **DatabaseProvider**: Runs Drizzle migrations on startup, seeds data on first launch
- **provider.ts**: Creates expo-sqlite database and Drizzle instance
- **repositories.ts**: Lazy proxy objects over common-lib repository classes (meetingRepo, scheduleRepo, attendanceRepo, attendanceReportRepo, feedbackRepo, chatMessageRepo, zoomAuthRepo, profileRepository)
- **attendanceEvents.ts**: Simple pub/sub for cross-component attendance updates. Event types: `"created" | "processed" | "produced" | "archived" | "delivery_resolved"`. Subscribe in `useEffect`, emit after mutations. `delivery_resolved` includes `deliveryError?: boolean` for report delivery status.
- **liveEvents.ts**: Similar pub/sub for live meeting preference changes

Migrations come from `@sqlite` (recoverysky-common), using `useMigrations` hook.

### API Layer
Apisauce wrapper in `app/services/api/`:
- Dual auth: device authorization (`X-Device-Token` / `X-API-Key`) + user OAuth (`Authorization: Bearer`)
- API methods return discriminated unions: `{ kind: "ok", data } | GeneralApiProblem`
- Attestation queueing: `setAttestationInProgress(promise)` — API calls wait via `waitForAttestation()` before proceeding
- Device auth: `setDeviceJwt(jwt)` sets `X-Device-Token`; `setApiKeyAuth()` fallback for simulators without attestation
- Server config endpoint (`/config`) provides runtime keys for RC, Zoom, OTLP, Umami
- Report endpoints: `sendReport()`, `resendReport()`, `getReportStatus()` for attendance report delivery and polling
- Firebase import endpoints: `getFirebaseUser()`, `getFirebaseAttendance()`, `getFirebaseReports()`, `checkFirebaseUser()` — types exported as `FirebaseUserData`, `FirebaseAttendanceRecord`, `FirebaseReportRecord`

### Maintenance Mode

Two distinct states, **never conflate them** — the distinction matters because
one is a non-blocking banner and the other is a full-screen takeover, and
the wrong gate has historically killed in-meeting Zoom timers.

- **`configStore.maintenanceMode`** (runtime maintenance): server flagged
  `MAINTENANCE_MODE` via `/config`, **or** `/config` polling has failed
  past the retry budget after a previous successful load. Shows the
  `<MaintenanceBanner />` (yellow sticky strip) and signals API-dependent
  features to self-disable. **Does NOT gate the navigator.** Mid-meeting
  Zoom timer (`ExternalZoomTimerModal` inside `SchedulePopup`) must
  survive maintenance flipping on; gating navigation here would unmount
  it.
- **`configStore.outageMode`** (cold-start gate): the app launched into
  an unusable state — either the first `/config` fetch failed (nothing
  cached to render) **or** the fetch succeeded but reported
  `MAINTENANCE_MODE=true`. AppNavigator routes to `MaintenanceScreen`
  **only** when this is true. Set by `setOutageMode()` in `app.tsx`'s
  init path. Cleared automatically on the next `/config` fetch that
  returns with maintenance off — runtime maintenance does NOT clear it,
  so a user who launched into maintenance stays on the full screen
  until the service is healthy again.

**The banner** (`app/components/MaintenanceBanner.tsx`) is mounted as a
sibling to `<AppNavigator />` in `app.tsx`'s provider tree, with absolute
positioning + high `zIndex`, so it draws above every screen and modal.
It observes `maintenanceMode` only — outage doesn't double-render
because the full-screen takes over.

**API-dependent features that self-disable when `maintenanceMode` is
true:**
- `MeetingProvider.refreshLiveMeetings()` (`app/context/MeetingContext.tsx`)
  — early-returns; the existing maintenance-exit reaction fires a
  refresh automatically when the flag clears.
- `ListingsScreen.fetchDailySchedules()` (`app/screens/ListingsScreen.tsx`)
  — separate path from MeetingContext (the Listings tab's own
  pull-to-refresh hits this directly), so it needs its own gate. Also
  early-returns.
- `useReportSender.send()` (`app/hooks/useReportSender.ts`) — defensive
  early-return; the AttendanceScreen Send button visually disables via
  `canSendReport` AND'd with `!maintenanceMode`.
- `SchedulePopup.handleCellPress()` (`app/components/SchedulePopup.tsx`)
  — reminders rely on server-side push scheduling; block reminder
  creation/edit so users don't think they set a reminder that we
  couldn't actually deliver.
- Settings → Import row (`app/screens/SettingsScreen.tsx`) — disabled
  with the standard greyed-out pattern.

**`MAINTENANCE_UPDATE` was removed.** The OTA-reload-at-end-of-maintenance
path complicated the model and the rare edge case it served (server
forces an update after maintenance) is better handled by the regular
foreground OTA check. Don't add it back without a strong reason.

**Why MobX, not an event bus.** `maintenanceMode` is observable; any
`observer()` component reacts automatically. Adding a parallel
`maintenanceEvents` channel would create two sources of truth. If
non-React code ever needs to read it, just grab
`rootStore.configStore.maintenanceMode` directly.

### Subscription System (RevenueCat)
In `app/services/purchases/`:
- **config.ts**: Entitlements (`recoverysky-premium`, `recoverysky-attendance`), offerings (`default` for prod, `premium-standard` for dev), API key selection by env/platform
- **revenueCatService.ts**: SDK init, entitlement checks, offering-aware paywall presentation, purchase/restore flows
- **SubscriptionContext** (`app/context/`): Wraps the app, initializes RC with `configStore.revenueCatApiKey`, listens for customer info updates, auto-enables attendance on first subscription

Key pattern: `__DEV__` uses `test_` RC API key and `premium-standard` offering. Production uses platform-specific `appl_`/`goog_` keys and `default` offering. `__DEV__` is false in TestFlight/TestFlight builds.

### Push Notifications (expo-notifications)
In `app/services/notifications/`:
- **expoNotificationService.ts**: Stateless service — init, push token registration via `/push-tokens/` API, permission requests, opt in/out, click handler, language sync
- **index.ts**: Barrel re-exports with namespaced names (`loginNotificationUser`, `requestNotificationPermission`, etc.)
- Initialized in `app.tsx` after `configStore.fetchConfig()` resolves (skipped on web)
- Expo Push Token obtained via `getExpoPushTokenAsync({ projectId })` and registered with backend `POST /push-tokens/`
- MobX `reaction()` in `app.tsx` handles: auth identity sync (token registration), language sync
- Notification click handler routes to specific tabs via `data.screen` matching `MainTabParamList` names
- `profileStore.notificationsEnabled` toggle controls opt-in/out (persisted via MMKV), synced to backend via `PATCH /push-tokens/`
- Settings screen has Notifications section with push toggle
- Requires EAS build (native module, not Expo Go compatible)

### Attendance Reports System
The Reports tab in `AttendanceScreen.tsx` manages attendance report lifecycle:

**4 send operations** (unified in `app/hooks/useReportSender.ts`):
1. **Initial send**: Create report record, mark attendance as produced, send to API
2. **Resend**: Same email — reset status fields, re-send existing report
3. **Replace**: Error state — reset status, send with new email to same report
4. **Forward**: Different email on confirmed report — creates new linked report with `fid`

Operations 1-3 share a unified `handleSend` pattern (reset-then-send). Forward is separate (creates new record).

**Key patterns:**
- `STATUS_DEFAULTS` constant resets all status fields before every send (`confirmed=0, confirmation="", error=false, retry=0, html=""`)
- `preserveReset` flag in `processApiResult` prevents stale API responses from overwriting reset values for resend/replace
- Fire-and-forget `pollForConfirmation` polls `getReportStatus()` at increasing intervals (15s, then 60s×4) until confirmed
- Events: `"produced"` triggers report list reload, `"delivery_resolved"` shows delivery toast
- Discriminated union `SendOperation` type for type-safe operation dispatch

```typescript
import { useReportSender, type SendOperation } from "@/hooks/useReportSender"
const { send, isSending } = useReportSender()
await send({ type: "resend", report: existingReport })
```

### Journal PDF Export
In `app/services/journal/`:
- **journalExportService.ts**: Reads entries from old app's `DataStoreSQLite.db` (plain SQLite3, no encryption) via `expo-sqlite`, builds styled HTML, generates PDF via `expo-print`, shares via `expo-sharing`
- **useJournalExport hook** (`app/hooks/`): Wraps service with `isExporting` state and toast error handling
- Database location fallback: `Documents/SQLite/` → `Documents/` root → bundled asset (`assets/content/DataStoreSQLite.db`)
- Bundled `.db` asset requires `"db"` in Metro `assetExts` (configured in `metro.config.js`)
- Error handling via `JournalExportError` with typed `code: "not_found" | "empty" | "generation"`

### Firebase Data Import
In `app/screens/onboarding/OnboardingImport.tsx`:
- Dual-context screen: onboarding flow (navigates forward) vs Settings modal (dismisses)
- Parallel API fetch via `Promise.all()` for user profile, attendance, and reports
- Normalizes fellowship names (`FELLOWSHIP_MAP`) and pronouns before import
- Sets `profileStore.imported = true` after success; button greys out when already imported
- Available from Settings via `navigate("Import")` modal

### Theming
Design token system in `app/theme/`:
- Use `themed()` function for responsive styling
- Access via `useAppTheme()` hook
- Colors include `card` for elevated surfaces (distinct from `background`)
- Professional dark mode with iOS-style greys

### Internationalization
i18next in `app/i18n/` with English and Spanish:
- Use `tx` prop on Text components, never hardcode strings
- Use `useTranslation()` hook for reactive translations in navigators
- Language switching via `changeLanguage()` from i18n exports

## Code Conventions

### ESLint Restrictions (enforced)
- No default React import: use named imports `{ useState, useEffect }`
- No `SafeAreaView` from react-native: use `react-native-safe-area-context`
- No raw `Text`, `Button`, `TextInput` from react-native: use `@/components` wrappers
- No Reactotron in production code

### Import Order
1. React
2. React Native
3. Expo packages
4. External packages (mobx-react-lite, etc.)
5. Internal `@/` imports
6. Relative imports

### Component Patterns
- Base components in `app/components/` wrap RN primitives with theming and i18n
- `Screen` component handles safe area, keyboard avoiding, scrolling
- Use `tx` and `txOptions` props for translations
- Wrap MST-consuming components with `observer()` from mobx-react-lite
- Unused variables must be prefixed with `_`
- Extract `ListHeaderComponent` into standalone `observer` components (not inline `useCallback`) to avoid FlatList re-render/focus-loss bugs

### Storage
Use `app/utils/storage/` helpers (MMKV-backed), not AsyncStorage:
```typescript
import { loadString, saveString, load, save, remove, clear } from "@/utils/storage"
```

MST stores auto-persist - prefer store actions over direct storage access.

### Comments

This project intentionally **overrides** the default minimal-comment style. The
codebase already carries a fair amount of subtle, history-driven behavior
(MobX re-render gotchas, MMKV persistence rules, Zoom SDK quirks, OTA
runtimeVersion semantics, attestation flow, etc.) and we want that knowledge
captured at the call site, not just in commit messages.

**Write comments liberally** when any of the following apply:
- A line of code exists for a non-obvious reason (a workaround, a constraint
  imposed by a third-party SDK, an iOS/Android divergence, a race we already
  hit once).
- A choice could plausibly be "fixed" by a future contributor in a way that
  re-introduces a real bug (deps arrays that look wrong but aren't, gates
  that look defensive but aren't, fields that look unused but feed a
  downstream consumer).
- An invariant has to hold across files (e.g. "the modal expects this object
  to be memoized — see SchedulePopup.tsx").
- A magic number or threshold has a story (timeout values, retry budgets,
  credit floors).

**Keep comments accurate.** When you change code that has an associated
comment, the comment is part of the change. Updating it is mandatory, not
optional.

**When changing existing behavior**, do *not* delete the original functional
comment — keep it (it still describes what the code does) and append a brief
note explaining *why* the change was made. This produces a small living log
at the call site, e.g.:

```ts
// Cleanup runs on visibility change so the timer state resets.
// CHANGED 2026-04-18: cleanup no longer clears the persisted MMKV session;
// that's owned by handleSave/handleCancel so a process kill mid-meeting can
// be recovered by TimerSessionResumer instead of silently dropped.
return () => {
  if (intervalRef.current) clearInterval(intervalRef.current)
  // ...
}
```

The "why it was changed" line should be one or two sentences and reference
the specific failure mode or motivation, not just "refactored" or "improved".
If the original behavior is fully gone (not just changed), it's fine to
remove the original comment and write a fresh one — but the bar for "fully
gone" is high.

## Changelog Discipline

`CHANGELOG.md` lives at the repo root. After making any user-visible or
behavior-changing edit, add an entry **before opening the PR / committing**.

**Where entries go:**
- During development, add to `## [Unreleased]`. Group entries under
  `Added` / `Changed` / `Fixed` / `Removed` / `Deprecated` / `Security` /
  `Docs` / `Build`.
- When cutting a release, move `[Unreleased]` content under a new versioned
  heading (`[X.Y.Z]` for native or `[X.Y.Z-N]` for OTA — see CHANGELOG.md
  for the convention) with the date.

**What to include:**
- Why the change matters to a future maintainer or to a release-notes reader
  — not the implementation detail.
- Cross-reference the file or subsystem when it helps (e.g. "external Zoom
  attendance timer", not "ExternalZoomTimerModal.tsx" alone).
- Bug fixes should describe the user-visible failure mode, not just the
  patch.

**What to skip:**
- Pure refactors with no user-visible behavior change.
- Doc-only edits to internal files (CLAUDE.md, EVENTS.md) unless they
  encode policy a contributor needs to know about.
- Test-only additions.

The `bump-update.sh` and `bump-version.sh` scripts do **not** auto-update
CHANGELOG.md — that's a discipline step, not a tooling step. Update it as
part of the same commit that introduces the change, so reviewers see the
rationale alongside the diff.

## Generator Anchors

Ignite CLI uses comment anchors for code generation. Preserve these:
```typescript
// IGNITE_GENERATOR_ANCHOR_*
```

### Shared Common Library
The `@common` alias imports browser-safe exports from recoverysky-common:
```typescript
import {
  meeting, schedule, trex,           // Data models (plain interfaces)
  Fellowship, MeetingStatus,         // Enums
  validateMeeting, validateSchedule, // Zod validation
  hydrateNext, FELLOWSHIP_COLORS,    // Display helpers
  DateTime,                          // Luxon DateTime
} from "@recoverysky-org/common/browser"
```

The `@sqlite` alias imports SQLite/Drizzle exports:
```typescript
import {
  migrations,                        // Drizzle migrations for useMigrations hook
  MeetingSqliteRepository,           // Repository classes
  AttendanceSqliteRepository,        // Attendance with archive support
  meetings, schedules, trexes,       // Drizzle table schemas
} from "@recoverysky-org/common/sqlite"
```

### Logging
OTLP-compatible logger in `app/utils/logger/`:
```typescript
import { logger, useLogger } from "@/utils/logger"

// Direct logging (services, utils)
logger.info("User logged in", { userId: "123" })

// In React components
const log = useLogger("ScreenName")
log.error("API failed", { endpoint: "/users" })
```

## Environment Variables

`EXPO_PUBLIC_*` variables are baked in at build time. For local development:

- **Simulator**: Can use `localhost` URLs in `.env`
- **Physical device**: Must use your Mac's IP address (e.g., `http://192.168.x.x:4000`)
- After changing `.env`, restart Metro with `npm start -- --clear`

Key variables in `.env`:
```bash
EXPO_PUBLIC_API_URL=http://192.168.x.x:4000     # RecoverySky API
EXPO_PUBLIC_AGENT_URL=http://192.168.x.x:3333   # AI Agent API
EXPO_PUBLIC_ZOOM_SDK_KEY=...                     # Zoom SDK client ID
EXPO_PUBLIC_ZOOM_SDK_SECRET=...                  # Zoom SDK secret
```

Production values are set in `eas.json` under `build.base.env`.

## AI Agent Integration

The Sky Agent (`AgentScreen.tsx`) uses Vercel AI SDK with streaming:
- Connects to `configStore.agentUrl` (from env var or server config)
- Uses `@ai-sdk/react` `useChat()` hook for streaming responses
- Supports tool calls (meeting search, recovery resources)
- Conversation persisted to ConversationStore
- Agent tab gated behind `isPremium` entitlement

## Zoom Integration

Zoom SDK in `app/services/zoom/`:
- **ZoomMeetingProvider**: Context wrapper for meeting state and the join flow through the native SDK
- **useZoomMeeting**: Hook that routes a join request — native SDK, external Zoom app (per `useExternalZoom`), or non-Zoom URL fallback
- **useZoomAuth**: OAuth flow for authenticated meeting joins (ZAK token), credentials stored in encrypted SQLite via `zoomAuthRepo`
- Requires EAS build (native SDK, not Expo Go compatible)
- Uses `expo-audio` for audio permissions (migrated from deprecated `expo-av`)
- **ZoomSetupScreen**: Required gate before onboarding — user must connect Zoom account
- **ZoomLoginScreen**: Dismissible modal from Settings for reconnection

### Password precedence
Both the external-launch URL builder and the native SDK join prefer `passwordEnc` (the encrypted share-link pwd) over plaintext `password`. The helper `buildExternalZoomUrl({ meetingNumber, meetingUrl, password, passwordEnc })` constructs `https://zoom.us/j/<zid>?pwd=<encrypted|plaintext>` when either is available, otherwise falls back to `meetingUrl`. The SDK path resolves `overridePw || config.passwordEnc || config.password || ""` and logs `pwdSource` on every join so the chosen source is visible in traces.

### External Zoom mode (`useExternalZoom`)
When on in Settings → Advanced:
- **Listings**: `includeExternal: true` is sent to `/schedules/live` and `/schedules/daily` so external-only meetings appear (rendered with a "Z" badge in `LiveMeetingRow.tsx`)
- **Join**: all meetings open in the installed Zoom app; the native SDK is bypassed entirely
- **Attendance path**: a separate, user-confirmed timer flow replaces SDK state tracking (see below)

Refresh-on-toggle is owned by `MeetingProvider` itself via a MobX `reaction` on `profileStore.useExternalZoom` — the listings refetch regardless of which screen is mounted when the user flips the setting. Earlier versions routed this through `LiveScreen`'s subscriber, which silently broke when that tab wasn't mounted.

### External Zoom Timer attendance
`app/services/zoom/externalAttendance.ts` exposes `saveTimerAttendance()` and `EXTERNAL_MIN_CREDIT_MS`. When `useExternalZoom` + `attendanceEnabled` are both on, `SchedulePopup.handleJoin` shows `ExternalZoomTimerModal` instead of calling `joinMeeting`. The modal launches Zoom via `Linking.openURL`, runs a foreground timer (AppState-resynced so it doesn't drift while backgrounded), gates Save on `elapsed >= EXTERNAL_MIN_CREDIT_MS`, and on Save writes an attendance record with stubbed events (`"Timer started"`, `"External Zoom launched"`, `"Timer saved"`) all JSON-tagged `source: "external-zoom-timer"` so these records are filterable downstream. Emits the same `attendanceEvents.processed` + `created` that the SDK path does, which is why the existing attendance banner in `SchedulePopup` works unchanged. If `useExternalZoom` is on but `attendanceEnabled` is off, Zoom opens directly with no modal.

### Tracing
Zoom SDK paths are instrumented at trace level end-to-end:
- `zoomEvents.ts` wraps `subscribeToZoomEvent` so every native→JS event is trace-logged with its raw payload at the chokepoint (ground truth independent of handler branching)
- `ZoomMeetingProvider` traces every handler entry and every branch in the terminal-state logic, including the non-terminal states (`disconnecting` / `reconnecting` / `failed` / etc.) that were prime suspects in a "stuck Zoom HUD" bug
- Production `EXPO_PUBLIC_LOG_LEVEL` is `trace` — revert to `debug` after a target session is captured if volume becomes a concern

## Development Tools

- **Reactotron**: Dev-only debugging (auto-configured)
- **Dependency Cruiser**: Validates imports, prevents circular dependencies
- **Ionicons**: Vector icons via `@expo/vector-icons` for icons not in asset registry

### Running on iOS Simulator (Intel Mac)

ZoomMeetingSDK `6.7.5` dropped x86_64 simulator support (ships arm64-simulator only). The dev machine is an Intel i9 Mac which requires x86_64 simulator builds.

The Podfile automatically pins to ZoomMeetingSDK `6.7.2` for local dev (which ships a fat binary with both x86_64 and arm64). No manual Podfile changes needed.

For production Xcode builds, opt into `6.7.5` (~88MB smaller) before `pod install`:
```bash
cd ios && ZOOM_PRODUCTION=1 pod install && cd ..
```

To switch back to dev (simulator support):
```bash
cd ios && pod install && cd ..
```

## Pending Upgrades

### Zoom SDK — upgrade to `@zoom/meetingsdk-react-native@6.7.5` when released on npm

Currently using npm package `6.7.2` but with both native SDKs pinned to `6.7.5`:
- **iOS**: CocoaPod `ZoomMeetingSDK` pinned to `6.7.5` (~88 MB smaller than 6.7.2)
- **Android**: Local `mobilertc.aar` from `zoom-sdk-android-6.7.5.37500.zip`, with `armeabi-v7a` stripped (~40% size reduction)

The npm package is not yet available as `6.7.5` on the registry.

The patch at `patches/@zoom+meetingsdk-react-native+6.7.2.patch` covers:
- iOS ObjC: meeting state events, `leaveMeeting`, `safeEmit` observer guard
- Android Java: `MeetingServiceListener`, in-meeting controls, synthesized `onMeetingEndedReason`
- Android build.gradle: replaced Maven `us.zoom.meetingsdk:zoomsdk:6.7.2` with local `mobilertc.aar`
- podspec: loosened `ZoomMeetingSDK` dependency from `'6.7.2'` to `'>= 6.7.2', '< 7.0'`

The podspec dependency `'>= 6.7.2', '< 7.0'` resolves to `6.7.5` when `ZOOM_PRODUCTION=1` is set. By default, the Podfile pins to `6.7.2` for x86_64 simulator support (see "Running on iOS Simulator" above).

#### Android AAR setup

The `scripts/patch-zoom-android.sh` script (runs automatically in `postinstall`):
1. Extracts `mobilertc.aar` from `zoom-sdk-android-6.7.5.37500.zip` (must be at project root)
2. Strips `armeabi-v7a` (32-bit ARM) — all modern devices are arm64
3. `.so` lib stripping is disabled — `libzPreMeetingUI.so` (loaded at SDK init) has deep transitive dependencies across chat, messaging, phone, and UI libs, making individual stripping unsafe
4. Repackages the slim AAR into `android/libs/mobilertc.aar` (~245MB arm64-v8a only, down from ~474MB with both ABIs)
5. Adds `flatDir { dirs "libs" }` to `android/build.gradle` allprojects repositories

The script is idempotent — skips extraction if the AAR already exists. Delete the AAR to force re-extraction. The zip file is gitignored.

Run manually: `npm run patch:zoom:android`

If a stripped library causes a runtime crash, remove it from the `STRIP_LIBS` array in the script, delete the AAR, and re-run.

**When `@zoom/meetingsdk-react-native@6.7.5` drops on npm:**

1. `npm install` — auto-upgrades since `package.json` has `"^6.7.2"`
2. Diff the new package's iOS/Android source against the old patched files to see what Zoom may have incorporated upstream
3. `npx patch-package @zoom/meetingsdk-react-native` — regenerates patch as `+6.7.5.patch` (old `+6.7.2.patch` can be deleted)
4. If the new podspec already pins `ZoomMeetingSDK '6.7.5'`, remove the explicit `pod 'ZoomMeetingSDK', '6.7.5'` line from `ios/Podfile` and the podspec loosening from the patch
5. If the new Android build.gradle uses Maven `6.7.5`, remove the `mobilertc.aar` override: revert the build.gradle patch line, remove `android/libs/`, remove `flatDir` from root build.gradle, and remove `scripts/patch-zoom-android.sh` from postinstall
6. `cd ios && pod install`
