# Network-Aware Maintenance & Offline States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire real device-network detection into the app so the maintenance UX (full-screen outage + runtime banner) distinguishes "your device is offline" from "our API is down," and offline devices can no longer trigger false maintenance banners.

**Architecture:** `@react-native-community/netinfo` feeds the existing (currently dead) `NetworkStore` via a one-time listener registered in `app.tsx`. A new pure module `app/utils/connectivityLogic.ts` owns every decision (banner state, outage-screen variant, poll gating). `MaintenanceBanner` and `MaintenanceScreen` become two-variant views over that module; the config poll and outage-recovery loops skip ticks while offline and refetch immediately on reconnect.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree, `@react-native-community/netinfo` (install via `npx expo install` for the SDK-pinned version), Vitest for pure logic.

**Spec:** `docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md`

## Global Constraints

- **NATIVE release feature.** Adds a native module → `runtimeVersion` bump required. Do NOT run `npm run update` (OTA) with this on `root` unpublished-native; the `runtimeVersion` bump itself happens at release time via the native release procedure (`npm run minor` + manual `app.json` edit), NOT in this plan.
- Work in `/Users/jenova/projects/recoverysky-org/app` on branch `root`. This checkout is shared by concurrent sessions: stage ONLY the paths each task names (`git add <path> <path>`), never `git add -A`, never `git stash`.
- Never run repo-wide lint. Lint only touched files: `npx eslint <files> --fix`.
- Vitest cannot resolve `@/` — `connectivityLogic.ts` must keep zero runtime `@/` imports (type-only is fine).
- `*.test.ts` runs under Vitest only: `npm run test:unit -- <file>`. Never name a pure-logic test `.tsx`.
- i18n: every new key is a nine-file change (`en`, `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`); `npm run compile` fails until all nine have it.
- Comments follow the repo's liberal-comment policy: preserve existing functional comments and append dated `CHANGED 2026-09-06:` notes when altering commented behavior.
- After the native dep lands, dev clients must be rebuilt (`npm run build:ios:sim` / `npm run build:android:sim:debug`) before manual on-device testing — `expo run` against a stale build will crash on the missing native module.

---

### Task 1: `connectivityLogic` pure module (TDD)

**Files:**
- Create: `app/utils/connectivityLogic.ts`
- Test: `app/utils/connectivityLogic.test.ts`

**Interfaces:**
- Consumes: nothing (pure, zero imports).
- Produces (later tasks import these from `@/utils/connectivityLogic`):
  - `type BannerState = "none" | "offline" | "maintenance"`
  - `type OutageVariant = "offline" | "maintenance"`
  - `decideBanner(i: { isOffline: boolean; maintenanceMode: boolean }): BannerState`
  - `decideOutageVariant(i: { isOffline: boolean }): OutageVariant`
  - `shouldFlipMaintenanceOnPollFailure(i: { isOffline: boolean; isLoaded: boolean }): boolean`
  - `shouldSkipConfigPoll(i: { isOffline: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/utils/connectivityLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  decideBanner,
  decideOutageVariant,
  shouldFlipMaintenanceOnPollFailure,
  shouldSkipConfigPoll,
} from "./connectivityLogic"

describe("decideBanner", () => {
  it("shows nothing when online and healthy", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: false })).toBe("none")
  })

  it("shows maintenance when online and maintenance is flagged", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: true })).toBe("maintenance")
  })

  it("shows offline when the device is offline", () => {
    expect(decideBanner({ isOffline: true, maintenanceMode: false })).toBe("offline")
  })

  it("offline wins over maintenance — it is the more accurate diagnosis", () => {
    // Load-bearing precedence: an offline device cannot verify a maintenance
    // claim, and "you're offline" is true regardless of our service state.
    expect(decideBanner({ isOffline: true, maintenanceMode: true })).toBe("offline")
  })
})

describe("decideOutageVariant", () => {
  it("blames the device when it is offline", () => {
    expect(decideOutageVariant({ isOffline: true })).toBe("offline")
  })

  it("blames the service when the device is online", () => {
    expect(decideOutageVariant({ isOffline: false })).toBe("maintenance")
  })
})

describe("shouldFlipMaintenanceOnPollFailure", () => {
  it("flips maintenance for an online device whose poll exhausted retries", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: true })).toBe(true)
  })

  it("never flips maintenance while the device is offline", () => {
    // THE fix for the false-banner complaint: a subway rider's failed polls
    // are the device's problem, not evidence of maintenance.
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: true })).toBe(false)
  })

  it("never flips on the cold-start path (isLoaded false) — that is app.tsx's outage gate", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: false })).toBe(false)
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: false })).toBe(false)
  })
})

describe("shouldSkipConfigPoll", () => {
  it("skips polling while offline — a poll that cannot succeed must not count as a failure", () => {
    expect(shouldSkipConfigPoll({ isOffline: true })).toBe(true)
  })

  it("polls normally while online", () => {
    expect(shouldSkipConfigPoll({ isOffline: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- app/utils/connectivityLogic.test.ts`
