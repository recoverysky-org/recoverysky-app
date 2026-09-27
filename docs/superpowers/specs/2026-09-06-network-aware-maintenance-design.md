# Network-Aware Maintenance & Offline States — Design

**Date:** 2026-09-06
**Status:** Approved design, pending implementation plan
**Release train:** NATIVE — adds `@react-native-community/netinfo` (new native
module → `runtimeVersion` bump). Ships with the next store release, not an OTA.

## Problem

The app cannot tell "the user's device is offline" from "our API is down."
Both cold-start outage detection and the runtime maintenance banner treat
every request failure as a service problem:

1. **Runtime banner false positives (the driving complaint).** The 60s
   `/config` poll flips `configStore.maintenanceMode = true` after one failed
   cycle (3 retries, ~14s). A user in a subway, dead zone, or airplane mode
   sees the amber "Maintenance in progress" banner implying *RecoverySky* is
   down. Many users see this banner for what is actually their own
   connectivity.
2. **Cold-start outage screen lies to offline users.** When the `/status`
   precheck exhausts retries, `MaintenanceScreen` says "The system is
   offline / We'll be back shortly" — wrong and alarming for a user who is
   simply offline.
3. **`NetworkStore` is dead.** `app/models/NetworkStore.ts` has the right
   shape (`isOffline`, `hasInternet`, `setNetworkStatus()` documented as
   "called from NetInfo listener") but **no NetInfo listener exists and no
   network package is installed**. `isConnected` stays at its default `true`
   forever. Its three existing consumers (In-Person map toggle disable,
   Settings offline row, sync gate in `app/services/sync/index.ts`) read a
   value that never changes.

## Decisions already settled (with Jenova, 2026-09-06)

- Keep the cold-start `/status` → `setOutageMode()` full-screen gate exactly
  as it works today; only the *messaging* becomes network-aware.
- Use `@react-native-community/netinfo` (not `expo-network`): its active
  reachability probing gives a real "device genuinely has internet" signal.
- No `AUTO_MAINT` env flag (an earlier idea, dropped): behavior is driven by
  live device network state, not a build-time switch.
- No consecutive-failure hysteresis in this pass (YAGNI): offline gating is
  expected to remove the bulk of false banners. Revisit only if
  online-but-flaky users still report noise.
- Single-phase delivery: everything ships together in the native release
  (no OTA pre-ship of the poll fix).

## Design

### 1. NetInfo wiring

- `npm i @react-native-community/netinfo`. Native module → **bump
  `runtimeVersion`** together with the next native `version`.
- New module `app/services/network/` (orchestrator, no tests needed —
  it is a thin subscription):
  - `initNetworkMonitoring(rootStore)` called from `app.tsx` init, after
    `setupRootStore()` and **before** the `/status` precheck so the cold-start
    screen variant has a live value as early as possible. NetInfo's listener
    fires immediately with the current state on subscribe.
  - Maps `NetInfoState` → `networkStore.setNetworkStatus(isConnected,
    connectionType, isInternetReachable)`. Mapping rule: `isConnected =
    state.isConnected === true`; connection types outside the store's enum
    (`bluetooth`, `wimax`, `vpn`, `other`) map to `"unknown"`.
  - Never disposed — network state matters for the app's whole lifetime
    (same rationale as the config-cache persistence reaction).
- Reachability uses NetInfo's default probe URL, **deliberately independent
  of our API** so "internet reachable" and "RecoverySky reachable" stay two
  distinct signals. Known caveat: the default probe host can be blocked on
  some national networks; `isOffline` keys off `isConnected` (interface
  state), not the probe, so those users are not misclassified as offline.
- Web: NetInfo supports web via `navigator.onLine` / connection API; no
  `.web.ts` stub needed.

### 2. Offline semantics (one rule, used everywhere)

`networkStore.isOffline` (`!isConnected`) is the single predicate for "it's
the device, not us." When it is true, no API failure may be presented as
maintenance. When it is false, an exhausted API retry budget means the
problem is plausibly ours and the existing maintenance UX applies.

New pure module **`app/utils/connectivityLogic.ts`** (vitest-covered, zero
runtime `@/` imports per the test-runner split) owns the decisions:

```ts
type BannerState = "none" | "offline" | "maintenance"
decideBanner({ isOffline, maintenanceMode }): BannerState
  // offline wins over maintenance — it's the more accurate diagnosis

decideOutageVariant({ isOffline }): "offline" | "maintenance"

shouldFlipMaintenanceOnPollFailure({ isOffline, isLoaded }): boolean
  // false when offline (failure is the device's), false when !isLoaded
  // (cold-start path is app.tsx's job), true otherwise

shouldSkipConfigPoll({ isOffline }): boolean
```

### 3. Cold start — full-screen gate unchanged, message honest

- `app.tsx` `/status` precheck, retry ladder, `setOutageMode()`, and the
  AppNavigator routing (`showOutage = configStore.outageMode`) are all
  untouched.
