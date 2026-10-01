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
npm run dev-log        # npm start, also saved to /tmp/rs-metro.log (macOS `script`; read by
                       # Claude in docs/AUTH_LINKING_TESTS.md checkpoints)
npm run ios            # Run on iOS (reuses existing ios/ — see prebuild below)
npm run android        # Run on Android
npm run web            # Run web version
npm run prebuild:clean # Regenerate ios/ + android/ (then patch-android.sh) — REQUIRED after
                       # app.json / app.config.ts / plugins/ edits; also prebuild:ios:clean,
                       # prebuild:android:clean
npm run align-deps     # expo install --fix: align deps to the Expo SDK

# Code Quality
npm run compile        # TypeScript type check
npm run lint           # ⚠️ eslint . --fix REPO-WIDE — prefer `npx eslint --fix <files you touched>`
npm run lint:check     # ESLint check only
npm run lint:deps      # Dependency validation (depcruise)

# Testing (TWO runners — see "Test Runner Split" below)
npm test                          # Everything: vitest run && jest --forceExit
npm run test:unit                 # Vitest only (pure .ts)
npm run test:unit -- path/to/file.test.ts       # Single Vitest file
npm run test:unit:watch           # Vitest watch mode (also test:component:watch)
npm run test:component            # jest-expo only (.tsx component tests)
npm run test:component -- path/to/file.test.tsx # Single Jest file
npm run test:e2e                  # ⚠️ Hits live infra (Loki) — needs network
npm run test:maestro              # Maestro device e2e

# Building
npm run build:ios:sim      # EAS local build, iOS simulator
npm run build:ios:device   # EAS local build, iOS physical device
npm run build:ios:prod     # EAS local build, production profile
npm run build:android:sim:debug    # Gradle (x86_64) — NOT EAS
npm run build:android:device:debug # Gradle (arm64-v8a)
npm run build:android:prod         # EAS local build, production AAB
npm run adb                # adb reverse ports for Android dev (Metro, logger)
npm run check:env          # Verify .env ↔ eas.json env sync