Expected: FAIL — cannot resolve `./connectivityLogic`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/connectivityLogic.ts`:

```ts
/**
 * connectivityLogic — pure decisions for network-aware maintenance UX.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — the NetInfo subscription feeding NetworkStore —
 * lives in `@/services/network`.
 *
 * The single rule, applied everywhere: `isOffline` (device interface down)
 * means "it's the device, not us" — no API failure may be presented as
 * maintenance while it is true. Only an online device's exhausted retries
 * count as evidence of a service problem.
 *
 * See docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
 */

/** What the sticky top banner should show. */
export type BannerState = "none" | "offline" | "maintenance"

/** Which copy the full-screen cold-start outage screen shows. */
export type OutageVariant = "offline" | "maintenance"

/**
 * Pick the runtime banner. Offline wins over maintenance: an offline device
 * cannot verify a maintenance claim, and "you're offline" is true and
 * actionable regardless of our service state.
 */
export function decideBanner(i: { isOffline: boolean; maintenanceMode: boolean }): BannerState {
  if (i.isOffline) return "offline"
  if (i.maintenanceMode) return "maintenance"
  return "none"
}

/**
 * Pick the cold-start outage screen's copy. The screen is an observer, so a
 * device that regains wifi mid-outage flips to the maintenance variant live
 * (correct — at that point the API genuinely still hasn't answered).
 */
export function decideOutageVariant(i: { isOffline: boolean }): OutageVariant {
  return i.isOffline ? "offline" : "maintenance"
}

/**
 * Should an exhausted /config retry budget flip `maintenanceMode`?
 *
 * - Offline → never. The failure is the device's; the offline banner is
 *   already telling the truth. This is the fix for offline users seeing
 *   "Maintenance in progress".
 * - `isLoaded` false → never. The cold-start failure path is owned by
 *   app.tsx's outage gate (`setOutageMode`), not the banner.
 */
export function shouldFlipMaintenanceOnPollFailure(i: {
  isOffline: boolean
  isLoaded: boolean
}): boolean {
  return !i.isOffline && i.isLoaded
}

/**
 * Should a config poll tick be skipped entirely? While offline, a poll
 * cannot succeed and must not run at all — otherwise its failure gets
 * counted somewhere. Resync on reconnect is the reaction in app.tsx's poll
 * effect, not this predicate's job.
 */