- `MaintenanceScreen` gains two variants, chosen live by
  `decideOutageVariant(networkStore.isOffline)` (it is already an
  `observer`):
  - **offline**: cloud-offline icon, "You're offline" title, "check your
    connection" subtitle. Support link hidden (a web link is useless
    offline); the "checking" spinner row remains.
  - **maintenance**: today's construct icon + existing `maintenance:*` copy.
  - Wifi returning mid-outage flips the copy to the maintenance variant
    automatically until recovery fires — correct, since at that point the
    API genuinely still hasn't answered.
- Recovery loop: the existing 15s `/status` poll stays. Addition: a reaction
  on the `isOffline` true→false edge triggers one immediate recovery poll so
  a reconnecting user doesn't wait out the interval. While offline, interval
  ticks early-return without calling `/status` (they cannot succeed and just
  burn radio).

### 4. Runtime banner — two variants, offline wins

`MaintenanceBanner` renders per `decideBanner()`:

- **offline**: muted style (blue/grey — calm, informational; exact tokens at
  implementation, must meet AA contrast like the amber pair), cloud-offline
  icon, new `common:offlineBanner` text ("You're offline. Showing saved
  data."). Shown whenever the device is offline — honest, and it explains
  empty refreshes without any API call having to fail first.
- **maintenance**: existing amber banner, unchanged.
- Precedence: offline > maintenance > none. Same absolute-position overlay,
  same zIndex, still non-blocking — **the navigator is never gated**, so the
  mid-meeting external-Zoom timer invariant from CLAUDE.md "Maintenance
  Mode" holds for both variants.
- No mount/unmount debounce in this pass: NetInfo already coalesces
  transitions, and a brief banner during a real handoff is honest. Revisit
  with the hysteresis question if it flickers in practice.

### 5. Poll algorithm fix (kills the false banners)

- **`app.tsx` config poll loop:** each tick consults
  `shouldSkipConfigPoll` — while offline, `fetchConfig()` is not called and
  no failure is counted. A reaction on the offline→online edge fires an
  immediate `fetchConfig()` to resync (and, if server maintenance ended
  while we were offline, clears the banner promptly).
- **`ConfigStore.fetchConfig` exhausted-retries branch:** the
  `store.isLoaded` case flips `maintenanceMode` only per
  `shouldFlipMaintenanceOnPollFailure`. ConfigStore cannot import
  NetworkStore's instance directly without coupling; it reaches the sibling
  store via `getRoot()` (standard MST pattern) — the pure predicate keeps
  the decision testable regardless.
- The maintenance-exit reaction in `MeetingContext`, the self-disabling
  features list, and the maintenance-interval poll speedup all behave as
  today — they key off `maintenanceMode`, which now simply stops lying.

### 6. Side effects that come free (and are intended)

Wiring `NetworkStore` activates its existing consumers:

- Sync (`app/services/sync/index.ts`) genuinely pauses while offline.
- In-Person map toggle disables while offline in list mode.
- Settings shows its offline row when actually offline.

These are behavior changes to note in the changelog, not bugs.

## i18n

New keys (nine-locale change; English placeholder text in the other eight,
queued for native-speaker review per `docs/translation-review-2026-08-03.md`):

- `maintenance:offlineTitle`, `maintenance:offlineSubtitle`
- `common:offlineBanner`

## Error handling

- NetInfo listener errors: none expected (event API), but the initial
  `NetInfo.fetch()` state, if it ever rejects, leaves the store at its
  optimistic defaults — identical to today's behavior, fail-open.
- `isInternetReachable: null` (probe undecided) is treated as online for all
  decisions (`isOffline` ignores it) — fail toward the maintenance path
  rather than falsely blaming the user's device.

## Testing

- **Vitest:** `connectivityLogic.test.ts` — full truth table for all four
  functions.
- **Jest:** extend/keep component coverage light; the banner and screen are
  thin views over the pure module.
- **Manual checklist** (add to the spec's implementation plan &
  `docs/PRODUCTION_CHECKLIST.md`):
  1. Airplane mode → cold start: "Device Offline" full screen; disable
     airplane mode: copy flips to maintenance variant briefly (if API up,
     recovery reloads within ~15s into a normal session).
  2. Airplane mode mid-session: offline banner appears; config poll silent
     (no maintenance flip in logs); disable airplane mode: banner clears,
     immediate `fetchConfig` in logs.
  3. Real API-down while online (block api.recoverysky.app in hosts / kill
     local API): maintenance banner after one failed poll cycle; cold start
     in same state: maintenance variant of the full screen.
  4. Server `MAINTENANCE_MODE: true`: banner (warm start) / full screen
     (cold start) exactly as before.
  5. External-Zoom timer running while toggling airplane mode: timer modal
     survives both banner variants.

## Housekeeping

- `runtimeVersion` bump alongside the next native `version` bump.
- CHANGELOG: Added (offline detection, offline screen/banner variants),
  Fixed (false maintenance banner for offline users), Build (netinfo dep).
- Update CLAUDE.md "Maintenance Mode" section and the smaller-subsystems
  list (NetworkStore is no longer dead; note the offline-wins banner rule).

## Out of scope

- Failure-kind classification (apisauce `timeout`/`cannot-connect` vs
  `server`) as an additional maintenance signal — offline gating first.
- Consecutive-failure hysteresis and banner debounce (see settled
  decisions).
- Any change to attestation flow, `/status` retry ladder, warm/cold config
  cache behavior, or the `MAINTENANCE_UPDATE` removal.

## Appendix: CLAUDE.md history (moved 2026-09-27)

This is the "Maintenance Mode" text from `CLAUDE.md` exactly as it read before it was cut down to current-state rules. It is kept here so the reasoning and change log are not lost.

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

  CHANGED 2026-09-06: the polling-failure trigger fires ONLY while the
  device is online (`networkStore.isOffline` false). Offline poll failures
  never flip this flag — the banner shows its "Device Offline" variant
  instead, and polling pauses until reconnect. Decision logic in
  `app/utils/connectivityLogic.ts` (vitest-covered); spec:
  docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
- **`configStore.outageMode`** (cold-start gate): the app launched into
  an unusable state. Three triggers, all set by `setOutageMode()` in
  `app.tsx`'s init path:
  1. `/status/ready` precheck failed (API unreachable). This runs BEFORE
     attestation specifically so an outage doesn't get misreported as
     "Device Verification Failed" (`/attest` would fail too). Calls
     `api.getPublicStatus()` which bypasses the token freshness gate via
     `X-Skip-Auth-Gate` since no JWT exists yet. CHANGED 2026-09-14: was
     `GET /status`; the readiness route is the same DB + TREX gate (503 when
     either is down) with a tiny body, and the probe now requires
     `{ "status": "ready" }` rather than any 2xx (pure `isReadyBody()` in
     `apiProblem.ts`, vitest-covered).
  2. `/config` fetch failed after the `/status/ready` precheck passed
     (transient half-up state). EXCEPTION (2026-09-09): not when the device
     lane came back `degraded` — a degraded device gets 401s from `/config`
     while the public `/status/ready` stays healthy, so outage mode's recovery
     poll would reload instantly and loop the cold start forever (burning
     an Apple key generation per cycle). That start renders on env-var
     defaults with the "Connecting…" banner and arms a one-shot reload for
     when `/config` finally loads.
  3. `/config` fetch succeeded but reported `MAINTENANCE_MODE=true`
     at startup.

  CHANGED 2026-08-14: triggers 2 and 3 now fire only when the config cache
  is cold (first launch / unreadable cache). Warm-cache starts seed
  ConfigStore from SQLite, fetch in the background, and surface maintenance
  as the banner instead — see the config-cache spec.

  AppNavigator routes to `MaintenanceScreen` only when this is true. A
  recovery `useEffect` polls `/status/ready` every 15 s while we're in outage
  and calls `Updates.reloadAsync()` once the API responds — the reload
  is the safe path because the bootstrap registers MobX reactions that
  would duplicate on in-place re-init. Cleared automatically on the
  next `/config` fetch that returns with maintenance off — runtime
  maintenance does NOT clear it, so a user who launched into
  maintenance stays on the full screen until the service is healthy
  again.

**The banner** (`app/components/MaintenanceBanner.tsx`) is mounted as a
sibling to `<AppNavigator />` in `app.tsx`'s provider tree, with absolute
positioning + high `zIndex`, so it draws above every screen and modal.
It observes `maintenanceMode` only — outage doesn't double-render
because the full-screen takes over.

  The banner is three-variant, in priority order: a muted blue-grey
  "You're offline" strip (which WINS over the other two — offline is the
  more accurate diagnosis), a calm "Connecting to RecoverySky…" strip
  driven by `configStore.deviceAuthDegraded` (ADDED 2026-09-09 with the
  attestation degrade path — see "Auth, Attestation & Encryption Keys"),
  and the amber maintenance strip. `MaintenanceScreen` mirrors the
  offline/maintenance split for cold-start outage ("Device Offline" vs
  "System Maintenance", live-switching since it observes NetworkStore).

**API-dependent features that self-disable when `maintenanceMode` is
true:**
- `MeetingProvider.refreshLiveMeetings()` (`app/context/MeetingContext.tsx`)
  — early-returns; the existing maintenance-exit reaction fires a
  refresh automatically when the flag clears. CHANGED 2026-09-14: the
  guard and the reaction both use `isLiveRefreshBlocked()` (maintenance
  OR `outageMode`) — the outage path never sets `maintenanceMode`, so
  watching it alone left Live empty after an outage cleared whenever the
  recovery reload didn't run (`Updates.reloadAsync` throws in `__DEV__`).
  A failed refresh also keeps the last successful list rather than
  clearing it; don't reintroduce `setLiveMeetings([])` on the error path.
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