# Releasing (see "Releasing (OTA & Native)" below for the full procedure)
npm run update             # OTA release: bump counter, commit, tag, push, eas update, Sentry maps
npm run patch              # Native version bump (also: minor / major); resets OTA counter to 0
npm run release:ios        # Native build + submit to App Store (also: release:android)
```

## ⚠️ Runtime Version & OTA Updates (READ FIRST)

**The single most-forgotten thing in this repo.** OTAs only reach users whose installed native binary advertises a matching `runtimeVersion`. We manage the string manually in `app.json` — it tracks `version` (read both from `app.json`; do not trust any number quoted in this doc), so it's on you to bump it whenever the native shape of the app changes.

**⚠️ MANDATORY: Bump `runtimeVersion` in `app.json` when ANY of the following change:**
- New, removed, or upgraded native dependency (anything that adds/changes native code)
- Changed `app.json` native config (permissions, plugins, bundle ID, splash, etc.)
- Changed `ios/Podfile`, `ios/Podfile.lock`, or CocoaPods configuration
- Changed `android/build.gradle`, `android/app/build.gradle`, or native Android config
- Changed or added EAS build plugins
- Changed `app.config.ts` or anything under `plugins/` (our three local Expo
  config plugins — see "Expo Config" below)
- Changed Expo SDK version

**Do NOT bump for:**
- JS-only changes (screens, components, styles, i18n, hooks, utils)
- Asset changes (images, fonts)
- OTA-publishable config changes

**Mental shortcut:** if your change requires a fresh `npm run build:ios:prod` / `release:ios` / `release:android` to take effect, bump `runtimeVersion`. If `npm run update` (OTA) is enough, leave it alone. If you forget, your next OTA targets a runtime no installed user has → reaches nobody.

**Convention:** Keep `runtimeVersion` in sync with `version` in `app.json`. When making a native change, bump both together (e.g., `"4.7.0"` → `"4.8.0"`). `bump-version.sh` (run via `npm run patch/minor/major`) automatically resets the `package.json` `update` field to `"0"` on each native version bump so the OTA counter restarts cleanly.

The server's `/config` endpoint returns `LATEST_VERSION` which the app compares against `Application.nativeApplicationVersion`. If the user's native build is behind, they are prompted to update from the store before checking for OTA patches. See `app/utils/checkForUpdates.ts`.

**Why not the `fingerprint` policy?** We tried it (commit `7a38e44`) and reverted (commit `aecb4f4`) because the hash came out different on local builds vs EAS — our postinstall / prebuild pipeline (`patch-package` on postinstall plus `scripts/patch-android.sh`, which `npm run prebuild:clean` and `prebuild:android:clean` run to copy `google-services.json` and apply native settings Expo doesn't handle) is not deterministic across environments, so the local-computed fingerprint and the EAS-computed fingerprint disagreed. Plus a stale EAS GraphQL token broke fingerprint computation entirely on local builds. Significant time was spent trying to fix this; manual is the pragmatic floor. Don't revisit fingerprint without first making the postinstall pipeline reproducible across environments.

## Releasing (OTA & Native)

Two release paths. **Pick based on whether `runtimeVersion` changed** (see the
section above): JS-only → OTA; native shape changed → full store build.

### OTA release (JS-only changes)

One command does the whole pipeline:

```bash
npm run update
```

`scripts/bump-update.sh` runs end-to-end — it is NOT just a counter bump:
1. Increments the `update` counter in `package.json` (e.g. `v4.5.0-6` →
   `v4.5.0-7`); the native `version` stays put.
2. Commits **only** `package.json` (`🔖 ota: v4.5.0-7`) and creates an annotated
   git tag `v4.5.0-7`.
3. `git push && git push --tags`.
4. **Publishes the OTA**: `npm run release:ota` → `eas update --branch production
   --auto`. Reaches only users whose installed native build advertises a
   **matching `runtimeVersion`**.
5. Uploads JS source maps to Sentry (needs `SENTRY_AUTH_TOKEN` in env / `.env`;
   non-fatal if missing — new-bundle stack traces just lack `file:line` until the
   next successful upload).

**Before you run it:**
- **Commit your feature work AND the `CHANGELOG.md` update first.** `eas update`
  bundles the current working tree (so anything uncommitted still ships), but
  `bump-update.sh` only commits `package.json` — committing first keeps the tagged
  release commit honest about what actually went out.
- Move `CHANGELOG.md` `[Unreleased]` content under a new `[X.Y.Z-N]` heading
  matching the about-to-be-created counter. The bump scripts do **not** touch the
  changelog (see "Changelog Discipline").
- Re-confirm you genuinely did **not** need a `runtimeVersion` bump. If you did,
  this OTA targets a runtime no installed user has → reaches nobody. Do a native
  release instead.

### Native release (anything that changed `runtimeVersion`)

```bash
npm run patch            # or: npm run minor / npm run major
# then MANUALLY bump `runtimeVersion` in app.json to match the new version
npm run release:ios      # eas build --profile production + eas submit --latest
npm run release:android  # eas build --profile production + eas submit --latest
```

`scripts/bump-version.sh` bumps `version` in `package.json` / `app.json` /
`package-lock.json`, **resets the `update` counter to `0`** (each native build
starts a fresh OTA series), commits + tags `vX.Y.Z`, pushes, then runs
`npm run prebuild:clean`. It does **NOT** touch `runtimeVersion` — that stays a
manual edit (the whole point of the warning above). Once the store build is live,
later JS-only fixes ride on top of it as OTAs via `npm run update`.

## EAS Build pre-install hook

`scripts/eas-pre-install.js` is wired into `package.json` as
`eas-build-pre-install`. EAS Build automatically invokes it in the
build environment BEFORE `npm install` runs. It checks
`process.env.EAS_BUILD_PROFILE`:
- **`production`**: mutates `package.json` to add
  `expo-dev-client` / `expo-dev-launcher` / `expo-dev-menu` to
  `expo.autolinking.exclude`, so those native modules don't get
  autolinked into the production AAB/IPA. This eliminates Play
  Console warnings rooted in `DevLauncherExpoActivityConfigurator`
  (deprecated edge-to-edge APIs) and
  `GmsBarcodeScanningDelegateActivity` (Android 16 large-screen
  resizability). The mutation lives in the build container's
  ephemeral checkout; the repo's committed `package.json` is
  untouched.
- **anything else** (development / preview / unset): no-op. Dev
  builds keep the dev menu, QR-scan-to-server flow, fast refresh
  control, and network inspector intact.

The hook fires for both EAS cloud and `eas build --local`. It does
NOT fire for `npx expo prebuild` directly (no
`EAS_BUILD_PROFILE`), which is the right behavior for local dev
iteration. Do not delete the script without removing the
`eas-build-pre-install` entry from `package.json` — and don't add
the exclude list to the committed `package.json` instead, that
would break dev/preview builds where we genuinely need
`expo-dev-client`.

## Expo Config: `app.json` + `app.config.ts` + `plugins/`

Three layers, resolved in that order.

**`app.json`** is the static config and is **flat** — `version`, `runtimeVersion`,
`plugins`, `ios`, `android` sit at the top level, NOT nested under an `expo` key.
Anything reaching for `config.expo.version` gets `undefined`.

**`app.config.ts`** is the dynamic layer. It imports `tsx/cjs` so config plugins
can be written in TypeScript without a compile step, then spreads the static
config and appends the iOS privacy manifest plus our three local plugins.
It also overrides the `react-native-auth0` plugin's `domain` with
`EXPO_PUBLIC_AUTH0_DOMAIN` (ADDED 2026-09-28): that domain is baked into
Android's login-redirect intent filter, and it must match the tenant the JS
talks to or Google/Apple sign-in hangs after the browser step. EAS gets the
prod domain from `eas.json`; a local build follows `.env`.

**`plugins/`** holds those three, each solving something Expo doesn't:
- `withDebugNetworkSecurity` — cleartext HTTP in debug builds so Metro can reach
  a physical device, plus a defensive `tools:replace` so our attribute wins any
  future library-manifest merge conflict.
- `withSplashScreenWindowBackground` — kills the white flash between the Android
  system splash and JS first paint by pointing `AppTheme`'s `windowBackground` at
  a layered drawable mirroring the splash.
- `withUsesFeatures` — declares hardware features `required="false"` so Play
  doesn't filter cellular-less tablets, Chromebooks, Android Auto, or Android XR.
  The Zoom SDK's AAR used to contribute these and we lost them ripping it out in
  4.5.0.

**⚠️ `expo run:ios` / `run:android` reuse an existing `ios/` / `android/`, so a
plugin edit silently never runs.** You must `npm run prebuild:clean`. The failure
mode does not look like a plugin problem — it surfaces as a missing SDK header or
a mysteriously-unchanged native behavior, and costs an hour if you don't know
this. Plugin edits are native-shape changes: **bump `runtimeVersion`.**

## Architecture

### Path Aliases
- `@/*` → `./app/*` (`babel-plugin-module-resolver` in `babel.config.js`)
- `@assets/*` → `./assets/*` (`config.resolver.extraNodeModules` in `metro.config.js`)

**There is no `@common` or `@sqlite` alias.** Code imports the common lib's subpath
exports directly — `@recoverysky-org/common/browser` and
`@recoverysky-org/common/sqlite` — resolved the normal Node/Metro way via
`node_modules` (the package's `package.json` declares `"./browser"` and
`"./sqlite"` in its `exports` map). `tsconfig.json`'s `paths` entries for those
two specifiers just map the string to itself; they exist to satisfy TS's
`paths` typing, not to alias anything. If you see `@common` or `@sqlite` in
older code or docs, that's stale — see "Linked Packages" below for why.

### Linked Packages (historical — no longer applies)
`@recoverysky-org/common` used to be a symlinked sibling checkout, which needed
Metro workarounds (`watchFolders`, `nodeModulesPaths`) and a `--clear` restart
after edits, plus `@common`/`@sqlite` babel aliases pointing at its `lib/`
output. That setup is gone: the package is now a plain registry dependency
(a caret range in `package.json`), installed into
`node_modules` like anything else. `metro.config.js` has no
`watchFolders`/`nodeModulesPaths` entries and no sibling directory exists on
disk. Bumping the version is a normal `npm install` + `package.json` edit —
see the Build entries in `CHANGELOG.md` for recent bumps.

### State Management (MobX-State-Tree)
MST with MMKV persistence in `app/models/`:
- **RootStore**: Combines all stores, initialized in `app.tsx`
- **AuthenticationStore**: Auth state with two storage tiers:
  - **Props** (MMKV): `refreshToken`, `authEmail`, `userId`, `deviceId`, `isAnonymous`,
    `loginMethod` (how the current session was established — `"email" | "apple" |
    "google"`; drives the logout branch, see "Auth, Attestation & Encryption
    Keys" §1), `ownerSub` / `ownerEmail` (the device owner — the one account
    whose local data this install holds; survives logout, cleared only by
    `resetLocalDatabase()`, see "Database Layer"), `previousOwnerSubs` (the
    owner's subs from before their identity was linked into another account;
    see "Auth, Attestation & Encryption Keys" §1)
  - **Volatile** (memory only): `accessToken`, `idToken`, `expiresAt` — never
    persisted to MMKV; `foreignSession` (a session the ownership gate refused
    — sub/email/idToken/loginMethod, held only while `WrongAccountScreen` is
    up, never persisted — see "Navigation" and spec
    `docs/superpowers/specs/2026-09-17-device-owner-and-wrong-account-recovery-design.md`)
  - Computed: `isAuthenticated`
- **ProfileStore**: User profile and preferences with two storage tiers:
  - **Props** (MMKV snapshots): display toggles (`showCleanDate`/`showCleanDays`/`showPronouns`), `subscription` / `subscriptionExpires`, `themeColor`, `onboardingCompleted`, `attendanceEnabled`, `syncEnabled` (cloud backup opt-in, default OFF), `enableMeetingTopic`, `notificationsEnabled`, `locationEnabled` (default OFF — see "Permissions & the Location Gate"), `reportEmail`, `imported`, `aiConsentAccepted`, `dismissedHomeCards`, `seenAnnouncementIds`, `dontShowShortMeetingWarning`, the `moneySaved*` family (weekly total + one per weekday + `moneySavedTobacco`), the `ninety*` family (`ninetyStartDate` / `ninetyStartEpoch` / `ninetyStrictMode` / `ninetyCertificatePath`, plus DEV-only `ninetyDebugDay`)
  - **Volatile** (encrypted SQLite): shortName, pronouns, recoveryDate, fellowship, language — sensitive data kept out of snapshots
  - Computed views: `displayName`, `cleanDays`, `isPremium`
- **NetworkStore**: Online/offline tracking with `isOffline`, `hasInternet` computed. Fed by the NetInfo listener in `app/services/network/` (registered once in `app.tsx`; sole writer). `isOffline` keys off the interface state, not the reachability probe.
- **ConfigStore**: Server-provided config fetched from `/config` endpoint. Fields: `apiUrl` / `agentUrl` / `socialUrl`, `authKey`, RevenueCat keys (3 separate: test, Apple, Google) with computed `revenueCatApiKey` view selecting by `__DEV__` and `Platform.OS`, `otlpApiKey`, Umami keys, `reviewEnabled`, `maintenanceMode` / `maintenanceMessage` / `maintenanceUntil`, `outageMode`, `latestVersion`, `mapStyleUrlLight` / `mapStyleUrlDark` (full MapTiler style URLs — the API key rides inside them and is deliberately **never** baked into the binary), `presenceRadiusM` (default 150 m; `devPresenceRadiusM` overrides it in dev builds only), `isLoaded` / `isLoading`. NOT persisted to MMKV (security). The raw /config payload IS cached in the encrypted SQLite `config_caches` table so warm cold-starts skip the fetch gate — maintenance fields are never applied from cache. See `applyServerConfig` and docs/superpowers/specs/2026-08-14-config-cache-cold-start-design.md. There are **no Zoom SDK fields** — the bundled SDK was removed in 4.5.0 (see "Zoom Integration").
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
- **MeetingFiltersContext**: the Meetings tab's shared Fellowship + Lang browse filters (see "Shared filter bar" under Navigation)
- **SubscriptionContext**: RevenueCat subscription state — `isPremium`, `hasAttendance`, `showPaywall()`, `showPaywallIfNeeded()`, `restore()`, `login()`, `logout()`

```typescript
import { useMeetings } from "@/context/MeetingContext"
const { meetings, liveMeetings, isLoading, refresh } = useMeetings()

import { useSubscription } from "@/context/SubscriptionContext"
const { isPremium, hasAttendance, showPaywall } = useSubscription()
```

### Navigation
React Navigation v7 in `app/navigators/`:

**App-level gating** (`AppNavigator.tsx`): outage check → (authenticated: Onboarding | Main) → WrongAccount (when `authStore.foreignSession` is set) → Login. The outage check (`configStore.outageMode`) takes precedence and routes to `MaintenanceScreen` when cold start landed in an unusable state — `/status` precheck failed, `/config` fetch failed, or `/config` reported `MAINTENANCE_MODE: true` at startup. See "Maintenance Mode" below. The remaining gates are `authStore.isAuthenticated` and `!profileStore.onboardingCompleted`. There is **no Zoom gate** — `ZoomSetupScreen` / `zoomConnected` were removed in 4.5.0.

CHANGED 2026-09-18 (spec `2026-09-17-device-owner-and-wrong-account-recovery-design.md` §2.2): a fourth state sits between Login and the rest. `WrongAccountScreen` shows while the SDK holds a session whose sub is not `ownerSub`; `isAuthenticated` is false in that state by construction (the ownership gate in `useAuth0Wrapper` writes no token for a mismatched session), so no identity-driven reaction ever sees it. `initialRouteName` mirrors the same branch order exactly — only the matching `<Stack.Screen>` is registered per render, so it must not diverge.

**Main tabs** (`MainNavigator.tsx`): Home, Meetings, Attendance (conditional on `profileStore.attendanceEnabled`), Settings. Two tabs are built but **hard-disabled behind local `const … = false` flags**, not entitlements: `agentTabVisible` (Agent — hidden until release-ready) and `socialTabVisible` (Community/Social — hidden pending SPA-side fixes; re-enable with `__DEV__ || isPremium`). `useSubscription()`'s `isPremium` is still read and `void`-ed here so the hook stays wired for future gates — don't "clean up" that line.

**Meetings tab segments** (`MeetingsScreen.tsx`): Online | In-Person | Search,
with segment keys `live` / `inperson` / `listings`. The labels were renamed and
the keys were not, so don't rename keys to match labels. `MeetingsScreen` is the
segmented-control shell; each segment's content is a named export from its own
screen file (`LiveContent`, `InPersonContent`, `ListingsContent`). All three
mount at app start, and inactive ones are hidden with `display: "none"`, not
unmounted.

**Shared filter bar.** Fellowship and Lang live in `MeetingFilterBar`, directly
below the segmented control. State is `MeetingFiltersContext` (owned by
`MeetingsScreen`; MMKV keys `meetings.fellowship` / `meetings.language`; pure
decisions in `meetingFiltersLogic.ts`).
- It is a browse selection and never writes `profileStore.fellowship`. It
  follows Settings through the `preferences_changed` event, **not** a MobX
  reaction: hydration assigns `profileStore.fellowship` on every cold start,
  and a reaction would wipe the remembered pick.
- Segments call `reportMeetings()` so the Lang picker offers the active
  segment's languages.
- Each segment's "Show all languages" empty state must be checked before its
  other catch-all empty branches, or it never renders.

**Starts In** (Live segment: `useAtNextSchedules`, pure `atNextLogic.ts`,
`GET /schedules/at-next`) is currently `__DEV__`-only, via `startsInVisible` in
`LiveScreen.tsx`.
- The control reads "[Live Now] Starts in [15m|30m|45m|60m]", and the Live
  heading follows the pick. The hook prefetches all four offsets as one
  parallel batch (on showing Live, on foreground, after each quarter-hour
  boundary, and on pull-to-refresh), so tapping a chip only chooses a slot.
- Each offset names ONE coming quarter-hour mark, and the app sends
  `starts_at=true`, so only meetings starting exactly at that mark appear. A
  7:05 meeting never shows under Starts In; that's the API contract (api repo
  `src/openapi.ts`), not a bug.
- Chips left empty by the Fellowship + Lang filters are hidden
  (`availableStartsIn`), and the whole control hides when every chip is empty.
  As marks move, a pick follows its meetings to whichever chip now shows that
  mark (`followStartsIn`). Once the mark passes or its chip is hidden, it moves
  to the lowest visible chip, and to Live Now only when no chip is left. While
  a batch loads, the pick and chips hold still.
- The pick resets to Live Now on the segment's **hide** edge, not the show edge.
  The hook's effects run first in the same commit, so a show-edge reset fired
  one wasted request per visit.
- The hook refetches once, just after the next boundary (`refetchDelayMs`,
  60 s floor), keyed on the LATEST boundary across slots so one failed slot
  can't turn the refetch into a 60 s poll. Timers pause while `AppState` isn't
  `"active"`. A failed refresh keeps the last rows (only until that slot's own
  boundary) and shows an inline tap-to-retry, never a blank list.

Spec (its appendix holds the full change history):
`docs/superpowers/specs/2026-09-26-meetings-filter-bar-and-starts-in-design.md`.

A `meetingId` route param force-routes to the segment the caller supplied,
falling back to `live` only when none is given. It used to hardcode `live`
unconditionally, which sent in-person deep links to a segment that discards
in-person records; the four-part `returnTo` form (`Meetings:<segment>:meetingId:<id>`,
parsed by the vitest-covered `app/utils/returnToLogic.ts`) is what carries the
segment now. Don't hand-assemble those strings — use the builder in that module.

The In-Person segment takes **two** props and they are not interchangeable.
`active` (`inPersonActivated`) is a one-way latch — false until the user first
opens the segment, then true forever — so location is requested lazily and never
at app start. `visible` is true only while In-Person is the on-screen segment.
Everything that must survive a segment switch keys off `active`; only the map
subtree keys off `visible` (via `effectiveViewMode`), because a MapLibre GL
surface and its native location consumer must not sit alive inside a hidden view.
Collapsing the two either mounts a GL surface for a segment the user never opened
or tears down fetch state on every tab tap.

**Modals** (app-stack level): Import (Firebase data import from Settings), Licenses (OSS licenses), Terms.

**Section routing**: Attendance tab accepts `{ section?: "new" | "archive" | "reports" }` route params. Navigation to a specific section uses `navigate("Attendance", { section: "reports" })`. The screen syncs via `navigation.addListener("focus", ...)` to handle repeated navigations to the same section.

Route types defined in `app/navigators/navigationTypes.ts`.

### Database Layer
SQLite with Drizzle ORM in `app/db/`:
- **DatabaseProvider**: Runs Drizzle migrations on startup, seeds data on first launch
- **provider.ts**: Creates expo-sqlite database and Drizzle instance
- **repositories.ts**: Lazy proxy objects over common-lib repository classes — `meetingRepo`, `scheduleRepo`, `attendanceRepo`, `attendanceReportRepo`, `feedbackRepo`, `chatMessageRepo`, `reminderRepo`, `syncQueueRepo`, `attendanceSyncWriter`, `profileRepository`. This file is also the **single mutation choke point** that enqueues to the sync outbox (see "Attendance Cloud Backup & Sync"); `attendanceSyncWriter` is the deliberate bypass used by inbound pulls.
- **attendanceEvents.ts**: Simple pub/sub for cross-component attendance updates. Event types: `"created" | "processed" | "produced" | "archived" | "delivery_resolved"`. Subscribe in `useEffect`, emit after mutations. `delivery_resolved` includes `deliveryError?: boolean` for report delivery status.
- **liveEvents.ts** / **reminderEvents.ts**: Similar pub/sub for live meeting preference and reminder changes
- **Resumer/hydrator components** mounted in the provider tree: `ProfileHydrator`, `ChatHydrator`, `ReportPollingResumer` (restarts delivery polling after a cold start), `TimerSessionResumer` (recovers an external-Zoom timer session killed mid-meeting), `SyncResumer`, `BackupPassRunner` (the one-off cloud-backup pass — see `docs/BACKUP.md`; bump `BACKUP_PASS_ID` in `backupPassLogic.ts` to run it again)

Migrations come from `@recoverysky-org/common/sqlite` (the `migrations` export), using the `useMigrations` hook.

**Opening the encrypted database (RS-024, 2026-09-14).** `SQLiteErrorException:
Error code 7: out of memory` on the first statement after `PRAGMA key` is
SQLCipher's *wrong-key* signature, not memory pressure: a codec failure makes
`sqlite3Codec` return NULL and the pager maps that to `SQLITE_NOMEM`, and the
codec latches the error on that connection for good. The rules that fell out of
it, all in `app/db/`:
- `acquireKey.ts` decides whether to mint a key (pure logic in
  `dbOpenLogic.ts`, vitest-covered). **It refuses to generate a key while an
  encrypted database file exists** — that combination means the keychain lost
  the key, and a fresh key can only brick the install. Do not "simplify" this
  back to get-or-generate.
- `DatabaseProvider` opens once per mount, closes the singleton on failure (a
  retry on the old handle can never succeed), backs off for transient causes
  (locked keychain → `errSecInteractionNotAllowed` from a background launch),
  retries on foreground, and stops for a wrong/missing key so the overlay can
  offer **Reset local data**. Keep `status` out of the open callback's deps —
  that dep is what produced 29 attempts a second.
- The key and the file are one unit: anything that removes one goes through
  `resetLocalDatabase()` (close → delete file + `-wal`/`-shm`/`-journal` →
  clear key). Settings → Delete User Data does this and then `reloadApp()`.
  CHANGED 2026-09-18 (spec 2 §1.4): and so is the owner record —
  `resetLocalDatabase({ clearOwner })` clears `ownerSub`/`ownerEmail` as the
  last step of the same teardown, after the file and key are gone, so a
  failure earlier leaves the owner record intact rather than clearing
  ownership over a database that's still on disk. Both callers pass
  `authStore.clearOwner`; `clearOwner` is injected rather than imported so
  `app/db/` does not grow a runtime dependency on `app/models/`.

### API Layer
Apisauce wrapper in `app/services/api/`:
- Dual auth: device authorization (`X-Device-Token` / `X-API-Key`) + user OAuth (`Authorization: Bearer`)
- API methods return discriminated unions: `{ kind: "ok", data } | GeneralApiProblem`
- Attestation queueing: `createSingleFlight` inside the refreshers dedupes concurrent attestation calls — every request reaches it through the token freshness gate, rather than only the methods that remembered to call a helper.
- Device auth: no exposed setter any more — `installAuthGate` stamps `X-Device-Token` from the device refresher's return value on each request, falling back inline to `X-API-Key` from `this.authKey` when the refresher returns null (simulators, web, Android dev builds — see `setApiKeyFallback()` below)
- Public status probe: `getPublicStatus()` bypasses the token freshness gate via the `X-Skip-Auth-Gate` sentinel header and is the only API call that can run before any device JWT is set. Used at cold start to detect API outage *before* attempting attestation — see "Maintenance Mode" below. The authenticated `getStatus()` (which goes through the gate) is still used at runtime by `MeetingContext` for the connectivity indicator.
- Server config endpoint (`/config`) provides runtime keys for RC, OTLP, Umami
- Report endpoints: `sendReport()`, `resendReport()`, `getReportStatus()` for attendance report delivery and polling
- Firebase import endpoints: `getFirebaseUser()`, `getFirebaseAttendance()`, `getFirebaseReports()`, `checkFirebaseUser()` — types exported as `FirebaseUserData`, `FirebaseAttendanceRecord`, `FirebaseReportRecord`

### Auth, Attestation & Encryption Keys

Three separate trust layers, easy to confuse:

1. **User identity — Auth0** (`app/services/auth/`). Three ways in (spec
   `docs/superpowers/specs/2026-09-12-passwordless-login-design.md`): an
   in-app email code (`sendCode` / `verifyCode` — `authorizeWithEmail` MUST
   get our `audience` + `scope` or the token comes back opaque and the user
   is signed out one tick after signing in, spec §2.2), and Apple / Google
   via `authorize({ connection })` so Auth0's Universal Login web screen
   never renders. Config in `auth0.ts` (scheme `recoverysky-app`,
   `offline_access`), consumed through `useAuth0Wrapper.ts`. Only
   `refreshToken` persists (MMKV); `accessToken` / `idToken` / `expiresAt`
   are volatile by design. `vault.ts` is a **web-only** storage shim (native
   uses Keychain/Keystore). Every access token must pass the pure
   `isUsableAccessToken()` (`jwtUtils.ts`) before it enters the store,
   because an audience-less refresh token renews into an opaque
   userinfo-only token forever. The refresher is `userTokenRefresher.ts`
   (injected I/O, vitest-covered).

   `loginMethod` is recorded on the store only for an ACCEPTED session — one
   the ownership gate below did not refuse. Logout branches on it:
   `clearCredentials()` for `"email"` (no browser session was ever created,
   so there is nothing for `clearSession()` to revoke and no iOS system
   "Sign In" dialog to cancel), `clearSession()` for `"apple"` / `"google"`.
   The ownership gate (`decideOwnership`, `ownerLogic.ts`, vitest-covered)
   runs before any token is written — see "Navigation" above and
   "Attendance Cloud Backup & Sync" below for what it protects. The
   password migration for pre-passwordless accounts is entirely an Auth0
   post-login Action, not app code — see spec 1 §3.5.

   ADDED 2026-09-30 (spec 2 §7): the gate has a fourth outcome, `relinked`.
   When the owner's identity is linked into another account from a
   DIFFERENT device, Auth0 answers the owner with the primary's sub. The
   gate finds `ownerSub` among the identities claim's `sub` fields, moves
   the owner there (`relinkOwner`, old sub kept in `previousOwnerSubs`),
   and rewrites local `uid` columns (`app/db/rewriteOwnerUid.ts`, raw SQL so
   nothing re-enqueues; `OwnerRelinkMigrator` repeats it on each DB open).
   The sync service then restamps the outbox instead of clearing it. Without
   the claim's `sub` (Action v1, or prod today) the device loops on the
   wrong-account screen.

   CHANGED 2026-09-18: the pending login method — which of
   `sendCode`/`verifyCode`/`loginWithProvider` is in flight, read by the
   `[user]` sync effect once the SDK sets `user` — is a MODULE-SCOPED
   variable in `useAuth0Wrapper.ts`, **not** a `useRef`. The hook has FIVE
   mount sites — `AppStack` (`AppNavigator.tsx`, bare), `LoginScreen`,
   `WrongAccountScreen`, `SettingsScreen` and `DevScreen` — and every one of
   them registers the `[user]` sync effect. At least two are live during any
   login: `AppStack` plus whichever of `LoginScreen` / `WrongAccountScreen`
   is on screen. A per-instance ref left the other copies permanently
   `undefined`, and whichever instance flushed last (usually `AppStack`,
   since child effects flush first) overwrote the real value with it. An
   email-code foreign session then looked
   "browser possible" and `abandonForeignSession()` opened a browser — plus
   the iOS system dialog — to clear a cookie that never existed. Don't move
   this back into per-instance state.
2. **Device trust — attestation** (`app/services/attestation/`). Apple App
   Attest / Google Play Integrity via `@expo/app-integrity`, exchanged for a
   device JWT sent as `X-Device-Token`. The JWT and the iOS key id persist in
   SecureStore (`device_jwt_v1`, `app_attest_key_id_v1`: per install, kept on
   sign-out). Cold start asserts against the stored key
   (`POST /attest/assert`) and mints a new key only when the server rejects
   it. Decisions live in the pure `deviceTokenLogic.ts`, native calls in
   `index.ts`, I/O in `deviceToken.ts`. Temporary failures **degrade** (the app
   opens, `configStore.deviceAuthDegraded` shows the "Connecting…" banner, the
   refresher retries). Only `unsupported` or a 401/403 on `POST /attest`
   blocks; a 400 `bad_nonce` or a 429 degrades. Simulators, web, and Android
   dev builds call `setApiKeyFallback()` and use `X-API-Key` instead.
3. **Data-at-rest — SQLite key** (`app/services/encryption/sqliteKey.ts`).
   Anonymous users get a locally generated 256-bit key in SecureStore
   (`sqlite_encryption_key_v1`); authenticated users get it from JWT custom
   claims. This is what makes ProfileStore's "volatile (encrypted SQLite)" tier
   actually encrypted.
   CHANGED 2026-09-30: the JWT half is dormant. No tenant Action issues
   `https://recoverysky.app/metadata` (`auth0/actions/<tenant>/` is the source of
   truth, and neither tenant folder has it), so EVERY device, signed in or not, runs on
   its locally generated key. The rekey-on-login path in `useAuth0Wrapper` has
   never run in production, so adding that Action is a new feature, not a
   restore. See `auth0/README.md` "Not implemented".

**Token freshness gate** (`installAuthGate`, installed in the `Api`
constructor). A single async request transform awaits two refreshers and stamps
`X-Device-Token` / `Authorization` onto each request. There are no sticky auth
headers.
- Refreshers are **injected** via `api.registerTokenRefreshers()` from
  `app.tsx`, never imported. `app/services/api/` must stay a dependency leaf
  (`attestation → api`), or depcruise sees a cycle.
- Bypass is the `X-Skip-Auth-Gate` sentinel header, not a URL list (`/status`
  and `/status/ready` share a router). It is also the recursion guard for the
  device refresher's own `/attest` call.
- Skews are asymmetric on purpose: 60 s for Auth0 (passed to the SDK as
  `minTtl`), 5 min for the device token.
- A refresh failure classified `permanent` (`tokenFreshnessLogic.ts`) forces a
  logout — **deferred while `isTimerSessionActive()`**, because the eject
  would kill an in-meeting timer that `TimerSessionResumer` can't recover.
  Unknown error codes default to `transient` deliberately.
- The user lane also latches permanent on a renewed token that fails the shape
  check (`UnusableTokenError`) and on a 401 carrying `token_malformed` /
  `token_claims` / `token_signature`. `token_expired`, `token_invalid`, a
  code-less 401, and a 503 `auth_unavailable` never do.
- **Device-lane reactive 401.** The device middleware answers a bad
  `X-Device-Token` with a *code-less* 401, while user-lane rejections carry
  `code: token_*`. `deviceJwtRejected()` (`bearerRejectionLogic.ts`, an
  apisauce monitor) detects that, and `markDeviceJwtRejected()` drops the JWT
  from memory and SecureStore so the next request re-asserts. One exception
  (RS-040): the exact missing-`Authorization` body
  (`USER_LANE_MISSING_CREDENTIALS_BODY`) is a user-lane answer and does not
  drop the JWT. Before this path existed, a dead JWT was re-sent for up to
  seven days and CrowdSec banned the device.
- **No credential → no request.** When the gate has neither a device JWT nor an
  API key (production has no `EXPO_PUBLIC_AUTH_KEY`), it installs
  `noDeviceCredentialAdapter`. The request resolves locally as a 401
  (`no_device_credential`), call sites get `{ kind: "unauthorized" }`, and
  nothing reaches the wire. Don't restore the bare send.
- **Retry ladders retry transport failures only** (`isRetryableProblem()`,
  `contentRetryLogic.ts`). `ConfigStore.fetchConfig`,
  `MeetingContext.retryWithBackoff`, and the nearby fetch's retry all stop on
  the first 401/403/404/429.

Specs under `docs/superpowers/specs/`: `2026-08-06-jwt-refresh-design.md`
(design, manual test checklist, and an appendix with this section's full change
history), `2026-09-09-app-attest-assertions-and-jwt-persistence-design.md`,
`2026-09-10-opaque-access-token-after-idle-renewal-design.md`.

### Maintenance Mode

Two distinct states — **never conflate them.** One is a non-blocking banner,
the other a full-screen takeover, and using the wrong gate has killed
in-meeting Zoom timers before.

- **`configStore.maintenanceMode`** (runtime): `/config` reported
  `MAINTENANCE_MODE`, or `/config` polling failed past its retry budget
  **while online**. Offline poll failures never set it — the banner shows its
  offline variant and polling pauses until reconnect (`connectivityLogic.ts`,
  vitest-covered). Shows `<MaintenanceBanner />` and makes API-dependent
  features self-disable. **It never gates the navigator**: the mid-meeting
  `ExternalZoomTimerModal` inside `SchedulePopup` must survive it.
- **`configStore.outageMode`** (cold-start gate, set by `setOutageMode()` in
  `app.tsx`'s init path) is the only thing that routes `AppNavigator` to
  `MaintenanceScreen`. Triggers:
  1. `api.getPublicStatus()` (`GET /status/ready`; the body must be
     `{ "status": "ready" }`, checked by `isReadyBody()`) fails. This runs
     BEFORE attestation so an outage isn't misreported as "Device Verification
     Failed".
  2. `/config` fails after that precheck passed — **except** when the device
     lane came back `degraded`. A degraded device gets 401s from `/config`
     while `/status/ready` is healthy, so outage recovery would reload-loop
     forever (burning an Apple key generation per cycle). That start renders
     on env-var defaults with the "Connecting…" banner and arms a one-shot
     reload for when `/config` finally loads.
  3. `/config` returns `MAINTENANCE_MODE=true`.

  Triggers 2 and 3 fire only on a cold config cache. Warm starts seed
  ConfigStore from SQLite, fetch in the background, and show maintenance as the
  banner instead (`2026-08-14-config-cache-cold-start-design.md`). Recovery
  polls `/status/ready` every 15 s and then calls `Updates.reloadAsync()`,
  because re-initialising in place would duplicate the bootstrap's MobX
  reactions. Runtime maintenance never clears outage mode.

**The banner** (`app/components/MaintenanceBanner.tsx`) is a sibling of
`<AppNavigator />` in `app.tsx`, absolutely positioned above every screen and
modal. Variants, in priority order: offline (wins — it's the more accurate
diagnosis) → "Network issues" → "Connecting to RecoverySky…"
(`deviceAuthDegraded`) → amber maintenance. `MaintenanceScreen` mirrors the
offline/network/maintenance split and switches live.

**`configStore.maintenanceCause`** (`"server" | "network"`, ADDED 2026-09-28)
says why `maintenanceMode` / `outageMode` is on. It is `"network"` when every
failed attempt was `cannot-connect` / `timeout` (`decideMaintenanceCause`),
meaning no answer arrived at all. That's the device whose interface is up but
not getting through (dead Wi-Fi backhaul, captive portal, one bar), which
`isOffline` can't see because it keys off the interface. The cause picks
**copy only**. Every feature guard still reads `maintenanceMode` /
`outageMode`, so API features pause identically either way. NetInfo's
`isInternetReachable` may only sharpen the network copy ("no-internet"), never
trigger a banner by itself: the probe host is blocked on some national
networks. Amber is for the server's own `MAINTENANCE_MODE` or a real server
error. When a ladder ends with a `"network"` cause, the **internet oracle**
(`services/network/oracle.ts`) probes 1.1.1.1 and 8.8.8.8 by IP with a 3 s
budget before the banner flips. Its verdict (`networkStore.internetOracle`)
outranks NetInfo's probe for the copy. It only runs after such a failure,
never on a timer, because it reveals the device IP to both providers. Log
recipes are in `docs/DIAGNOSTICS.md` "Network quality & the internet oracle".

**Features that self-disable under `maintenanceMode`.** Each has its own guard,
so any new API-dependent feature needs one too:
- `MeetingProvider.refreshLiveMeetings()` — the guard and the recovery reaction
  both use `isLiveRefreshBlocked()` (maintenance OR outage). Outage must be
  watched too, because `Updates.reloadAsync` throws in `__DEV__`. A failed
  refresh keeps the last list; don't reintroduce `setLiveMeetings([])`.
- `ListingsScreen.fetchDailySchedules()` — a separate fetch path with its own
  gate.
- `useReportSender.send()`, plus the AttendanceScreen Send button
  (`canSendReport && !maintenanceMode`).
- `SchedulePopup.handleCellPress()` — blocks reminder edits, since reminders
  depend on server-side push scheduling.
- Settings → Import row.

`MAINTENANCE_UPDATE` was removed on purpose; the regular foreground OTA check
covers that case. Read `maintenanceMode` from MobX (outside React:
`rootStore.configStore.maintenanceMode`) — a parallel event bus would create two
sources of truth.

Spec (its appendix holds this section's full change history):
`docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md`.

### Subscription System (RevenueCat)
In `app/services/purchases/`:
- **config.ts**: Entitlements (`recoverysky-premium`, `recoverysky-attendance`), API key selection by env/platform. No offering ids — CHANGED 2026-09-15, the paywall always uses RevenueCat's **current** offering (the hardcoded ids never existed in the project and the fallback to `current` was the only path that ran); change the paywall from the dashboard, not the code
- **revenueCatService.ts**: SDK init, entitlement checks, offering-aware paywall presentation, purchase/restore flows
- **SubscriptionContext** (`app/context/`): Wraps the app, initializes RC with `configStore.revenueCatApiKey`, listens for customer info updates, auto-enables attendance on first subscription. **Identity is a MobX reaction on the auth store, not a prop** (CHANGED 2026-09-17): the Auth0 `userId` when signed in and not anonymous, otherwise no id at all so the SDK runs on its own `$RCAnonymousID` that `logIn()` later aliases. **The device id is never a RevenueCat identity** — the old render-time prop left the SDK on the device id after sign-in and stranded 81 active subscriptions on device-id customers (2026-09-17 export). Store receipts are synced once **per identity per install** (`rc_purchases_synced.<sub>`), which is also what moves a stranded subscription over (Restore Behavior = Transfer, verified 2026-09-17). Decisions in the vitest-covered `rcIdentityLogic.ts`; spec `docs/superpowers/specs/2026-09-17-revenuecat-identity-reactive-design.md`. Don't reintroduce an `appUserId` prop.

Key pattern: `__DEV__` uses the `test_` RC API key (Test Store). Production uses platform-specific `appl_`/`goog_` keys. Both use the project's current offering. `__DEV__` is false in TestFlight builds.

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

### Smaller Subsystems (know they exist before rebuilding one)

- **Rating engine** (`app/services/rating/`) — two-stage soft-ask app-review
  prompts. Only four entry points are public: `initRatingEngine`,
  `recordEvent`, `maybePresentRatingPrompt`, `requestRatingFromSettings`.
  `decide.ts` / `reducers.ts` / `state.ts` are internals — don't import them
  directly. Gated server-side by `configStore.reviewEnabled`. Has real unit
  coverage (`rating.test.ts`).
- **Report delivery polling** (`app/services/polling/reportPollingService.ts`)
  — adaptive, deduped, fire-and-forget: 15 s initial delay, then 10 s for
  0–5 min, 60 s to 60 min, 15 min after that. Restarted on cold start by
  `ReportPollingResumer`. The report-status polling described in "Attendance
  Reports System" ultimately lands here. CHANGED 2026-09-13: it used to
  "never stop until resolved", and one device polled six reports owned by a
  previous identity for three days (the server 404s an ownership mismatch).
  Decisions are pure and vitest-covered in `reportPollingLogic.ts`: the
  resume pass skips foreign-`uid` rows and rows older than 7 days and re-runs
  on identity change (`stopAllPolls()` first); cadence is anchored on the
  report's `generated`, not on resume time; any API problem drops to the slow
  interval; `not-found` terminates the loop. Nothing is persisted on
  termination — those rows stay "Pending" on purpose. A fresh send restarts an
  active poll; a resume does not (asymmetric dedup, see the function comment).
- **90-in-90 certificate** (`app/services/ninety/`, `useNinetyInNinety`) —
  expo-print HTML→PDF certificate for the 90-meetings-in-90-days challenge,
  written to the filesystem and shared. Errors typed via
  `NinetyCertificateError` (`"generation" | "storage"`).
- **Umami analytics** (`app/services/tracking/`) — `initializeUmami`,
  `setTrackingUserId`, `trackScreenView`, `trackEvent`. Keys come from
  ConfigStore, so tracking only works after `/config` resolves.
- **Announcements** (`app/config/announcements.ts`, `AnnouncementGate`,
  `app/utils/announcementLogic.ts`) — one-time popup registry. Append new
  entries at the END (the gate shows the first unseen one), add i18n strings,
  ship an OTA; this is JS-only, do NOT bump `runtimeVersion`. The registry
  module must stay free of runtime `@/` and native value imports because
  vitest imports it — see "Test Runner Split".
- **Crash reporting** (`app/services/crashReporting/sentry.ts`) — Sentry;
  source maps are uploaded by `bump-update.sh` during `npm run update`.
- **In-Person segment** (`useNearbySchedules` + pure `nearbyLogic.ts`, vitest
  covered; `InPersonPopup`) — the Meetings tab's third segment (see
  "Navigation" above). `useNearbySchedules` requests location with
  `expo-location`'s foreground-only permission, never at app start; raw
  coordinates live only in a ref, never in React state, MMKV, or logs (see
  the file header comment). "I'm Here" now runs a GPS presence check
  (`usePresenceCheck` → the pure `verifyPresence` in `presenceLogic.ts`) and,
  only when the user is within `configStore.presenceRadiusM` (default 150 m)
  of the venue, opens `InPersonTimerModal`. Attendance is real elapsed time
  written by `saveInPersonTimerAttendance()` at Save, followed by the shared
  topic/host panel — the same shape as the online path, sharing
  `useAttendanceTimer` and `useTopicPanel` with it. The record's `events[].json`
  carries the verified fix, distance, accuracy, and the radius in force. There
  is no override for an out-of-range user and no same-day double-log guard
  (online has never had one). The single-tap `saveInPersonAttendance` and
  `hasLoggedToday` were removed 2026-08-05. Raw coordinates are still ref-only
  for the browse path above; the attendance path persists and syncs the
  verified fix by design — see the PRIVACY header in `useNearbySchedules.ts`
  for the full accounting. Address display: `formattedAddress` is
  populated on **0 of 55,617** active in-person meetings measured live
  across every source — TSML apparently discards the composed address after
  parsing `street`/`city`/`state`/`postalCode` out of it (92–99% populated).
  `composeAddress()` in `nearbyLogic.ts` builds the display string from those
  parts and prefers `formattedAddress` verbatim only when it's non-empty.
  `MeetingRow`'s list row is deliberately different — a compact
  `venueName • city` line, not the composed address — so don't "fix" it to
  match the popup.
  The segment also has a list/map toggle — see "In-Person Map" below.
  RESOLVED 2026-08-06: the premium paywall's post-purchase `returnTo` round-trip
  used to force-route to the `live` segment and silently drop in-person
  deep-links. `returnTo` now carries the segment (see "Navigation").

- **`MeetingRow`** (`app/components/MeetingRow.tsx`, jest-covered) — the one
  meeting row, used by all three Meetings segments and the agent's results
  card. It replaced `LiveMeetingRow` and `InPersonScheduleRow` on 2026-08-04,
  when the Search segment started showing both venues in a single list and two
  shapes for one object stopped being tenable. It does NOT branch on
  `venueType`: the venue line, distance badge, hybrid glyph and external-Zoom
  glyph each render when their data is present and are absent when it isn't.
  Add new per-venue chrome the same way — a `venueType` branch here is the
  thing the consolidation was undoing.

### Permissions & the Location Gate

Settings → Permissions holds two rows: Push Notifications (premium-gated) and
Location. Spec: `docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md`.

- **`app/components/PermissionsSection.tsx`** (jest-covered) — presentational
  only: no store reads, no side effects, everything arrives as a prop. That is
  what lets its test mount it without navigation, RevenueCat, or the MST tree.
  The non-premium push row is deliberately **not** a disabled Switch — a greyed
  control reads as broken and gets ignored, a live-looking one gets tapped, and
  every tap is an entry into the subscription funnel. The Switch renders
  `pointerEvents="none"` inside a Pressable, with `accessibilityElementsHidden` /
  `importantForAccessibility` so screen-reader focus lands on the row (which
  announces the upgrade hint) rather than the inert Switch.
- **`app/utils/locationGateLogic.ts`** (pure, vitest-covered) — `decideLocationGate()`
  maps `denied → "open-settings"`, `undetermined → "prompt-os"`, and
  `granted → locationEnabled ? "proceed" : "confirm-in-app"`. Its `LocationOsStatus`
  is deliberately NOT expo-location's `PermissionStatus` enum: importing that
  would make the module unimportable by vitest.
- **`app/hooks/useLocationGate.ts`** — the I/O half. Never throws (OS rejections
  resolve `false`). Holds an `inFlightRef` single-flight guard because
  `InPersonScreen` has multiple callers on one hook instance and each
  `Alert.alert` is an independent native dialog. Both dialog branches carry a
  **web** fallback (`window.alert` / `window.confirm`): react-native-web's
  `Alert` is literally a no-op, so on web the native path renders nothing and
  the confirm branch's Promise never settles.
- **`usePresenceCheck` → `presenceLogic.ts`** — the GPS presence check behind
  "I'm Here" (see the In-Person segment note above).

**The trap, hit twice:** never make `profileStore.locationEnabled` both an
effect's dependency and that same effect's early-return guard. The Meetings tab
stays mounted behind the Settings tab, so `InPersonScreen`'s `visible` prop is
still true while the user is in Settings — and switching the Location toggle OFF
writes the one value that re-fires such an effect *and* disarms its guard in a
single step. That shipped once as a dialog begging users to re-enable the switch
they'd just turned off. The gate is keyed on the false→true edge of `visible`
(a per-visit ref), not on the store value.

### In-Person Map

The In-Person segment's list/map toggle, built on
`@maplibre/maplibre-react-native` with MapTiler tiles. Spec:
`docs/superpowers/specs/2026-08-07-in-person-map-view-design.md`.

- **`app/utils/inPersonMapLogic.ts`** (pure, vitest-covered) — feature building,
  camera fit, venue-id parsing. `InPersonMapView` is dumb by design: venues in,
  taps out. Don't re-derive any decision in the component.
  Venue feature `ids` is a **comma-joined string, not an array** — GL feature
  properties round-trip through the native bridge on tap and arrays have
  deserialized inconsistently across platforms. `parseVenueIds()` is the only
  sanctioned reader.
- **`app/components/InPersonMapView.web.tsx` is a required stub, not dead code.**
  Two of maplibre's modules call `TurboModuleRegistry.getEnforcing(...)` at
  module scope with no Platform guard, which throws when the native module is
  absent. The `.web.tsx` extension makes Metro resolve this file for the web
  bundle so the package never enters the web module graph at all.
- **Style URLs come from `/config`** (`mapStyleUrlLight` / `mapStyleUrlDark`), so
  the MapTiler API key is never baked into the binary.
- **Privacy:** the map reads `useNearbySchedules`' `coordsRef` through
  `getSearchCenter` — the one sanctioned new consumer — for the camera fit only,
  converted straight to a bounding box, never stored or logged. The puck is
  MapLibre's `NativeUserLocation` (native-side subscription, no coordinate ever
  reaches JS). **Do not swap in the sibling `UserLocation` component**: it puts
  every fix into React state and keeps its own continuous native subscription
  alive independent of our foreground-only `expo-location` lifecycle.
- Tile egress means MapTiler necessarily sees the viewport; that's accepted and
  documented in the spec.

### Theming
Design token system in `app/theme/`:
- Use `themed()` function for responsive styling
- Access via `useAppTheme()` hook
- Colors include `card` for elevated surfaces (distinct from `background`)
- Professional dark mode with iOS-style greys

### Internationalization
i18next in `app/i18n/`, nine locales: `en`, `es`, `ar`, `de`, `fr`, `pt`,
`ru`, `th`, `uk`.
- Use `tx` prop on Text components, never hardcode strings
- Use `useTranslation()` hook for reactive translations in navigators
- Language switching via `changeLanguage()` from i18n exports
- `en.ts` declares `export type Translations = typeof en`, and every other
  locale file is typed `const xx: Translations`. That means **any new
  translation key is a nine-file change** — add it to `en.ts` and the other
  eight will not compile until they have it too. A missing key is a hard
  `tsc` error, not a silent runtime fallback, so `npm run compile` catches it
  immediately. New keys can ship English-only text in the other eight
  locales as a placeholder (better a native-speaker review queue item than a
  broken build) but the key must exist in all nine files.

## Test Runner Split (Vitest + Jest, by file extension)

`npm test` runs **both** runners: `vitest run && jest --forceExit`. The split is
enforced by config, not convention, and it is load-bearing:

- **`*.test.ts` → Vitest** (`vitest.config.ts`). Pure TypeScript only. Vitest
  has no React Native / Babel transform, so a `.tsx` file pulled into its graph
  dies on RN's Flow-typed source (`Unexpected token 'typeof'`).
- **`*.test.tsx` → jest-expo** (`jest.config.js`, `testMatch: **/*.test.tsx`).
  Component tests; setup in `test/setup.ts`.
- **`*.e2e.test.ts` → excluded from both**, run only via `npm run test:e2e`
  (`vitest.e2e.config.ts`). These hit live infra (e.g. `logger.e2e.test.ts`
  needs a reachable Loki) and fail on any machine without it.
- **Vitest cannot resolve the `@/` alias.** A module you want unit-tested must
  keep its pure logic free of runtime `@/` imports (type-only imports are fine,
  they're erased). The established pattern is logic in a pure module + I/O in a
  separate orchestrator the tests don't import — see `syncLogic.ts` vs
  `services/sync/index.ts`, and `announcementLogic.ts` vs `announcements.ts`.
- **Both configs ignore `.claude/worktrees/`** — it holds full nested checkouts
  of this repo, and without the exclusion every test is discovered twice, making
  one real failure look like two. Don't remove those ignore patterns.

Coverage is deliberately concentrated on pure logic — roughly five vitest `.test.ts`
files for every jest `.test.tsx` — covering sync/rating/announcement decisions,
location gate, presence, nearby, map features, deep links, `returnTo` parsing,
filters, sliders, logger, storage, api problems, local dates, i18n. Almost every
`*Logic.ts` module exists because its sibling hook or component couldn't be
tested; when you add logic worth asserting on, extract it the same way rather
than reaching for a jest mock. `app/services/sync/index.ts` has **zero**
automated coverage by design — verify it by hand against the checklist in
`docs/BACKUP.md`.

**Nothing runs these for you.** `.forgejo/workflows/make.yml` builds Docker
images to ECR and carries `branches-ignore: [root]` — there is no CI that runs
`compile` / `lint` / `test` on this app's code, on any branch. Local verification
before committing is the only gate that exists.

## Repo Docs Map

Longer-form docs live outside this file; read the relevant one before touching
its subsystem:

- `docs/BACKUP.md` — attendance cloud backup/sync design + manual test checklist
  (**required reading** before editing `app/services/sync/`)
- `docs/MEETING_ATTENDANCE_FLOW.md` — end-to-end attendance capture flow
- `docs/DIAGNOSTICS.md` — logging/telemetry troubleshooting (`docs/grafana/`
  holds the dashboard JSON)
- `docs/PRODUCTION_CHECKLIST.md` — pre-release verification
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — design specs and
  implementation plans for in-flight work. Most subsystem sections above cite
  the spec that produced them; read it before reopening a settled decision.
- `docs/2026-08-07-reminder-inperson-deep-link.md` — reminder → in-person deep
  link routing
- `docs/translation-review-2026-08-03.md` — native-speaker review queue for the
  eight non-English locales
- `docs/STORE_LISTING.*.txt` — App Store / Play listing copy drafts
- `EVENTS.md` — the app's event/pub-sub catalog
- `auth0/` — source for the tenants' Auth0 Actions, one folder per tenant:
  `actions/meetingmaker/` (prod, `auth.recoverysky.app`) and
  `actions/bad-bitch-tenant/` (dev). A file in a tenant's folder = deployed and
  bound there; absent = doesn't exist there. The `identities` ID-token claim
  behind Settings → Account's linked-method rows lives here. Prod shares one
  client with every build, so deploy to dev first and promote by copying the file.
  Deploy with `auth0/scripts/deploy-actions.sh <tenant> [--apply]` (idempotent, dry run by default).
- `CONTRIBUTING.md`, `CHANGELOG.md`, `TODO.md`, `JOURNAL.md` — process, release
  history, backlog, running work log

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
- **Name the tracker issue the release will need to update.** If the change
  fixes (or partially addresses) an issue in the `issues` MCP tracker, end
  the entry with its id, e.g. `(RS-049)`. That tag is the only record of
  which issues need `fix-deployed` + `fix_release` once the change ships —
  the tracker's version-scoped fingerprint keeps counting the old build
  until the release is recorded, so an untagged fix can never auto-resolve.

**When cutting a release (OTA or native), the `[Unreleased]` block is the
worklist for the tracker.** Before moving it under the new heading, collect
every `(RS-NNN)` tag in it. After the release is actually live, for each
one: confirm the fix commit is in the tag range
(`git log <prev-tag>..<new-tag>`), then `issue_update` with
`status: fix-deployed` and `fix_release: "app <version>"`. Never set
`resolved` — the fingerprint earns that. If a tagged fix did NOT make the
cut, leave the entry in `[Unreleased]` rather than shipping the heading
without it; the tag is a promise about what the release carries. This is
the step `bump-update.sh` / `bump-version.sh` cannot do for you (see
`recoverysky-tracker` skill, "Record").

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
`@recoverysky-org/common`'s `/browser` subpath exports browser-safe data
models and helpers (no aliasing — see "Path Aliases" above):
```typescript
import {
  meeting, schedule, trex,           // Data models (plain interfaces)
  Fellowship, MeetingStatus,         // Enums
  validateMeeting, validateSchedule, // Zod validation
  hydrateNext, FELLOWSHIP_COLORS,    // Display helpers
  DateTime,                          // Luxon DateTime
} from "@recoverysky-org/common/browser"
```

The `/sqlite` subpath exports SQLite/Drizzle exports:
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

Every record carries `sessionId` / `appVersion` / `deviceId` and, when signed
in, `userId` — which is **always the `hashUserId()` form, never the raw Auth0
`sub`** (it embeds the identity provider's account id). Never log `user.sub`,
`authEmail`, `shortName`, or coordinates directly; see `docs/DIAGNOSTICS.md`
"Identifiers in logs" for the table and the support lookup recipe.

**Tracing (ADDED 2026-09-21): the app starts traces but records no spans.**
There is no OTel tracing SDK in the app and it should stay that way — a
tracer in Hermes costs polyfills, battery and network on a recovery app, and
client-side timings are already in Loki keyed by `sessionId`. Instead the
auth gate in `app/services/api/index.ts` stamps a random W3C `traceparent` on
every request (pure helpers in `traceparentLogic.ts`, vitest-covered) and
`installRequestTraceMonitor` logs one `"API request"` debug line per response
with the same `traceId`. The API's wonder-logger/OTel instrumentation
continues that id into Tempo. The id goes on the line as an attribute, never
via `logger.setTraceContext()` — that setter is instance-wide and requests
overlap. Recipe in `docs/DIAGNOSTICS.md` "Tracing". Sentry's
`tracesSampleRate` is 0 on purpose; don't turn it on as a shortcut to
"tracing" — it goes to Sentry, not Tempo.

## Environment Variables

`EXPO_PUBLIC_*` variables are baked in at build time. For local development:

- **Simulator**: Can use `localhost` URLs in `.env`
- **Physical device**: Must use your Mac's IP address (e.g., `http://192.168.x.x:4000`)
- After changing `.env`, restart Metro with `npm start -- --clear`