export function shouldSkipConfigPoll(i: { isOffline: boolean }): boolean {
  return i.isOffline
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- app/utils/connectivityLogic.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Type-check and lint the new files**

Run: `npm run compile && npx eslint app/utils/connectivityLogic.ts app/utils/connectivityLogic.test.ts --fix`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/utils/connectivityLogic.ts app/utils/connectivityLogic.test.ts
git commit -m "✨ feat(connectivity): pure decisions for network-aware maintenance UX"
```

---

### Task 2: Install NetInfo and wire NetworkStore

**Files:**
- Modify: `package.json` / `package-lock.json` (via `npx expo install`)
- Create: `app/services/network/index.ts`
- Modify: `app/app.tsx` (import + one call after `logger.setContext({ deviceId })`, currently line ~451)

**Interfaces:**
- Consumes: `rootStore.networkStore.setNetworkStatus(isConnected, connectionType, isInternetReachable)` (exists in `app/models/NetworkStore.ts:58`).
- Produces: `initNetworkMonitoring(rootStore: RootStore): void` from `@/services/network` — called exactly once from `app.tsx`; Task 6 relies on `networkStore.isOffline` being live after this.

- [ ] **Step 1: Install the SDK-pinned package**

```bash
npx expo install @react-native-community/netinfo
```

Verify `package.json` gained a `@react-native-community/netinfo` entry (Expo 54 pins ~11.x).

- [ ] **Step 2: Create the monitoring service**

Create `app/services/network/index.ts`:

```ts
/**
 * Network monitoring — the ONLY writer to NetworkStore.
 *
 * NetworkStore existed since the Ignite template with a comment promising a
 * "NetInfo listener" that was never actually wired: `isConnected` sat at its
 * default `true` forever, so `isOffline` never fired for its consumers (the
 * In-Person map toggle, Settings' offline row, the sync gate). ADDED
 * 2026-09-06 with the network-aware maintenance work — see
 * docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
 *
 * Reachability uses NetInfo's default probe URL, deliberately independent of
 * our API, so "internet reachable" and "RecoverySky reachable" stay two
 * distinct signals. `isOffline` keys off the interface state (`isConnected`),
 * NOT the probe — the probe host can be blocked on some national networks and
 * must not misclassify those users as offline.
 *
 * Never disposed: network state matters for the app's whole lifetime (same
 * rationale as the config-cache persistence reaction in app.tsx).
 */
import NetInfo, { NetInfoState } from "@react-native-community/netinfo"

import type { RootStore } from "@/models"
import { logger } from "@/utils/logger"

const log = logger.child({ module: "NetworkMonitor" })

type StoreConnectionType = "wifi" | "cellular" | "ethernet" | "unknown" | "none"

/**
 * NetInfo reports more types than NetworkStore's enum models (bluetooth,
 * wimax, vpn, other). Anything unmapped is "unknown" — the store only ever
 * branches on none-vs-rest and wifi/cellular.
 */
const TYPE_MAP: Partial<Record<NetInfoState["type"], StoreConnectionType>> = {
  wifi: "wifi",
  cellular: "cellular",
  ethernet: "ethernet",
  none: "none",
}

export function initNetworkMonitoring(rootStore: RootStore): void {
  let lastOffline: boolean | null = null

  // addEventListener fires immediately with the current state on subscribe,
  // so the store is live before the caller's next await completes.
  NetInfo.addEventListener((state: NetInfoState) => {
    const isConnected = state.isConnected === true
    rootStore.networkStore.setNetworkStatus(
      isConnected,
      TYPE_MAP[state.type] ?? "unknown",
      state.isInternetReachable,
    )

    // Log only offline-state EDGES, not every event — NetInfo emits on any
    // interface detail change and would spam Loki.
    const isOffline = !isConnected
    if (isOffline !== lastOffline) {
      log.info("Device network state changed", { isOffline, type: state.type })
      lastOffline = isOffline
    }
  })
}
```

- [ ] **Step 3: Call it from app.tsx init**

In `app/app.tsx`, add to the internal imports block (alphabetical position, next to the other `./services/` imports):

```ts
import { initNetworkMonitoring } from "./services/network"
```

Then insert immediately after `logger.setContext({ deviceId })` (the line following `_rootStore.authenticationStore.setDeviceId(deviceId)`):

```ts
        // Live device network state → NetworkStore. Registered BEFORE the
        // /status precheck below so the outage screen's Device Offline vs
        // System Maintenance variant has a real value from its first frame
        // (NetInfo fires the listener immediately with the current state).
        // Also finally activates NetworkStore's existing consumers — the
        // sync gate, the In-Person map toggle, Settings' offline row.
        // ADDED 2026-09-06: network-aware maintenance spec.
        initNetworkMonitoring(_rootStore)
```

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run lint:deps && npx eslint app/services/network/index.ts app/app.tsx --fix`
Expected: clean. (`lint:deps` confirms the new `services/network → models` edge doesn't trip depcruise; the type-only `RootStore` import is erased at runtime.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app/services/network/index.ts app/app.tsx
git commit -m "✨ feat(network): wire NetInfo into the previously-dead NetworkStore"
```

---

### Task 3: i18n keys (nine locales)

**Files:**
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts`, `app/i18n/ar.ts`, `app/i18n/de.ts`, `app/i18n/fr.ts`, `app/i18n/pt.ts`, `app/i18n/ru.ts`, `app/i18n/th.ts`, `app/i18n/uk.ts`

**Interfaces:**
- Produces: keys `common:offlineBanner`, `maintenance:offlineTitle`, `maintenance:offlineSubtitle` — Tasks 4 and 5 reference them via `tx` props.

- [ ] **Step 1: Add the English keys**

In `app/i18n/en.ts`, inside `common` directly after the `maintenanceBanner` line:

```ts
    offlineBanner: "You're offline. Showing saved data.",
```

Inside `maintenance` after the `subtitle` line:

```ts
    offlineTitle: "You're offline",
    offlineSubtitle: "Check your internet connection. The app will reconnect automatically.",
```

- [ ] **Step 2: Add the same keys to the other eight locales**

Same block positions in each file (find the existing `maintenanceBanner` /
`maintenance` keys and mirror). Before pasting, check each file's existing
register (e.g. de may use du or Sie) and adjust to match its neighbors —
these are draft translations queued for native-speaker review, but they must
not clash with the file's established tone.

`es.ts`:
```ts
    offlineBanner: "Sin conexión. Mostrando datos guardados.",
    // in maintenance:
    offlineTitle: "Sin conexión",
    offlineSubtitle: "Comprueba tu conexión a internet. La aplicación se reconectará automáticamente.",
```

`ar.ts`:
```ts
    offlineBanner: "أنت غير متصل. يتم عرض البيانات المحفوظة.",
    // in maintenance:
    offlineTitle: "أنت غير متصل بالإنترنت",
    offlineSubtitle: "تحقق من اتصالك بالإنترنت. سيُعاد الاتصال تلقائيًا.",
```

`de.ts`:
```ts
    offlineBanner: "Du bist offline. Gespeicherte Daten werden angezeigt.",
    // in maintenance:
    offlineTitle: "Du bist offline",
    offlineSubtitle: "Überprüfe deine Internetverbindung. Die App verbindet sich automatisch neu.",
```

`fr.ts`:
```ts
    offlineBanner: "Vous êtes hors ligne. Affichage des données enregistrées.",
    // in maintenance:
    offlineTitle: "Vous êtes hors ligne",
    offlineSubtitle: "Vérifiez votre connexion Internet. L'application se reconnectera automatiquement.",
```

`pt.ts`:
```ts
    offlineBanner: "Você está offline. Mostrando dados salvos.",
    // in maintenance:
    offlineTitle: "Você está offline",
    offlineSubtitle: "Verifique sua conexão com a internet. O aplicativo se reconectará automaticamente.",
```

`ru.ts`:
```ts
    offlineBanner: "Вы не в сети. Показаны сохранённые данные.",
    // in maintenance:
    offlineTitle: "Вы не в сети",
    offlineSubtitle: "Проверьте подключение к интернету. Приложение переподключится автоматически.",
```

`th.ts`:
```ts
    offlineBanner: "คุณออฟไลน์อยู่ กำลังแสดงข้อมูลที่บันทึกไว้",
    // in maintenance:
    offlineTitle: "คุณออฟไลน์อยู่",
    offlineSubtitle: "โปรดตรวจสอบการเชื่อมต่ออินเทอร์เน็ต แอปจะเชื่อมต่อใหม่โดยอัตโนมัติ",
```

`uk.ts`:
```ts
    offlineBanner: "Ви офлайн. Показано збережені дані.",
    // in maintenance:
    offlineTitle: "Ви офлайн",
    offlineSubtitle: "Перевірте з'єднання з інтернетом. Застосунок автоматично відновить з'єднання.",
```

- [ ] **Step 3: Verify the nine-file contract**

Run: `npm run compile`
Expected: clean — a missing key in any locale is a hard `tsc` error.

- [ ] **Step 4: Commit**

```bash
git add app/i18n/en.ts app/i18n/es.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "✨ feat(i18n): offline banner + offline outage-screen strings, nine locales"
```

---

### Task 4: Two-variant MaintenanceBanner

**Files:**
- Modify: `app/components/MaintenanceBanner.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `decideBanner` from `@/utils/connectivityLogic` (Task 1); `useNetworkStore` from `@/models`; i18n keys from Task 3.
- Produces: no new exports — same `MaintenanceBanner` component, new behavior.

- [ ] **Step 1: Rewrite the component**

Replace the body of `app/components/MaintenanceBanner.tsx` with:

```tsx
/**
 * MaintenanceBanner
 *
 * Sticky strip pinned to the top of the screen. Two variants, chosen by the
 * pure `decideBanner`:
 *
 * - "offline" — the device has no network. Muted blue-grey, informational:
 *   it's the user's connectivity, not our service, and it also explains why
 *   refreshes come up empty. Wins over maintenance (an offline device can't
 *   verify a maintenance claim).
 * - "maintenance" — the server flagged maintenance mode, or /config polling
 *   failed past the retry budget WHILE THE DEVICE WAS ONLINE (offline poll
 *   failures no longer flip maintenanceMode — see ConfigStore.fetchConfig).
 *   The original amber strip.
 *
 * Renders above every navigator including modals because it's mounted as an
 * absolutely-positioned overlay outside the navigation tree. Still
 * non-blocking: the navigator is never gated, so a mid-meeting external-Zoom
 * timer survives both variants.
 *
 * Replaces the old full-screen MaintenanceScreen takeover for runtime
 * maintenance. The full-screen flow is reserved for cold-start outages —
 * see `configStore.outageMode` and AppNavigator.
 * CHANGED 2026-09-06: split into the two variants above; previously a single
 * maintenance strip that offline users saw too (the false-banner complaint).
 */

import { FC } from "react"
import { StyleSheet, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Text } from "@/components/Text"
import { useConfigStore, useNetworkStore } from "@/models"
import { decideBanner } from "@/utils/connectivityLogic"

const MAINT_BG = "#FFC107" // amber 500 — high-contrast attention without being garish
const MAINT_FG = "#1C1C1E" // neutral 800 — dark text on amber for AA contrast
const OFFLINE_BG = "#546E7A" // blue-grey 600 — calm/informational, not alarm-amber
const OFFLINE_FG = "#FFFFFF" // white on blue-grey 600 ≈ 4.7:1, AA for this size/weight

export const MaintenanceBanner: FC = observer(function MaintenanceBanner() {
  const configStore = useConfigStore()
  const networkStore = useNetworkStore()
  const insets = useSafeAreaInsets()

  const banner = decideBanner({
    isOffline: networkStore.isOffline,
    maintenanceMode: configStore.maintenanceMode,
  })
  if (banner === "none") return null

  const offline = banner === "offline"

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: offline ? OFFLINE_BG : MAINT_BG, paddingTop: insets.top + 8 },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <View style={styles.row}>
        <Ionicons
          name={offline ? "cloud-offline-outline" : "warning-outline"}
          size={18}
          color={offline ? OFFLINE_FG : MAINT_FG}
        />
        <Text
          style={[styles.text, { color: offline ? OFFLINE_FG : MAINT_FG }]}
          tx={offline ? "common:offlineBanner" : "common:maintenanceBanner"}
        />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    left: 0,
    paddingBottom: 10,
    paddingHorizontal: 16,
    position: "absolute",
    right: 0,
    top: 0,
    // High zIndex so the banner sits above modals (Zoom timer, login,
    // import, etc.). Toast uses 9999; we sit just below it so a toast
    // can still appear on top during maintenance.
    zIndex: 9000,
  } satisfies ViewStyle,
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
  },
})
```

- [ ] **Step 2: Verify**

Run: `npm run compile && npx eslint app/components/MaintenanceBanner.tsx --fix`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/components/MaintenanceBanner.tsx
git commit -m "✨ feat(maintenance): offline vs maintenance banner variants, offline wins"
```

