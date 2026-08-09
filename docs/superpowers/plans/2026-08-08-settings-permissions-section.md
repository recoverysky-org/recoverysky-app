# Settings Permissions Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings → Permissions section holding a new Location toggle and a premium-gated Push Notifications row, and make the In-Person segment ask for location on every visit until it is granted.

**Architecture:** A new `profileStore.locationEnabled` boolean (default false) is the app-level switch. The decision of what to do when the In-Person segment opens — proceed, prompt the OS, confirm in-app, or deep-link to device settings — is a pure function in `app/utils/locationGateLogic.ts` covered by vitest; the I/O half (reading OS status, showing dialogs) lives in a new `useLocationGate` hook. This mirrors the existing `presenceLogic.ts` / `usePresenceCheck.ts` split.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree, `expo-location`, RevenueCat via `useSubscription()`, i18next (nine locales), vitest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md`

## Global Constraints

- **Nine locales, always.** `app/i18n/en.ts` declares `export type Translations = typeof en`; every other locale is typed `const xx: Translations`. A new key is a **nine-file change** (`en`, `es`, `ar`, `de`, `fr`, `pt`, `ru`, `th`, `uk`). Missing keys are a hard `tsc` error. English text may stand in for the other eight.
- **Vitest cannot resolve the `@/` alias.** Any module a `*.test.ts` imports must have **zero runtime `@/` imports** (type-only imports are erased and fine).
- **Test runner split by extension:** `*.test.ts` → vitest, `*.test.tsx` → jest-expo. Never mix.
- **`observer()` from `mobx-react-lite` is load-bearing** on any component reading MST state. `InPersonContent` and `SettingsScreen` are already wrapped — do not remove.
- **No raw `Text` / `Switch` imports from `react-native`** where a `@/components` wrapper exists. `Text` must come from `@/components`. `Switch` has no wrapper and is imported from `react-native` throughout `SettingsScreen.tsx` — follow that file's existing import.
- **Comment discipline (CLAUDE.md):** comments are written liberally and kept accurate. When changing behaviour, keep the original functional comment and append a `CHANGED 2026-08-08:` note explaining the failure mode or motivation.
- **Default values are exact:** `locationEnabled` defaults `false`; `notificationsEnabled` default changes from `true` to `false`.
- **Do not bump `runtimeVersion`.** This is a JS-only change — no new native dependency, no `app.json` native config change. It ships OTA.

## Deviations from the spec

Two, both deliberate. Neither changes behaviour the spec described.

1. **No `settingsScreen:notificationsPremiumTitle` / `…Message` keys.** The
   spec listed them, but D2's text is "tapping opens the paywall" — and
   RevenueCat's paywall already states what a subscription unlocks. An
   intermediate alert would add a tap between the user and the funnel, which
   is the opposite of why the row was kept visually active. The tap calls
   `showPaywall()` directly.
2. **`PermissionsSection` is its own file**, not a component inside
   `SettingsScreen.tsx`. The spec's component table implied the latter. A jest
   test that imports from `SettingsScreen.tsx` evaluates that whole module —
   navigation, RevenueCat, the MST tree — so the test would need extensive
   mocking to assert two props. A presentational component in its own file
   needs none.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/utils/locationGateLogic.ts` (create) | Pure decisions: OS-permission-shape → status, and (status, toggle) → action. Zero `@/` runtime imports. |
| `app/utils/locationGateLogic.test.ts` (create) | Vitest coverage of both pure functions. |
| `app/models/ProfileStore.ts` (modify) | `locationEnabled` prop + `setLocationEnabled` action; `notificationsEnabled` default and reset value. |
| `app/i18n/*.ts` (modify ×9) | New `settingsScreen` and `location` keys. |
| `app/components/PermissionsSection.tsx` (create) | The two-row section, presentational. Its own file so its jest test can mount it without dragging navigation, RevenueCat and the store tree in via `SettingsScreen`. |
| `app/components/PermissionsSection.test.tsx` (create) | Jest coverage of the non-premium paywall tap and the not-greyed switch. |
| `app/screens/SettingsScreen.tsx` (modify) | Handlers (`handleLocationToggle`, `handleNotificationsPaywall`) and mounting the section. |
| `app/hooks/useLocationGate.ts` (create) | I/O orchestrator: reads OS status, runs `decideLocationGate`, performs prompt/confirm/deep-link. |
| `app/hooks/useNearbySchedules.ts` (modify) | Short-circuit before requesting permission when the toggle is off. |
| `app/screens/InPersonScreen.tsx` (modify) | Run the gate when the segment becomes visible; render banner instead of list; suppress map toggle. |
| `app/components/InPersonPopup.tsx` (modify) | "I'm Here" silent self-heal. |
| `CHANGELOG.md` (modify) | User-facing entries. |

---

## Task 1: Pure location-gate logic