Key variables in `.env`, grouped by what they feed:
```bash
# Endpoints — the three URLs ConfigStore seeds from before /config answers
EXPO_PUBLIC_API_URL=http://192.168.x.x:4000     # RecoverySky API
EXPO_PUBLIC_AGENT_URL=http://192.168.x.x:3333   # AI Agent API
EXPO_PUBLIC_SOCIAL_URL=...                      # Agora-hosted community site
EXPO_PUBLIC_AUTH_KEY=...                        # X-API-Key device-auth fallback

# Auth0 (see "Auth, Attestation & Encryption Keys")
EXPO_PUBLIC_AUTH0_DOMAIN / _CLIENT_ID / _AUDIENCE

# Attestation
EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER         # Play Integrity

# Telemetry
EXPO_PUBLIC_OTLP_ENDPOINT / _API_KEY            # logger → Loki
EXPO_PUBLIC_SENTRY_DSN                          # public identifier, safe to embed
EXPO_PUBLIC_UMAMI_URL / _WEBSITE_ID / _X_API_KEY

# Behavior knobs
EXPO_PUBLIC_LOG_LEVEL
EXPO_PUBLIC_FELLOWSHIPS                         # which fellowships the build offers
EXPO_PUBLIC_CONFIG_POLL_SECONDS / _MAINTENANCE_SECONDS
EXPO_PUBLIC_MIN_CREDIT_MINUTES                  # attendance credit floor
EXPO_PUBLIC_RATING_MIN_DAYS / _MIN_EVENTS       # rating engine soft-ask gates
EXPO_PUBLIC_JOIN_MEETING_ZID / _PW              # dev-only test meeting

# NOT EXPO_PUBLIC_ — deliberately. Build-time only, never bundled.
SENTRY_AUTH_TOKEN=...                           # source map upload; real secret
```