---

### Task 5: Two-variant MaintenanceScreen

**Files:**
- Modify: `app/screens/MaintenanceScreen.tsx`

**Interfaces:**
- Consumes: `decideOutageVariant` from `@/utils/connectivityLogic` (Task 1); `useNetworkStore` from `@/models`; i18n keys from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Add the variant switch**

In `app/screens/MaintenanceScreen.tsx`:

1. Extend the header comment (keep the existing text, append):

```ts
 * CHANGED 2026-09-06: two variants, chosen live by decideOutageVariant —
 * "Device Offline" (cloud icon, check-your-connection copy, no support
 * link: a web link is useless offline) when NetworkStore says the device
 * has no network, and the original "System Maintenance" copy when the
 * device is online but the API isn't answering. Because this is an
 * observer, wifi returning mid-outage flips the copy to the maintenance
 * variant until the recovery poll reloads the app.
```

2. Update imports:

```tsx
import { useAppTheme } from "@/theme/context"
import { useNetworkStore } from "@/models"
import { decideOutageVariant } from "@/utils/connectivityLogic"
```

3. Replace the component body's top and content block:

```tsx
export const MaintenanceScreen: FC = observer(function MaintenanceScreen() {
  const { themed, theme } = useAppTheme()
  const networkStore = useNetworkStore()

  const offline = decideOutageVariant({ isOffline: networkStore.isOffline }) === "offline"

  return (
    <Screen preset="fixed" safeAreaEdges={["top", "bottom"]} contentContainerStyle={themed($container)}>
      <View style={$content}>
        <Ionicons
          name={offline ? "cloud-offline-outline" : "construct-outline"}
          size={80}
          color={theme.colors.tint}
        />
        <Text style={themed($title)} tx={offline ? "maintenance:offlineTitle" : "maintenance:title"} />
        <Text
          style={themed($subtitle)}
          tx={offline ? "maintenance:offlineSubtitle" : "maintenance:subtitle"}
        />
      </View>

      <View style={$footer}>
        <ActivityIndicator size="small" color={theme.colors.textDim} />
        <Text style={themed($checkingText)} tx="maintenance:checking" />

        {/* Support link only in the maintenance variant — a web link is
            useless on an offline device. */}
        {!offline && (
          <Pressable
            onPress={() => Linking.openURL(SUPPORT_URL)}
            accessibilityRole="link"
            accessibilityLabel={translate("maintenance:support")}
            style={$supportLink}
          >
            <Ionicons name="help-circle-outline" size={16} color={theme.colors.tint} />
            <Text style={[themed($supportText), { color: theme.colors.tint }]} tx="maintenance:support" />
          </Pressable>
        )}
      </View>
    </Screen>
  )
})
```