**Files:**
- Create: `app/utils/locationGateLogic.ts`
- Test: `app/utils/locationGateLogic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type LocationOsStatus = "granted" | "denied" | "undetermined"`
  - `type LocationGateAction = "proceed" | "prompt-os" | "confirm-in-app" | "open-settings"`
  - `toOsStatus(perm: { granted: boolean; canAskAgain: boolean }): LocationOsStatus`
  - `decideLocationGate(input: { locationEnabled: boolean; osStatus: LocationOsStatus }): LocationGateAction`

- [ ] **Step 1: Write the failing test**

Create `app/utils/locationGateLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { decideLocationGate, toOsStatus } from "./locationGateLogic"

describe("toOsStatus", () => {
  it("maps a granted permission to granted", () => {
    expect(toOsStatus({ granted: true, canAskAgain: false })).toBe("granted")
  })

  it("maps not-granted-but-askable to undetermined", () => {
    expect(toOsStatus({ granted: false, canAskAgain: true })).toBe("undetermined")
  })

  it("maps not-granted-and-not-askable to denied", () => {
    expect(toOsStatus({ granted: false, canAskAgain: false })).toBe("denied")
  })
})

describe("decideLocationGate", () => {
  it("proceeds when the toggle is on and the OS agrees", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "granted" })).toBe("proceed")
  })

  it("prompts the OS when the toggle is on but permission was never asked", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "undetermined" })).toBe("prompt-os")
  })

  it("sends the user to settings when the OS revoked an enabled toggle", () => {
    expect(decideLocationGate({ locationEnabled: true, osStatus: "denied" })).toBe("open-settings")
  })

  it("prompts the OS on a fresh install with the toggle off", () => {
    expect(decideLocationGate({ locationEnabled: false, osStatus: "undetermined" })).toBe(
      "prompt-os",
    )
  })

  it("confirms in-app when the OS already granted but the toggle is off", () => {
    // The one branch that must NOT deep-link: there is nothing to change in
    // device settings, so sending the user there is a dead end.
    expect(decideLocationGate({ locationEnabled: false, osStatus: "granted" })).toBe(
      "confirm-in-app",
    )
  })

  it("sends the user to settings when both the toggle and the OS say no", () => {
    expect(decideLocationGate({ locationEnabled: false, osStatus: "denied" })).toBe("open-settings")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/utils/locationGateLogic.test.ts`
Expected: FAIL — `Failed to resolve import "./locationGateLogic"`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/locationGateLogic.ts`:

```ts
/**
 * locationGateLogic — pure decisions for the In-Person location gate.
 *
 * Deliberately free of runtime `@/` imports so vitest can execute it (vitest
 * has no path-alias resolution in this repo — see CLAUDE.md "Test Runner
 * Split"). The I/O half — reading OS status, showing the dialogs, opening
 * device settings — lives in `@/hooks/useLocationGate`.
 *
 * See docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md.
 */

/**
 * The OS permission state, reduced to the three cases that lead to different
 * actions. Deliberately NOT expo-location's `PermissionStatus` enum: importing
 * it would make this module unimportable by vitest, and the shape below is
 * what the rest of the app already reasons about.
 */
export type LocationOsStatus = "granted" | "denied" | "undetermined"

/**
 * What the caller should do next.
 *
 * - `proceed` — location is available and wanted; use it.
 * - `prompt-os` — the system dialog can still be shown; show it.
 * - `confirm-in-app` — the OS already said yes and only our own toggle is off,
 *   so there is nothing for the OS to ask. Our dialog is the only one that can
 *   change anything here.
 * - `open-settings` — the OS said no and will not ask again. Only device
 *   settings can undo it.
 */
export type LocationGateAction = "proceed" | "prompt-os" | "confirm-in-app" | "open-settings"

/**
 * Reduce an expo-location permission response to `LocationOsStatus`.
 *
 * Derived from `granted` + `canAskAgain` rather than read off `status`,
 * because those two fields are what `useNearbySchedules` and
 * `usePresenceCheck` already branch on — one shared notion of "denied" beats
 * two that can drift.
 */
export function toOsStatus(perm: { granted: boolean; canAskAgain: boolean }): LocationOsStatus {
  if (perm.granted) return "granted"
  return perm.canAskAgain ? "undetermined" : "denied"
}

/**
 * Decide what opening the In-Person segment should do.
 *
 * The `locationEnabled: false, osStatus: "granted"` case is the load-bearing
 * one: it covers BOTH the user who turned the toggle off in Settings and the
 * user returning from device settings having just enabled it, without needing
 * to know which they are. Sending either to device settings would land them on
 * a screen where location is already on and nothing needs changing.
 */