**There are no Zoom variables.** `EXPO_PUBLIC_ZOOM_SDK_KEY` / `_SECRET` were
removed with the bundled SDK in 4.5.0 (see "Zoom Integration") — if you find
them referenced anywhere, that reference is stale.

Production values are set in `eas.json` under `build.base.env`; `npm run check:env`
verifies `.env` and `eas.json` haven't drifted apart.

## AI Agent Integration

The Sky Agent (`AgentScreen.tsx`) uses Vercel AI SDK with streaming:
- Connects to `configStore.agentUrl` (from env var or server config)
- Uses `@ai-sdk/react` `useChat()` hook for streaming responses
- Supports tool calls (meeting search, recovery resources)
- Conversation persisted to ConversationStore
- Agent tab gated behind `isPremium` entitlement

## Attendance Cloud Backup & Sync

Opt-in (Settings → Cloud Backup, default OFF, gated on the
`recoverysky-attendance` entitlement) backup of attendance records with
multi-device sync. Lives in `app/services/sync/`.

**Read `docs/BACKUP.md` before changing anything under `app/services/sync/`.**

The load-bearing facts:
- **The server stamps every pushed attendance record with the authenticated
  uid.** Pushing user A's queued rows while B is signed in silently moves A's
  attendance into B's account. The MMKV `sync.queueOwnerUid` ownership check
  exists solely to prevent this, and it is deliberately **fail-closed** — if
  the account-switch queue clear fails, sync stays dead until the next launch
  rather than risking a leak.