Everything below the component (styles) is unchanged.

- [ ] **Step 2: Verify**

Run: `npm run compile && npx eslint app/screens/MaintenanceScreen.tsx --fix`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/screens/MaintenanceScreen.tsx
git commit -m "✨ feat(maintenance): Device Offline variant of the cold-start outage screen"
```

---

### Task 6: Poll gating — skip offline ticks, refetch on reconnect, stop false maintenance flips

**Files:**
- Modify: `app/app.tsx` (config poll effect, currently lines ~783-818; outage recovery effect, currently lines ~820-865)
- Modify: `app/models/ConfigStore.ts` (exhausted-retries branch of `fetchConfig`, currently lines ~283-298)

**Interfaces:**
- Consumes: `shouldSkipConfigPoll`, `shouldFlipMaintenanceOnPollFailure` from `@/utils/connectivityLogic` (Task 1); live `networkStore.isOffline` (Task 2).
- Produces: no new exports; `maintenanceMode` semantics change (can no longer be flipped by an offline device).

- [ ] **Step 1: Gate the config poll in app.tsx**

Add to app.tsx imports: `import { shouldSkipConfigPoll } from "./utils/connectivityLogic"` (with the other `./utils/` imports).

In the config-poll effect, replace the `startPolling` interval callback and add a reconnect reaction. The full effect becomes:

```tsx
  // Poll server config — faster during maintenance to detect when it ends
  useEffect(() => {
    if (!rootStore) return

    const NORMAL_INTERVAL = (Number(process.env.EXPO_PUBLIC_CONFIG_POLL_SECONDS) || 60) * 1000
    const MAINTENANCE_INTERVAL =
      (Number(process.env.EXPO_PUBLIC_CONFIG_POLL_MAINTENANCE_SECONDS) || 15) * 1000

    let interval: ReturnType<typeof setInterval>

    const startPolling = (ms: number) => {
      clearInterval(interval)
      interval = setInterval(() => {
        // CHANGED 2026-09-06: offline ticks are skipped entirely — a poll
        // that cannot succeed must not run, or its failure gets counted as
        // maintenance evidence (the false-banner complaint). The reconnect
        // reaction below resyncs the moment the device is back.
        if (shouldSkipConfigPoll({ isOffline: rootStore.networkStore.isOffline })) {
          log.debug("Config poll skipped — device offline")
          return
        }
        log.debug("Config poll triggered", {
          maintenanceMode: rootStore.configStore.maintenanceMode,
        })
        rootStore.configStore.fetchConfig()
      }, ms)
    }

    // Start with appropriate interval
    startPolling(rootStore.configStore.maintenanceMode ? MAINTENANCE_INTERVAL : NORMAL_INTERVAL)

    // React to maintenance mode changes and adjust interval
    const dispose = reaction(
      () => rootStore.configStore.maintenanceMode,
      (inMaintenance) => {
        log.info("Config poll interval changed", { inMaintenance })
        startPolling(inMaintenance ? MAINTENANCE_INTERVAL : NORMAL_INTERVAL)
      },
    )

    // ADDED 2026-09-06: immediate refetch on the offline→online edge, so a
    // reconnecting user doesn't wait out the poll interval — and if server
    // maintenance ended while we were offline, the banner clears promptly.
    const disposeReconnect = reaction(
      () => rootStore.networkStore.isOffline,
      (isOffline, prevOffline) => {
        if (prevOffline === true && isOffline === false) {
          log.info("Network reconnected — immediate config refetch")
          rootStore.configStore.fetchConfig()
        }
      },
    )

    return () => {
      clearInterval(interval)
      dispose()
      disposeReconnect()
    }
  }, [rootStore])