export function decideLocationGate(input: {
  locationEnabled: boolean
  osStatus: LocationOsStatus
}): LocationGateAction {
  if (input.osStatus === "denied") return "open-settings"
  if (input.osStatus === "undetermined") return "prompt-os"
  // osStatus === "granted" from here.
  return input.locationEnabled ? "proceed" : "confirm-in-app"
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/utils/locationGateLogic.test.ts`
Expected: PASS — 6 tests in `decideLocationGate`, 3 in `toOsStatus`.

- [ ] **Step 5: Type check**

Run: `npm run compile`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add app/utils/locationGateLogic.ts app/utils/locationGateLogic.test.ts
git commit -m "✨ feat(location): pure gate logic for the In-Person location prompt"
```

---

## Task 2: ProfileStore state

**Files:**
- Modify: `app/models/ProfileStore.ts` — props block near `:69-70`, actions block near `:332`, reset block near `:491`

**Interfaces:**
- Consumes: nothing.
- Produces: `profileStore.locationEnabled: boolean` and `profileStore.setLocationEnabled(value: boolean): void`.

There is no vitest coverage for this file — it imports `@/utils/presenceLogic`, so vitest cannot load it. `npm run compile` plus the consuming tasks' tests are the verification. Do not add a `.test.ts` for it.

- [ ] **Step 1: Add the `locationEnabled` prop**

In the props block, immediately after the `// Notifications` group (currently `notificationsEnabled: types.optional(types.boolean, true),`), add:

```ts
    // Location — default OFF. Nothing in the app may read a position until
    // the user turns this on, and the In-Person segment gate is what asks
    // (app/utils/locationGateLogic.ts). Kept separate from the OS permission
    // on purpose: an app cannot revoke its own OS grant, so this is the only
    // switch that can actually mean "stop using my location".
    locationEnabled: types.optional(types.boolean, false),
```

- [ ] **Step 2: Change the `notificationsEnabled` default**

Replace:

```ts
    // Notifications
    notificationsEnabled: types.optional(types.boolean, true),
```

with:

```ts
    // Notifications
    // CHANGED 2026-08-08: default flipped true → false. Push is now gated on
    // the premium entitlement and a non-premium user cannot turn it off from
    // Settings (every tap routes to the paywall), so defaulting it ON would
    // trap them receiving notifications. Only affects NEW installs — existing
    // users have a persisted MMKV value that wins over this default.
    notificationsEnabled: types.optional(types.boolean, false),
```

- [ ] **Step 3: Add the `setLocationEnabled` action**

Immediately after the existing `setNotificationsEnabled` action:

```ts
      setLocationEnabled(value: boolean) {
        self.locationEnabled = value
      },
```

- [ ] **Step 4: Fix the reset path**

In the reset block, replace `self.notificationsEnabled = true` with:

```ts
        // CHANGED 2026-08-08: was `true`. A reset that re-enabled push would
        // hand a non-premium user notifications they cannot switch off, since
        // the Settings row routes to the paywall instead of toggling.
        self.notificationsEnabled = false
        self.locationEnabled = false
```

- [ ] **Step 5: Type check**

Run: `npm run compile`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add app/models/ProfileStore.ts
git commit -m "✨ feat(profile): add locationEnabled, default notifications off"
```

---

## Task 3: i18n keys across all nine locales

**Files:**
- Modify: `app/i18n/en.ts`, `app/i18n/es.ts`, `app/i18n/ar.ts`, `app/i18n/de.ts`, `app/i18n/fr.ts`, `app/i18n/pt.ts`, `app/i18n/ru.ts`, `app/i18n/th.ts`, `app/i18n/uk.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the translation keys Tasks 4 and 7 reference.

`en.ts` declares `export type Translations = typeof en` and the other eight are typed against it, so **all nine files must change together or `tsc` fails**. Use the identical English strings in all nine — a native-speaker review queue item beats a broken build.

- [ ] **Step 1: Replace the `notificationsSection` key in `en.ts`**

In the `settingsScreen` block, replace:

```ts
    notificationsSection: "Notifications",
```

with:

```ts
    permissionsSection: "Permissions",
```

- [ ] **Step 2: Add the remaining `settingsScreen` keys in `en.ts`**

Immediately after `notificationsHint`, add:

```ts
    enableLocation: "Location",
    locationHint: "Find meetings near you, and confirm you're there when you log attendance",
```

- [ ] **Step 3: Add the `location` namespace to `en.ts`**

Add a new top-level block alongside the existing `presence` block:

```ts
  location: {
    gateConfirmTitle: "Use your location?",
    gateConfirmMessage:
      "Recovery Sky uses your location to show in-person meetings near you, and to confirm you're there when you log attendance.",
    gateConfirmAccept: "Turn On",
    gateDeniedTitle: "Location is off",
    gateDeniedMessage:
      "Turn on location for Recovery Sky in your device settings to see in-person meetings near you.",
    openSettings: "Open Settings",
    emptyNeedsLocation: "Turn on location to see in-person meetings near you.",
  },
```

- [ ] **Step 4: Mirror all four edits into the other eight locales**

Apply Steps 1–3 verbatim to `es.ts`, `ar.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts` — same key names, same English values.

- [ ] **Step 5: Type check**

Run: `npm run compile`
Expected: no output. A `Property 'permissionsSection' is missing in type ...` error means a locale was skipped — fix it rather than casting.

- [ ] **Step 6: Commit**

```bash
git add app/i18n
git commit -m "🌐 i18n: keys for the Settings Permissions section"
```

---

## Task 4: Settings → Permissions section

**Files:**
- Create: `app/components/PermissionsSection.tsx`
- Test: `app/components/PermissionsSection.test.tsx`
- Modify: `app/screens/SettingsScreen.tsx` — handler near `:289-309`, section render near `:1015-1039`

**Interfaces:**
- Consumes: `profileStore.locationEnabled` / `setLocationEnabled` (Task 2); `decideLocationGate`, `toOsStatus`, `LocationGateAction` (Task 1); the i18n keys from Task 3.
- Produces: nothing later tasks import.

`isPremium` and `showPaywall` are already destructured from `useSubscription()` at `:209-216` — do not add a second `useSubscription()` call.

- [ ] **Step 1: Write the failing component test**

Create `app/components/PermissionsSection.test.tsx`:

```tsx
/**
 * Guards the two non-obvious rules in the Permissions section:
 *  - the non-premium Push row must NOT be a disabled (greyed) Switch — that
 *    presentation was rejected deliberately, because a live-looking control
 *    draws more taps into the subscription funnel.
 *  - tapping it must open the paywall and must NOT change the stored value.
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { PermissionsSection } from "./PermissionsSection"

describe("PermissionsSection", () => {
  const baseProps = {
    notificationsEnabled: false,
    locationEnabled: false,
    onNotificationsToggle: jest.fn(),
    onLocationToggle: jest.fn(),
    onNotificationsPaywall: jest.fn(),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("routes a non-premium push tap to the paywall, not the toggle", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    fireEvent.press(screen.getByTestId("permissions-push-row"))

    expect(baseProps.onNotificationsPaywall).toHaveBeenCalledTimes(1)
    expect(baseProps.onNotificationsToggle).not.toHaveBeenCalled()
  })

  it("leaves the non-premium push switch enabled, not greyed", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    expect(screen.getByTestId("permissions-push-switch").props.disabled).toBeFalsy()
  })

  it("toggles normally for a premium user", () => {
    render(<PermissionsSection {...baseProps} isPremium />)

    fireEvent(screen.getByTestId("permissions-push-switch"), "valueChange", true)

    expect(baseProps.onNotificationsToggle).toHaveBeenCalledWith(true)
    expect(baseProps.onNotificationsPaywall).not.toHaveBeenCalled()
  })

  it("toggles location regardless of entitlement", () => {
    render(<PermissionsSection {...baseProps} isPremium={false} />)

    fireEvent(screen.getByTestId("permissions-location-switch"), "valueChange", true)

    expect(baseProps.onLocationToggle).toHaveBeenCalledWith(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:component -- app/components/PermissionsSection.test.tsx`
Expected: FAIL — cannot resolve `./PermissionsSection`.

- [ ] **Step 3: Write the component**

Create `app/components/PermissionsSection.tsx`. It is purely presentational — every store read and every side effect stays in `SettingsScreen` and arrives as a prop, which is what keeps the test free of providers.

The `$section` / `$sectionHeader` / `$sectionTitle` / `$settingsRow` / `$rowLabel` / `$rowHint` / `$lastRow` themed styles are module-scope in `SettingsScreen.tsx` and are **copied** into this file rather than exported. That follows the precedent already documented in `DaySelectorModal.tsx` / `RadiusSelectorModal.tsx`, where identical modal chrome is deliberately kept as its own copy. Copy the definitions verbatim from `SettingsScreen.tsx`.

```tsx
import { FC } from "react"
import { Pressable, Switch, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"

import { Text } from "@/components"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import { $styles } from "@/theme"

interface PermissionsSectionProps {
  isPremium: boolean
  notificationsEnabled: boolean
  locationEnabled: boolean
  onNotificationsToggle: (value: boolean) => void
  onLocationToggle: (value: boolean) => void
  onNotificationsPaywall: () => void
}

/**
 * Settings → Permissions. Presentational only: no store reads, no side
 * effects, everything arrives as a prop. That is what lets its jest test mount
 * it without navigation, RevenueCat or the MST tree.
 *
 * The non-premium push row is deliberately NOT a disabled Switch. A greyed
 * control reads as broken and gets ignored; a live-looking one gets tapped,
 * and every tap is an entry into the subscription funnel. The Switch is
 * rendered `pointerEvents="none"` inside a Pressable so the whole row is a
 * single tap target and the thumb never animates to a value that immediately
 * snaps back to the store's.
 */
export const PermissionsSection: FC<PermissionsSectionProps> = ({
  isPremium,
  notificationsEnabled,
  locationEnabled,
  onNotificationsToggle,
  onLocationToggle,
  onNotificationsPaywall,
}) => {
  const { themed, theme } = useAppTheme()

  const pushSwitch = (
    <Switch
      testID="permissions-push-switch"
      value={notificationsEnabled}
      onValueChange={isPremium ? onNotificationsToggle : undefined}
      trackColor={{ false: "#E5E5E5", true: theme.colors.tint }}
      thumbColor="#FFFFFF"
      accessibilityLabel={translate("settingsScreen:enableNotifications")}
    />
  )

  return (
    <View style={themed($section)}>
      <View style={themed($sectionHeader)}>
        <Ionicons name="lock-closed-outline" size={20} color={themed($dimColor).color} />
        <Text style={themed($sectionTitle)} tx="settingsScreen:permissionsSection" />
      </View>

      <Pressable
        testID="permissions-push-row"
        style={themed($settingsRow)}
        onPress={isPremium ? undefined : onNotificationsPaywall}
        accessibilityRole={isPremium ? undefined : "button"}
      >
        <View style={$styles.flex1}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableNotifications" />
          <Text style={themed($rowHint)} tx="settingsScreen:notificationsHint" />
        </View>
        {isPremium ? pushSwitch : <View pointerEvents="none">{pushSwitch}</View>}
      </Pressable>

      <View style={[themed($settingsRow), themed($lastRow)]}>
        <View style={$styles.flex1}>
          <Text style={themed($rowLabel)} tx="settingsScreen:enableLocation" />
          <Text style={themed($rowHint)} tx="settingsScreen:locationHint" />
        </View>
        <Switch
          testID="permissions-location-switch"
          value={locationEnabled}
          onValueChange={onLocationToggle}
          trackColor={{ false: "#E5E5E5", true: theme.colors.tint }}
          thumbColor="#FFFFFF"
          accessibilityLabel={translate("settingsScreen:enableLocation")}
        />
      </View>
    </View>
  )
}
```

Then copy the seven themed style constants named above from `SettingsScreen.tsx` to the bottom of this file, unchanged.

- [ ] **Step 4: Add the location toggle handler**

Immediately after `handleNotificationsToggle` in `SettingsScreen`:

```tsx
  /**
   * Escalate only as far as the OS actually requires. Turning the toggle on
   * when permission is already granted must NOT re-prompt or deep-link —
   * there is nothing to ask, and sending the user to device settings would
   * land them on a screen with nothing to change.
   *
   * Same request-then-revert shape as handleNotificationsToggle above: if the
   * OS refuses, the switch goes back to off rather than lying.
   */
  const handleLocationToggle = useCallback(
    async (value: boolean) => {
      trackEvent("location_toggle", { enabled: value })

      if (!value) {
        profileStore.setLocationEnabled(false)
        return
      }

      const current = await Location.getForegroundPermissionsAsync()
      const action = decideLocationGate({
        locationEnabled: false,
        osStatus: toOsStatus(current),
      })

      if (action === "confirm-in-app") {
        // OS already granted — the boolean is the only thing standing in the
        // way, and the user just asked for it by flipping the switch.
        profileStore.setLocationEnabled(true)
        return
      }

      if (action === "open-settings") {
        Alert.alert(
          translate("location:gateDeniedTitle"),
          translate("location:gateDeniedMessage"),
          [
            { text: translate("common:cancel"), style: "cancel" },
            {
              text: translate("location:openSettings"),
              onPress: () => {
                Linking.openSettings().catch(() => {})
              },
            },
          ],
        )
        return
      }

      // action === "prompt-os"
      const granted = await Location.requestForegroundPermissionsAsync()
      profileStore.setLocationEnabled(granted.granted)
    },
    [profileStore],
  )

  const handleNotificationsPaywall = useCallback(() => {
    trackEvent("notifications_paywall_tapped")
    void showPaywall()
  }, [showPaywall])
```

Add these imports at the top of the file, in the correct import-order group (Expo packages before external packages, `@/` before relative):

```tsx
import * as Location from "expo-location"

import { PermissionsSection } from "@/components/PermissionsSection"
import { decideLocationGate, toOsStatus } from "@/utils/locationGateLogic"
```

`Alert` and `Linking` come from `react-native` — add them to that import if absent.

- [ ] **Step 5: Replace the old Notifications section in the render tree**

Delete the whole `{/* Notifications Section */}` block (the `<View style={themed($section)} onLayout={trackSection("notifications")}>` … `</View>`) and put in its place:

```tsx
      {/* Permissions Section */}
      <View onLayout={trackSection("permissions")}>
        <PermissionsSection
          isPremium={isPremium}
          notificationsEnabled={profileStore.notificationsEnabled}
          locationEnabled={profileStore.locationEnabled}
          onNotificationsToggle={handleNotificationsToggle}
          onLocationToggle={handleLocationToggle}
          onNotificationsPaywall={handleNotificationsPaywall}
        />
      </View>
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:component -- app/components/PermissionsSection.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 7: Type check and lint**

Run: `npm run compile && npx eslint app/screens/SettingsScreen.tsx app/components/PermissionsSection.tsx`
Expected: no output from either.

- [ ] **Step 8: Commit**

```bash
git add app/screens/SettingsScreen.tsx app/components/PermissionsSection.tsx app/components/PermissionsSection.test.tsx
git commit -m "✨ feat(settings): Permissions section with location and gated push"
```

---

## Task 5: `useLocationGate` hook

**Files:**
- Create: `app/hooks/useLocationGate.ts`

**Interfaces:**
- Consumes: `decideLocationGate`, `toOsStatus` (Task 1); `profileStore.locationEnabled` / `setLocationEnabled` (Task 2); the `location:*` i18n keys (Task 3).
- Produces: `useLocationGate(): { runGate: () => Promise<boolean> }` — resolves `true` when location ended up enabled, `false` otherwise. Task 7 calls it.

No unit test: this file imports `@/`, so vitest cannot load it, and it is pure I/O orchestration over the already-tested `decideLocationGate`. This matches how `usePresenceCheck` is left uncovered beside a tested `presenceLogic`.

- [ ] **Step 1: Write the hook**

Create `app/hooks/useLocationGate.ts`:

```ts
/**
 * useLocationGate — the I/O half of the In-Person location gate.
 *
 * Every decision lives in the pure, vitest-covered
 * app/utils/locationGateLogic.ts. This file only reads the OS permission
 * state, runs that decision, and performs whichever of prompt / confirm /
 * deep-link it returns. Do not re-derive the branching here.
 *
 * Spec: docs/superpowers/specs/2026-08-08-settings-permissions-section-design.md
 */

import { useCallback } from "react"
import { Alert, Linking } from "react-native"
import * as Location from "expo-location"

import { translate } from "@/i18n"
import { useProfileStore } from "@/models"
import { decideLocationGate, toOsStatus } from "@/utils/locationGateLogic"

export interface UseLocationGateResult {
  /**
   * Run the gate once. Resolves true if location is enabled by the time it
   * settles, false otherwise. Safe to call repeatedly — it re-reads the OS
   * state every time, which is what makes a user returning from device
   * settings pick up their new grant without a restart.
   */
  runGate: () => Promise<boolean>
}

export function useLocationGate(): UseLocationGateResult {
  const profileStore = useProfileStore()

  const runGate = useCallback(async (): Promise<boolean> => {
    // getForegroundPermissionsAsync does NOT prompt — it only reads. The
    // prompting call is requestForegroundPermissionsAsync below, reached only
    // on the "prompt-os" branch. Getting these two backwards would show the
    // system dialog on every segment visit.
    const current = await Location.getForegroundPermissionsAsync()
    const action = decideLocationGate({
      locationEnabled: profileStore.locationEnabled,
      osStatus: toOsStatus(current),
    })

    switch (action) {
      case "proceed":
        return true

      case "prompt-os": {
        const granted = await Location.requestForegroundPermissionsAsync()
        profileStore.setLocationEnabled(granted.granted)
        return granted.granted
      }

      case "confirm-in-app":
        // The OS has already said yes; only our own toggle is off. An Alert is
        // the only thing that can change anything here — a deep-link would
        // land the user on a settings screen with location already enabled.
        return new Promise<boolean>((resolve) => {
          Alert.alert(
            translate("location:gateConfirmTitle"),
            translate("location:gateConfirmMessage"),
            [
              {
                text: translate("common:cancel"),
                style: "cancel",
                onPress: () => resolve(false),
              },
              {
                text: translate("location:gateConfirmAccept"),
                onPress: () => {
                  profileStore.setLocationEnabled(true)
                  resolve(true)
                },
              },
            ],
            // Dismissing by tapping outside (Android) must still settle the
            // promise, or the caller's await never returns.
            { onDismiss: () => resolve(false) },
          )
        })

      case "open-settings":
        Alert.alert(
          translate("location:gateDeniedTitle"),
          translate("location:gateDeniedMessage"),
          [
            { text: translate("common:cancel"), style: "cancel" },
            {
              text: translate("location:openSettings"),
              onPress: () => {
                Linking.openSettings().catch(() => {})
              },
            },
          ],
        )
        return false
    }
  }, [profileStore])

  return { runGate }
}
```

- [ ] **Step 2: Type check and lint**

Run: `npm run compile && npx eslint app/hooks/useLocationGate.ts`
Expected: no output from either.

- [ ] **Step 3: Dependency check**

Run: `npm run lint:deps`
Expected: no violation naming `useLocationGate` or `locationGateLogic`. (The run reports pre-existing `@expo/vector-icons` violations — ignore those.)

- [ ] **Step 4: Commit**

```bash
git add app/hooks/useLocationGate.ts
git commit -m "✨ feat(location): useLocationGate orchestrator for the In-Person gate"
```

---

## Task 6: `useNearbySchedules` short-circuit

**Files:**
- Modify: `app/hooks/useNearbySchedules.ts` — the `Location.requestForegroundPermissionsAsync()` call site near `:326`

**Interfaces:**
- Consumes: `profileStore.locationEnabled` (Task 2).
- Produces: no new exports. Behaviour change only.

The hook already reads `profileStore` during render (that's why `InPersonContent` must stay `observer()`), so adding another store read is safe and reactive.

- [ ] **Step 1: Short-circuit before requesting**

In the `acquireLocation` function, immediately before `const perm = await Location.requestForegroundPermissionsAsync()`, insert:

```ts
      // ADDED 2026-08-08: the Settings → Permissions toggle is the outer gate.
      // When it is off the app must not so much as ASK the OS — the In-Person
      // segment's own gate (useLocationGate) owns every prompt now, and a
      // second request from here would double-prompt on first launch.
      //
      // Mirrors the denial path below exactly: coordinates are dropped, and
      // the stale nearby-failure is cleared so it can't steal the banner from
      // the real reason.
      if (!profileStore.locationEnabled) {
        setPermission("denied")
        coordsRef.current = null
        setNearbyFetchFailed(false)
        return false
      }
```

If `profileStore` is not already in scope in this function, add `const profileStore = useProfileStore()` at the top of the hook body alongside the existing store reads, and include it in `acquireLocation`'s `useCallback` dependency array.

- [ ] **Step 2: Type check and lint**

Run: `npm run compile && npx eslint app/hooks/useNearbySchedules.ts`
Expected: no output from either. An exhaustive-deps warning means `profileStore` is missing from the dependency array — add it rather than disabling the rule.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: vitest 22 files pass (21 existing + `locationGateLogic`), jest 6 suites pass (5 existing + the Permissions test).

- [ ] **Step 4: Commit**

```bash
git add app/hooks/useNearbySchedules.ts
git commit -m "✨ feat(location): gate nearby browse on the locationEnabled toggle"
```

---

## Task 7: In-Person segment gate and empty state

**Files:**
- Modify: `app/screens/InPersonScreen.tsx` — `InPersonContent` body, the `mapToggleDisabled` / `showMapToggle` area near `:1173`, and the render branch near `:1181`

**Interfaces:**
- Consumes: `useLocationGate().runGate` (Task 5); `profileStore.locationEnabled` (Task 2); `location:emptyNeedsLocation` (Task 3).
- Produces: nothing later tasks import.

- [ ] **Step 1: Run the gate whenever the segment becomes visible**

Add to `InPersonContent`, after the existing hook calls:

```tsx
  const profileStore = useProfileStore()
  const { runGate } = useLocationGate()

  /**
   * The location gate. Keyed on `visible` — the segment being on screen —
   * NOT on the `active` latch, which fires once per mount and would give a
   * once-ever prompt instead of the every-visit one the spec requires.
   *
   * Re-running on every visit is deliberate: it is also how a user who
   * granted permission in device settings gets picked up, since returning to
   * the app re-shows this segment and the gate re-reads the OS state.
   */
  useEffect(() => {
    if (!visible) return
    if (profileStore.locationEnabled) return
    void runGate()
  }, [visible, profileStore.locationEnabled, runGate])
```

Add `useLocationGate` and `useProfileStore` to the imports.

- [ ] **Step 2: Suppress the map toggle while location is off**

Replace the `mapToggleDisabled` line with:

```tsx
  const mapToggleDisabled = effectiveViewMode === "list" && networkStore.isOffline

  // ADDED 2026-08-08: with location off there are no meetings to plot and no
  // idea where the user is, so a map has nothing to show. This is a separate
  // condition from `shouldShowMapToggle`'s style-URL kill switch — that one
  // answers "is a map configured", this one answers "is there anything to
  // put on it".
  const showMapToggleNow = showMapToggle && profileStore.locationEnabled
```

Then pass `showMapToggle={showMapToggleNow}` to **both** `InPersonListHeader` instances (the map branch and the list branch) in place of `showMapToggle={showMapToggle}`.

- [ ] **Step 3: Render the needs-location empty state**

The list branch's `ListEmptyComponent` already handles several reasons in priority order. Add a new highest-priority branch at the very top of the `ListEmptyComponent` `useCallback` body, before the `if (!fellowship)` check:

```tsx
    // Highest priority: without location there is no list at all, so no other
    // empty-state copy can be true. Tappable, so the user has a route back in
    // without hunting through Settings.
    if (!profileStore.locationEnabled) {
      return (
        <Pressable
          style={themed($emptyContainer)}
          onPress={() => {
            void runGate()
          }}
          accessibilityRole="button"
        >
          <Text style={themed($emptyText)} tx="location:emptyNeedsLocation" />
        </Pressable>
      )
    }
```

Add `profileStore.locationEnabled` and `runGate` to that `useCallback`'s dependency array.

- [ ] **Step 4: Force list mode while location is off**

In the `effectiveViewMode` computation, add `&& profileStore.locationEnabled` to the map condition, so a user with a persisted `viewMode` of `"map"` doesn't land on a blank GL surface:

```tsx
  const effectiveViewMode: InPersonViewMode =
    viewMode === "map" &&
    showMapToggle &&
    active &&
    visible &&
    !mapFailedThisSession &&
    profileStore.locationEnabled
      ? "map"
      : "list"
```

- [ ] **Step 5: Type check and lint**

Run: `npm run compile && npx eslint app/screens/InPersonScreen.tsx`
Expected: no output from either.

- [ ] **Step 6: Commit**

```bash
git add app/screens/InPersonScreen.tsx
git commit -m "✨ feat(inperson): gate the segment on location, empty state when off"
```

---

## Task 8: "I'm Here" self-heal and changelog

**Files:**
- Modify: `app/components/InPersonPopup.tsx` — `handleImHere` near `:401`
- Modify: `CHANGELOG.md` — `## [Unreleased]`

**Interfaces:**
- Consumes: `profileStore.locationEnabled` / `setLocationEnabled` (Task 2).
- Produces: nothing.

- [ ] **Step 1: Add the self-heal**

At the top of `handleImHere`, immediately after the `if (!meeting || isChecking) return` guard:

```tsx
    // Self-heal, deliberately silent. The only way to reach this with the
    // toggle off is to turn it off in Settings without leaving the In-Person
    // tab — the segment gate catches every other route. Tapping "I'm Here" is
    // an explicit request for GPS-verified attendance and the button does
    // nothing else, so the tap IS the consent; a confirm dialog here would be
    // asking the user to repeat themselves.
    if (!profileStore.locationEnabled) {
      profileStore.setLocationEnabled(true)
    }
```

If `profileStore` is not in scope, add `const profileStore = useProfileStore()` to the component body and include it in `handleImHere`'s dependency array.

- [ ] **Step 2: Add the changelog entries**

Under `## [Unreleased]` → `### Added`:

```markdown
- **Settings now has a Permissions section** with a Location switch. Recovery
  Sky asks before using your location and you can turn it off again at any
  time — previously the only way to stop the app using your position was your
  device's own settings, with nothing in the app to tell you it was on.
```

Under `## [Unreleased]` → `### Changed`:

```markdown
- **The In-Person tab now asks for location up front** instead of quietly
  falling back to a plain day list when it can't get a fix. Until location is
  on, the tab explains what it needs and offers to turn it on rather than
  showing a list that silently lacks distances and nearest-first ordering.

- **Push notifications now require a subscription.** They exist to deliver
  meeting reminders, which have always been a premium feature, so the two now
  match. Existing notification settings are unchanged.
```

- [ ] **Step 3: Type check, lint, and full test suite**

Run: `npm run compile && npx eslint app/components/InPersonPopup.tsx && npm test`
Expected: `tsc` and eslint silent; vitest 22 files pass; jest 6 suites pass.

- [ ] **Step 4: Commit**

```bash
git add app/components/InPersonPopup.tsx CHANGELOG.md
git commit -m "✨ feat(inperson): self-heal location on I'm Here, changelog"
```

---

## Manual verification (device only)

None of the below is reachable by `npm test` — they need real OS permission states, and the In-Person map cannot be exercised on the iOS Simulator at all (see `docs/superpowers/plans/2026-08-07-in-person-map-view-manual-qa.md`).

- [ ] Fresh install → In-Person → **system** location dialog appears. Grant → meetings list with distances; the Settings toggle now reads on.
- [ ] Fresh install → In-Person → deny the system dialog → segment shows the needs-location copy and **no meetings**; the map toggle is gone.
- [ ] Settings → Permissions → Location off → In-Person → **in-app** confirm (not the system dialog, not device settings). Accept → list returns.
- [ ] Same, but Cancel → needs-location copy; tapping it re-runs the gate.
- [ ] Deny permanently (iOS: deny, then relaunch; Android: "don't ask again") → In-Person → the alert offers device Settings, on **every** visit.
- [ ] Enable in device Settings → return to app → In-Person → in-app confirm → accept → list returns without a restart.
- [ ] Settings → Location on while OS already granted → the switch flips with **no** dialog of any kind.
- [ ] Non-premium: Permissions → Push row is **not greyed**; tapping anywhere on it opens the paywall and the switch does not move.
- [ ] Premium: Push row toggles normally; turning it on with notifications never granted shows the system notification dialog and reverts the switch if denied.
- [ ] "I'm Here" with Location toggled off mid-session → proceeds with no dialog, and Settings shows the toggle back on.