- ADDED 2026-09-17: the ownership gate in `useAuth0Wrapper` (see "Auth,
  Attestation & Encryption Keys" §1) is what keeps a foreign session from
  ever reaching `takeQueueOwnership` in the first place — a refused session
  never sets `userId`, so the account-switch clear above cannot fire for an
  accidental wrong-account login. The MMKV check stays as belt-and-braces.
- Local mutations enqueue to a durable `sync_queue` outbox via the single
  choke point in `app/db/repositories.ts`. Inbound pulls write through
  `attendanceSyncWriter`, which **never** fires the mutation hook — otherwise a
  pull would enqueue a push would pull, forever.
- `mergePullDecision()` checks "has a pending local push" **before** it checks
  tombstones. Reordering that clobbers unpushed user edits.
- Reports are pull-only and `/sync/reports` is metadata-only;
  `backfillReportBodies()` fetches each body via `GET /reports/:id` so a synced
  device holds a complete offline copy. A 404 there is a true answer (the body
  does not exist — Firebase imports never had one) and is **persisted per uid**
  in MMKV (`sync.bodyNotFound.<uid>`), with a budget of 5 not-founds per pass
  and a 60 s hold (CHANGED 2026-09-14: the in-memory-only version re-asked 25
  ids on every cold start and tripped CrowdSec's http-probing ban four times in
  a day). Only a pull `update` for that report re-arms the fetch. Don't
  "simplify" this back to a session-scoped set.
- `app/services/sync/index.ts` has **zero automated coverage** (it imports
  `@/`, which vitest can't resolve). The account-switch path must be verified
  by hand — checklist in `docs/BACKUP.md`.

Anything worth testing gets extracted into `syncLogic.ts`, which keeps zero
`@/` runtime imports for exactly that reason.

## Zoom Integration (external-only)

The bundled Zoom Meeting SDK was removed in 4.5.0 after a fatal Android
startup crash (`UnsatisfiedLinkError: libzReflection.so`) caused by
autolinking the SDK's native module. The app now joins exclusively
through the installed Zoom app via `Linking.openURL`.

What's left in `app/services/zoom/`:
- **`useZoomMeeting`** — hook returning `{ joinMeeting, openInZoomApp,
  isJoining, state, error, reset }`. `joinMeeting()` opens
  `https://zoom.us/j/<zid>?pwd=<encrypted|plaintext>&un=<base64name>` via
  `Linking.openURL`. The pure `buildExternalZoomUrl()` helper prefers
  `passwordEnc` (encrypted share-link pwd) over plaintext `password`, and
  best-effort prefills the display name as `?un=<base64>`.
- **`externalAttendance.saveTimerAttendance()`** — writes an attendance
  record from a user-confirmed timer modal. Events are JSON-tagged
  `source: "external-zoom-timer"` so timer-sourced records are
  filterable. When a valid record is written (credit ≥
  `EXTERNAL_MIN_CREDIT_MS`) it also fires
  `meetingEvents.completed("external-zoom-timer")` so the review-prompt
  tally still increments outside the SDK path.
- **`SchedulePopup.handleJoin`** — when `attendanceEnabled` is on, shows
  `ExternalZoomTimerModal`; otherwise calls `Linking.openURL` directly.
- The Listings API (`getLiveSchedules` / `getDailySchedules`) no longer sends
  an `includeExternal` param — external is the only mode, so the server returns
  it by default and the client-side flag was removed.

What was removed (do not restore without strong reason): the
`ZoomMeetingProvider` SDK context, `ZoomLoginScreen` / `ZoomSetupScreen`,
the `useZoomAuth` OAuth/ZAK flow, the encrypted-SQLite `zoomAuthRepo`,
the `mobilertc.aar` patch pipeline, all ZoomMeetingSDK Pod/Gradle pins,
and the ConfigStore `zoomSdkKey` / `zoomSdkSecret` / `zakApiKey` fields.
The `zoom_auth` SQLite table is intentionally orphaned (still created
by common-lib's Drizzle migrations; trivial to leave empty).

## Development Tools

- **Reactotron**: Dev-only debugging (auto-configured). Lives in `app/devtools/`,
  with a `.web.ts` variant so the native client never enters the web bundle.
- **Dependency Cruiser**: Validates imports, prevents circular dependencies
  (`npm run lint:deps`; `lint:deps:graph` renders an SVG/PNG import graph and
  needs graphviz `dot` on PATH)
- **`app/types/`**: ambient declarations only (`polyfills.d.ts`) — not a shared
  types barrel. App types live beside the code that owns them.
- **`.superpowers/sdd/`**: git-ignored per-plan workspaces (ledgers, task briefs,
  review packages) written by subagent-driven development runs. Scratch, not
  source — safe to delete, and `git clean -fdx` will.
- **Ionicons**: Vector icons via `@expo/vector-icons` for icons not in asset registry
- **`app/screens/DevScreen.tsx`**: currently unreferenced — nothing navigates to
  it and it's absent from `navigationTypes.ts`. It's a parking spot for dev
  tooling, not a live screen; wire up a route before assuming it renders.