```

- [ ] **Step 2: Make the outage recovery loop network-aware**

Replace the outage-recovery effect with (existing comments kept, additions marked):

```tsx
  // Outage recovery loop — polls /status while we're stuck in cold-start
  // outage mode. When the API comes back, reload the app so the full init
  // sequence (attestation, fetchConfig, Umami, push, etc.) re-runs from
  // scratch. Reload is the safe option here: the bootstrap registers MobX
  // reactions that would duplicate if we re-ran init in place. The user
  // sees a brief splash flash but no manual intervention is needed.
  // CHANGED 2026-09-06: interval ticks early-return while the device is
  // offline (they cannot succeed and just burn radio), and a reconnect
  // reaction fires one immediate check so a returning connection doesn't
  // wait out the 15s interval.
  useEffect(() => {
    if (!rootStore) return

    let interval: ReturnType<typeof setInterval> | undefined

    const checkStatusAndReload = async () => {
      const result = await api.getPublicStatus()
      if (result.kind === "ok") {
        log.info("/status recovered — reloading app to resume init")
        if (interval) {
          clearInterval(interval)
          interval = undefined
        }
        // CHANGED 2026-05-21: via reloadApp() to close the expo-sqlite
        // SharedObject before teardown — avoids the SharedObjectRegistry
        // .clear / ~WeakObject EXC_BAD_ACCESS crash seen on OTA reloads.
        reloadApp((e) => {
          log.warn("reloadAsync failed during outage recovery", { error: String(e) })
        })
      }
    }

    const dispose = reaction(
      () => rootStore.configStore.outageMode,
      (inOutage) => {
        if (interval) {
          clearInterval(interval)
          interval = undefined
        }
        if (!inOutage) return

        log.info("Outage detected — starting /status recovery polling")
        interval = setInterval(() => {
          if (rootStore.networkStore.isOffline) return // wait for the reconnect reaction
          void checkStatusAndReload()
        }, 15_000)
      },
      { fireImmediately: true },
    )

    // ADDED 2026-09-06: one immediate check on the offline→online edge while
    // in outage — the common case is "user launched in airplane mode, then
    // turned it off"; they should recover in seconds, not at the next tick.
    const disposeReconnect = reaction(
      () => rootStore.networkStore.isOffline,
      (isOffline, prevOffline) => {
        if (rootStore.configStore.outageMode && prevOffline === true && isOffline === false) {
          void checkStatusAndReload()
        }
      },
    )

    return () => {
      if (interval) clearInterval(interval)
      dispose()
      disposeReconnect()
    }
  }, [rootStore])
```

- [ ] **Step 3: Gate the maintenance flip in ConfigStore**

In `app/models/ConfigStore.ts`:

1. Add imports:

```ts
import { flow, getRoot, Instance, SnapshotOut, types } from "mobx-state-tree"

import { shouldFlipMaintenanceOnPollFailure } from "@/utils/connectivityLogic"
```

2. Replace the exhausted-retries block inside `fetchConfig` (after the retry loop, the `// All retries exhausted` section) with:

```ts
          // All retries exhausted.
          // CHANGED 2026-09-06: the runtime flip is gated on the device
          // actually being ONLINE — an offline device's failed polls are its
          // own connectivity, already surfaced by the offline banner, and
          // flipping maintenanceMode here was how subway riders got a
          // "Maintenance in progress" banner. getRoot reaches the sibling
          // NetworkStore; on a detached/test store it returns this node and
          // the optional chain lands on false ("online"), preserving the old
          // behavior — fail toward the maintenance path, never toward
          // silently blaming the user's device.
          const isOffline =
            (getRoot(store) as { networkStore?: { isOffline?: boolean } })?.networkStore
              ?.isOffline ?? false
          if (shouldFlipMaintenanceOnPollFailure({ isOffline, isLoaded: store.isLoaded })) {
            // Config was previously loaded (polling failure) — enter maintenance mode
            // so the user sees the maintenance banner instead of stale data.
            log.warn(
              "Config poll failed after " + MAX_RETRIES + " attempts — entering maintenance mode",
            )
            store.maintenanceMode = true
            store.maintenanceMessage = ""
            store.maintenanceUntil = ""
          } else if (store.isLoaded) {
            log.warn("Config poll failed while device offline — not flipping maintenance mode")
          } else {
            // Initial startup failure — caller (app.tsx) handles via setOutageMode()
            log.warn(
              "Config fetch failed after " + MAX_RETRIES + " attempts, using env var defaults",
            )
          }
```

- [ ] **Step 4: Verify**

Run: `npm run compile && npm run test:unit && npx eslint app/app.tsx app/models/ConfigStore.ts --fix`
Expected: compile clean, all vitest suites pass (confirms no pure module regressed), lint clean.

- [ ] **Step 5: Commit**

```bash
git add app/app.tsx app/models/ConfigStore.ts
git commit -m "🐛 fix(maintenance): offline devices no longer trigger false maintenance banners"
```

---

### Task 7: Docs, changelog, manual checklist

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `CLAUDE.md` ("Maintenance Mode" section; NetworkStore line under "State Management")
- Modify: `docs/PRODUCTION_CHECKLIST.md` (append manual checks)
- Modify: `docs/translation-review-2026-08-03.md` (queue the three new keys)

**Interfaces:** none — documentation only, but REQUIRED before release (changelog discipline is a repo rule).

- [ ] **Step 1: CHANGELOG entries**

Under `## [Unreleased]` add (create the group headings if absent):

```markdown
### Added
- Device network detection (NetInfo → NetworkStore): the app now knows when
  the device itself is offline. Activates the previously-inert offline
  consumers — cloud-backup sync pauses while offline, the In-Person map
  toggle disables, Settings shows its offline state.
- "Device Offline" variants of the maintenance UX: the cold-start outage
  screen and the sticky top banner now say "you're offline — check your
  connection" when the device has no network, reserving the maintenance
  copy for when the device is online but the RecoverySky API isn't
  answering.

### Fixed
- Users without connectivity (subway, airplane mode, dead zones) no longer
  see the "Maintenance in progress" banner: config-poll failures while the
  device is offline are no longer treated as evidence of service
  maintenance, and polling pauses entirely until the connection returns
  (with an immediate resync on reconnect).

### Build
- ⚠️ NATIVE RELEASE REQUIRED: adds `@react-native-community/netinfo`
  (native module). Bump `runtimeVersion` with the next native version bump;
  this must not ship as an OTA on the current runtime. Dev clients must be
  rebuilt.
```

- [ ] **Step 2: CLAUDE.md updates**

1. In "State Management", extend the NetworkStore bullet to:

```markdown
- **NetworkStore**: Online/offline tracking with `isOffline`, `hasInternet` computed. Fed by the NetInfo listener in `app/services/network/` (registered once in `app.tsx`; sole writer). `isOffline` keys off the interface state, not the reachability probe.
```

2. In "Maintenance Mode", after the `maintenanceMode` bullet's existing text, append:

```markdown
  CHANGED 2026-09-06: the polling-failure trigger fires ONLY while the
  device is online (`networkStore.isOffline` false). Offline poll failures
  never flip this flag — the banner shows its "Device Offline" variant
  instead, and polling pauses until reconnect. Decision logic in
  `app/utils/connectivityLogic.ts` (vitest-covered); spec:
  docs/superpowers/specs/2026-09-06-network-aware-maintenance-design.md.
```

3. In the same section's banner paragraph, append:

```markdown
  The banner is two-variant: a muted blue-grey "You're offline" strip
  (which WINS over maintenance — offline is the more accurate diagnosis)
  and the amber maintenance strip. `MaintenanceScreen` mirrors the split
  for cold-start outage ("Device Offline" vs "System Maintenance", live-
  switching since it observes NetworkStore).
```

- [ ] **Step 3: PRODUCTION_CHECKLIST manual checks**

Append to `docs/PRODUCTION_CHECKLIST.md` under a `### Network-aware maintenance (2026-09-06)` heading:

```markdown
- [ ] Airplane mode → cold start: "Device Offline" full screen; disabling
      airplane mode recovers into a normal session within ~15s (reload).
- [ ] Airplane mode mid-session: blue-grey offline banner appears; logs show
      "Config poll skipped — device offline" and NO maintenance flip;
      disabling airplane mode clears the banner and logs
      "Network reconnected — immediate config refetch".
- [ ] API down while online (block api host / stop local API): amber
      maintenance banner after one failed poll cycle; cold start in the same
      state shows the "System Maintenance" full screen.
- [ ] Server MAINTENANCE_MODE=true: banner on warm start, full screen on
      cold start — unchanged from before.
- [ ] External-Zoom timer running while toggling airplane mode: timer modal
      survives both banner variants.
```

- [ ] **Step 4: Queue translations for review**

In `docs/translation-review-2026-08-03.md`, append the three new keys
(`common:offlineBanner`, `maintenance:offlineTitle`,
`maintenance:offlineSubtitle`) to the pending-review list for all eight
non-English locales, following the file's existing format.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md docs/PRODUCTION_CHECKLIST.md docs/translation-review-2026-08-03.md
git commit -m "📝 docs: changelog + maintenance-mode docs for network-aware maintenance"
```

---

## Final verification (after all tasks)

- `npm run compile` — clean
- `npm run test:unit` — all vitest suites pass
- `npm run test:component` — all jest suites pass (no component test touched, but confirm no regression)
- `npm run lint:deps` — clean
- Manual: run the PRODUCTION_CHECKLIST items above on a rebuilt dev client (`npm run build:ios:sim` — the NetInfo native module is NOT in existing dev builds).
- Release reminder: ships via the NATIVE path — `npm run minor` (or patch), manual `runtimeVersion` bump in `app.json`, then `release:ios` / `release:android`. Not an OTA.
