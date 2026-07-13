# Announcement Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time, blocking modal that announces new features (first use: subscriber Cloud Backup & multi-device attendance sync), shown once per user and delivered over-the-air.

**Architecture:** Announcement content is a typed constant array baked into the JS bundle (`app/config/announcements.ts`). A `@/`-free pure function (`app/utils/announcementLogic.ts`) decides which announcement — if any — may show right now. `ProfileStore` persists a `seenAnnouncementIds` set (MMKV) for show-once, seeded to "caught up" when onboarding completes so fresh installs get no backlog. A headless `observer()` gate component (`app/components/AnnouncementGate.tsx`), mounted beside the app's other overlays in `app.tsx`, re-evaluates on every foreground and renders the modal.

**Tech Stack:** React Native `Modal`, MobX-State-Tree, MMKV (auto-persist via `onSnapshot`), `AppState`, `navigationRef`, `SubscriptionContext` (`hasAttendance`), i18n (`tx`/`TxKeyPath`), vitest.

## Global Constraints

- **JS-only. Do NOT bump `runtimeVersion` in `app.json`** (stays `4.5.0`). Ships via `npm run update` (OTA).
- **No hardcoded UI strings.** All copy is referenced by `TxKeyPath` and defined in the i18n files. English (`en.ts`) is the source of truth for `TxKeyPath`; other locales get the same keys (English text is an acceptable fallback until translated).
- **Pure logic stays `@/`-free at runtime.** `announcementLogic.ts` and `announcements.ts` may use `import type` from `@/…` (erased by esbuild) but **no runtime `@/` imports and no value imports of native modules** (e.g. `@expo/vector-icons`), so vitest can import them. This is the repo's vitest-no-path-alias rule.
- **Identify announcements by stable string slug**, never a sequential integer. Order comes from array position, not the id.
- **Never cover a critical surface.** The popup must not render over the maintenance/outage screen, during login or onboarding, or over an active external-zoom timer.
- **`seenAnnouncementIds` is device-scoped: do NOT clear it on logout/reset.**

---

## File Structure

| File | Responsibility |
|------|----------------|
| `app/config/announcements.ts` (new) | `Announcement`/`AnnouncementCta` types + the `ANNOUNCEMENTS` data array. Pure (type-only imports). |
| `app/config/announcements.test.ts` (new) | vitest guard: ids unique & non-empty. |
| `app/utils/announcementLogic.ts` (new) | Pure `selectPendingAnnouncement()` + `shouldShowCta()`. |
| `app/utils/announcementLogic.test.ts` (new) | vitest coverage of the selection/gating logic. |
| `app/models/ProfileStore.ts` (modify) | `seenAnnouncementIds` prop; `markAnnouncementSeen`, `seedAnnouncementBaseline` actions; seed call inside `completeOnboarding`. |
| `app/navigators/navigationTypes.ts` (modify) | Add `"cloudBackup"` to `SettingsSection` union. |
| `app/components/AnnouncementGate.tsx` (new) | The observer gate + blocking Modal. |
| `app/app.tsx` (modify) | Mount `<AnnouncementGate />`. |
| `app/i18n/en.ts` + other locale files (modify) | `announcements` namespace. |

Testing reality (be honest, matches the repo): **Tasks 1–2 are true vitest TDD** — the pure modules are the only cleanly unit-testable pieces. **Tasks 3–4 are compile + lint + manual device verification**, because `ProfileStore` and the gate import `@/` runtime code that vitest cannot resolve and jest here has only a single component-test precedent. This mirrors how the sync feature itself is verified (`app/services/sync/index.ts` has zero automated coverage by design).

---

## Task 1: Announcement content constant + i18n

**Files:**
- Modify: `app/i18n/en.ts` (add `announcements` namespace)
- Modify: `app/i18n/es.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `uk.ts`, `ar.ts`, `th.ts` (same keys)
- Create: `app/config/announcements.ts`
- Test: `app/config/announcements.test.ts`

**Interfaces:**
- Produces:
  - `interface AnnouncementCta { labelTx: TxKeyPath; requiresAttendance: boolean; target: "cloudBackupSettings" }`
  - `interface Announcement { id: string; titleTx: TxKeyPath; bodyTx: TxKeyPath; icon?: string; cta?: AnnouncementCta }`
  - `export const ANNOUNCEMENTS: readonly Announcement[]`

- [ ] **Step 1: Add the i18n namespace to `en.ts`**

Open `app/i18n/en.ts`. Add a top-level `announcements` key to the exported translations object (place it alphabetically or at the end of the object, matching the file's existing style):

```ts
  announcements: {
    cloudBackupTitle: "Cloud Backup & Multi-Device Sync",
    cloudBackupBody:
      "Your attendance records can now back up securely to the cloud and sync across all your devices. Turn it on anytime in Settings under Cloud Backup.",
    cloudBackupCta: "Open Cloud Backup",
    dismiss: "Got it",
  },
```

- [ ] **Step 2: Mirror the namespace into the other locale files**

Add the identical `announcements: { … }` block (same keys) to each of `app/i18n/es.ts`, `de.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `uk.ts`, `ar.ts`, `th.ts`. Translate the strings where you can; English text is acceptable as a fallback. The keys must match exactly — missing keys in a non-`en` file are fine at runtime (i18next falls back to `en`), but keeping them present avoids console warnings.

- [ ] **Step 3: Write the failing test**

Create `app/config/announcements.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { ANNOUNCEMENTS } from "./announcements"

describe("ANNOUNCEMENTS", () => {
  it("has at least one announcement", () => {
    expect(ANNOUNCEMENTS.length).toBeGreaterThan(0)
  })

  it("has non-empty ids", () => {
    for (const a of ANNOUNCEMENTS) {
      expect(a.id.trim().length).toBeGreaterThan(0)
    }
  })

  it("has unique ids", () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run app/config/announcements.test.ts`
Expected: FAIL — cannot resolve `./announcements` (module not created yet).

- [ ] **Step 5: Create the content constant**

Create `app/config/announcements.ts`:

```ts
/**
 * Announcement registry — content for the one-time announcement popup.
 *
 * To publish an announcement: append an entry here, add its strings to the
 * i18n files (see `announcements` namespace), and ship an OTA (`npm run
 * update`). This is a JS-only change — do NOT bump `runtimeVersion`.
 *
 * Ordering is by array position (oldest first). The gate shows the FIRST
 * unseen entry, so append new announcements at the END.
 *
 * Purity: this module is imported by vitest via `announcementLogic`, so it
 * must stay free of runtime `@/` imports and native-module value imports.
 * `TxKeyPath` is a type-only import (erased at build). `icon` is a plain
 * string (a valid Ionicons glyph name) rather than a typed union, precisely
 * to avoid a value import of `@expo/vector-icons` that would break vitest.
 */
import type { TxKeyPath } from "@/i18n"

export interface AnnouncementCta {
  /** Button label (i18n key). */
  labelTx: TxKeyPath
  /**
   * When true, the CTA button renders ONLY for users with the
   * recoverysky-attendance entitlement (hasAttendance). Non-entitled users
   * still see the announcement — just without this button.
   */
  requiresAttendance: boolean
  /**
   * Named destination, resolved to a concrete navigation call by the gate.
   * Keeping it a string keeps this file free of navigation imports.
   */
  target: "cloudBackupSettings"
}

export interface Announcement {
  /** Stable, unique, human-readable slug. Never reused. Never compared. */
  id: string
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Ionicons glyph name for the header icon. Defaults to "megaphone-outline". */
  icon?: string
  cta?: AnnouncementCta
}

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "cloud-backup-sync-2026-07",
    titleTx: "announcements:cloudBackupTitle",
    bodyTx: "announcements:cloudBackupBody",
    icon: "cloud-outline",
    cta: {
      labelTx: "announcements:cloudBackupCta",
      requiresAttendance: true,
      target: "cloudBackupSettings",
    },
  },
] as const
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run app/config/announcements.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Type-check**

Run: `npm run compile`
Expected: no errors. (Confirms `"announcements:cloudBackupTitle"` etc. are valid `TxKeyPath` values — i.e. Step 1 wired the namespace correctly.)

- [ ] **Step 8: Commit**

```bash
git add app/config/announcements.ts app/config/announcements.test.ts app/i18n/
git commit -m "✨ feat(announcements): content registry + i18n namespace"
```

---

## Task 2: Pure selection logic

**Files:**
- Create: `app/utils/announcementLogic.ts`
- Test: `app/utils/announcementLogic.test.ts`

**Interfaces:**
- Consumes: `Announcement` type from `@/config/announcements` (type-only import).
- Produces:
  - `interface AnnouncementGateState { announcements: readonly Announcement[]; seenIds: readonly string[]; isAuthenticated: boolean; onboardingCompleted: boolean; outageMode: boolean; timerSessionActive: boolean }`
  - `function selectPendingAnnouncement(state: AnnouncementGateState): Announcement | null`
  - `function shouldShowCta(announcement: Announcement, hasAttendance: boolean): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/utils/announcementLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import type { Announcement } from "@/config/announcements"

import { selectPendingAnnouncement, shouldShowCta } from "./announcementLogic"

const A: Announcement = { id: "a", titleTx: "x" as never, bodyTx: "y" as never }
const B: Announcement = { id: "b", titleTx: "x" as never, bodyTx: "y" as never }
const withCta = (requiresAttendance: boolean): Announcement => ({
  id: "c",
  titleTx: "x" as never,
  bodyTx: "y" as never,
  cta: { labelTx: "l" as never, requiresAttendance, target: "cloudBackupSettings" },
})

const base = {
  announcements: [A, B] as const,
  seenIds: [] as string[],
  isAuthenticated: true,
  onboardingCompleted: true,
  outageMode: false,
  timerSessionActive: false,
}

describe("selectPendingAnnouncement", () => {
  it("returns the first unseen announcement when all gates pass", () => {
    expect(selectPendingAnnouncement(base)?.id).toBe("a")
  })

  it("skips seen ids and returns the next unseen in array order", () => {
    expect(selectPendingAnnouncement({ ...base, seenIds: ["a"] })?.id).toBe("b")
  })

  it("returns null when all are seen", () => {
    expect(selectPendingAnnouncement({ ...base, seenIds: ["a", "b"] })).toBeNull()
  })

  it("returns null when unauthenticated", () => {
    expect(selectPendingAnnouncement({ ...base, isAuthenticated: false })).toBeNull()
  })

  it("returns null when onboarding incomplete", () => {
    expect(selectPendingAnnouncement({ ...base, onboardingCompleted: false })).toBeNull()
  })

  it("returns null during outage", () => {
    expect(selectPendingAnnouncement({ ...base, outageMode: true })).toBeNull()
  })

  it("returns null while a timer session is active", () => {
    expect(selectPendingAnnouncement({ ...base, timerSessionActive: true })).toBeNull()
  })
})

describe("shouldShowCta", () => {
  it("is false when the announcement has no cta", () => {
    expect(shouldShowCta(A, true)).toBe(false)
  })

  it("is false when cta requires attendance and the user lacks it", () => {
    expect(shouldShowCta(withCta(true), false)).toBe(false)
  })

  it("is true when cta requires attendance and the user has it", () => {
    expect(shouldShowCta(withCta(true), true)).toBe(true)
  })

  it("is true when cta does not require attendance, regardless of entitlement", () => {
    expect(shouldShowCta(withCta(false), false)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/utils/announcementLogic.test.ts`
Expected: FAIL — cannot resolve `./announcementLogic`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/announcementLogic.ts`:

```ts
/**
 * Pure decision logic for the announcement popup. No runtime `@/` imports and
 * no native-module imports, so vitest can exercise it directly (see the repo's
 * vitest-no-path-alias rule). The `AnnouncementGate` component supplies the
 * live state; this module holds all the branching.
 */
import type { Announcement } from "@/config/announcements"

export interface AnnouncementGateState {
  announcements: readonly Announcement[]
  seenIds: readonly string[]
  /** Display gates — ALL must hold for anything to show. */
  isAuthenticated: boolean
  onboardingCompleted: boolean
  outageMode: boolean
  timerSessionActive: boolean
}

/**
 * The first unseen announcement that may be shown right now, or null if a gate
 * blocks display or nothing is pending. Order is by array position.
 */
export function selectPendingAnnouncement(
  state: AnnouncementGateState,
): Announcement | null {
  if (!state.isAuthenticated) return null
  if (!state.onboardingCompleted) return null
  if (state.outageMode) return null
  if (state.timerSessionActive) return null
  return state.announcements.find((a) => !state.seenIds.includes(a.id)) ?? null
}

/** Whether the CTA button should render for this viewer. */
export function shouldShowCta(
  announcement: Announcement,
  hasAttendance: boolean,
): boolean {
  if (!announcement.cta) return false
  if (announcement.cta.requiresAttendance && !hasAttendance) return false
  return true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/utils/announcementLogic.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add app/utils/announcementLogic.ts app/utils/announcementLogic.test.ts
git commit -m "✨ feat(announcements): pure selection + cta gating logic"
```

---

## Task 3: ProfileStore persistence + baseline seed

**Files:**
- Modify: `app/models/ProfileStore.ts` (props block near line 78; actions near lines 345, 367)

**Interfaces:**
- Consumes: `ANNOUNCEMENTS` from `@/config/announcements`.
- Produces (on the ProfileStore instance):
  - prop `seenAnnouncementIds: string[]`
  - action `markAnnouncementSeen(id: string): void`
  - action `seedAnnouncementBaseline(ids: string[]): void`
  - `completeOnboarding()` now also seeds the baseline.

- [ ] **Step 1: Add the import**

At the top of `app/models/ProfileStore.ts`, with the other `@/` imports, add:

```ts
import { ANNOUNCEMENTS } from "@/config/announcements"
```

- [ ] **Step 2: Add the persisted prop**

In the `types.model({ … })` props block, next to `dismissedHomeCards` (around line 78), add:

```ts
    // Ids of announcements the user has already seen (one-time popup).
    // Device-scoped: intentionally NOT cleared on logout/reset — clearing it
    // would re-pop the modal after every re-login.
    seenAnnouncementIds: types.optional(types.array(types.string), []),
```

- [ ] **Step 3: Add the two actions**

In the `.actions()` block, next to `dismissHomeCard` (around line 367), add:

```ts
      /**
       * Mark an announcement as seen so its one-time popup never shows again.
       */
      markAnnouncementSeen(id: string) {
        if (!self.seenAnnouncementIds.includes(id)) {
          self.seenAnnouncementIds.push(id)
        }
      },

      /**
       * Baseline seed for fresh installs — mark every currently-bundled
       * announcement as already seen so a brand-new user never gets a backlog
       * of historical popups. Called once, from completeOnboarding(). Idempotent.
       */
      seedAnnouncementBaseline(ids: string[]) {
        for (const id of ids) {
          if (!self.seenAnnouncementIds.includes(id)) {
            self.seenAnnouncementIds.push(id)
          }
        }
      },
```

- [ ] **Step 4: Seed the baseline on onboarding completion**

Update `completeOnboarding()` (around line 345). It currently reads:

```ts
      completeOnboarding() {
        self.onboardingCompleted = true
      },
```

Change it to:

```ts
      completeOnboarding() {
        self.onboardingCompleted = true
        // Fresh install caught-up baseline: a user finishing onboarding never
        // wants "NEW feature!" popups for features that shipped WITH their
        // install. Existing users (already onboarded in a prior build) never
        // hit this path, so their empty seen-set lets the current announcement
        // show. `self.<action>` is valid here — all actions are bound to self.
        self.seedAnnouncementBaseline(ANNOUNCEMENTS.map((a) => a.id))
      },
```

- [ ] **Step 5: Confirm the reset paths do NOT clear the new prop**

Verify (do not change) that the `.clear()` calls around lines 377 and 471 clear `dismissedHomeCards` only. `seenAnnouncementIds` must **not** be added to any reset/logout clearing. This is deliberate (device-scoped). Leave it out.

- [ ] **Step 6: Type-check**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 7: Lint the changed file**

Run: `npm run lint:check -- app/models/ProfileStore.ts`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add app/models/ProfileStore.ts
git commit -m "✨ feat(announcements): persist seen ids + seed baseline on onboarding"
```

---

## Task 4: Gate component + mount + Settings section type

**Files:**
- Modify: `app/navigators/navigationTypes.ts:17-26` (add `"cloudBackup"` to `SettingsSection`)
- Create: `app/components/AnnouncementGate.tsx`
- Modify: `app/app.tsx` (import + mount `<AnnouncementGate />`)

**Interfaces:**
- Consumes: `ANNOUNCEMENTS`, `Announcement` (`@/config/announcements`); `selectPendingAnnouncement`, `shouldShowCta` (`@/utils/announcementLogic`); `markAnnouncementSeen`, `seenAnnouncementIds`, `onboardingCompleted` (ProfileStore); `hasAttendance` (`useSubscription`); `isAuthenticated` (`useAuthenticationStore`); `outageMode` (`useConfigStore`); `loadTimerSession` (`@/services/zoom/timerSession`); `navigate` (`@/navigators/navigationUtilities`).

- [ ] **Step 1: Add `"cloudBackup"` to the `SettingsSection` union**

In `app/navigators/navigationTypes.ts`, the `SettingsSection` union (lines 17-26) is missing `"cloudBackup"` even though `SettingsScreen.tsx:1070` registers `trackSection("cloudBackup")`. Add it so the CTA's `navigate("Settings", { section: "cloudBackup" })` typechecks (scrolling already works at runtime):

```ts
export type SettingsSection =
  | "recovery"
  | "profile"
  | "appSettings"
  | "notifications"
  | "attendance"
  | "subscription"
  | "cloudBackup"
  | "account"
  | "import"
  | "legal"
```

- [ ] **Step 2: Create the gate component**

Create `app/components/AnnouncementGate.tsx`. It mirrors `ExternalZoomEducationModal` (backdrop + card + `tx` + `Pressable` buttons):

```tsx
/**
 * AnnouncementGate
 *
 * Shows a one-time, blocking announcement modal. Evaluates on mount and on
 * every app foreground (AppState → "active"); picks the first unseen
 * announcement that passes all display gates (see selectPendingAnnouncement)
 * and renders it. Dismiss or CTA both persist the id via markAnnouncementSeen,
 * so each announcement shows exactly once.
 *
 * Mounted as a sibling to the app's other overlays in app.tsx. It reads only
 * MMKV-backed stores (no SQLite), so it has no DB-ready dependency and is safe
 * to fire on any foreground.
 */
import { FC, useCallback, useEffect, useState } from "react"
import { AppState, Modal, Pressable, StyleSheet, TextStyle, View, ViewStyle } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import { Text } from "@/components/Text"
import { ANNOUNCEMENTS, type Announcement } from "@/config/announcements"
import { useSubscription } from "@/context/SubscriptionContext"
import { useAuthenticationStore, useConfigStore, useProfileStore } from "@/models"
import { navigate } from "@/navigators/navigationUtilities"
import { loadTimerSession } from "@/services/zoom/timerSession"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { selectPendingAnnouncement, shouldShowCta } from "@/utils/announcementLogic"

export const AnnouncementGate: FC = observer(function AnnouncementGate() {
  const profileStore = useProfileStore()
  const authStore = useAuthenticationStore()
  const configStore = useConfigStore()
  const { hasAttendance } = useSubscription()
  const { themed, theme } = useAppTheme()

  const [active, setActive] = useState<Announcement | null>(null)

  const evaluate = useCallback(() => {
    // A modal is already up — don't stack a second one.
    if (active) return
    const pending = selectPendingAnnouncement({
      announcements: ANNOUNCEMENTS,
      seenIds: profileStore.seenAnnouncementIds.slice(),
      isAuthenticated: authStore.isAuthenticated,
      onboardingCompleted: profileStore.onboardingCompleted,
      outageMode: configStore.outageMode,
      // Non-null persisted timer session ⇒ an in-meeting timer is live; never
      // cover it. Re-read on each evaluation so a mid-timer foreground is
      // suppressed but a later clean foreground still shows the popup.
      timerSessionActive: loadTimerSession() !== null,
    })
    if (pending) setActive(pending)
  }, [active, profileStore, authStore, configStore])

  useEffect(() => {
    evaluate()
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") evaluate()
    })
    return () => sub.remove()
  }, [evaluate])

  const dismiss = useCallback(() => {
    if (active) profileStore.markAnnouncementSeen(active.id)
    setActive(null)
  }, [active, profileStore])

  const handleCta = useCallback(() => {
    if (!active?.cta) return
    profileStore.markAnnouncementSeen(active.id)
    if (active.cta.target === "cloudBackupSettings") {
      // `navigate` (not navigationRef.navigate directly): it casts the nested
      // "Settings" tab route past the root-stack param types AND queues the
      // navigation if the container isn't ready yet.
      navigate("Settings", { section: "cloudBackup" })
    }
    setActive(null)
  }, [active, profileStore])

  if (!active) return null

  const showCta = shouldShowCta(active, hasAttendance)

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss} statusBarTranslucent>
      <View style={themed($overlay)}>
        {/* Backdrop is NOT pressable — this is a blocking dialog; the user must
            use a button so we always record the announcement as seen. */}
        <View style={themed($backdrop)} />

        <View style={themed($card)} accessibilityViewIsModal>
          <View style={themed($header)}>
            <Ionicons
              name={(active.icon ?? "megaphone-outline") as keyof typeof Ionicons.glyphMap}
              size={24}
              color={theme.colors.tint}
            />
            <Text style={themed($title)} tx={active.titleTx} />
          </View>

          <Text style={themed($body)} tx={active.bodyTx} />

          {showCta && active.cta && (
            <Pressable
              onPress={handleCta}
              style={themed($ctaButton)}
              accessibilityRole="button"
            >
              <Text style={themed($ctaButtonText)} tx={active.cta.labelTx} />
            </Pressable>
          )}

          <Pressable onPress={dismiss} style={themed($dismissButton)} accessibilityRole="button">
            <Text style={themed($dismissButtonText)} tx="announcements:dismiss" />
          </Pressable>
        </View>
      </View>
    </Modal>
  )
})

const $overlay: ThemedStyle<ViewStyle> = () => ({
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
})

const $backdrop: ThemedStyle<ViewStyle> = () => ({
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0, 0, 0, 0.85)",
})

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  width: "85%",
  maxWidth: 400,
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.lg,
  gap: spacing.md,
})

const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
})

const $title: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 17,
  fontWeight: "700",
  color: colors.text,
})

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 14,
  lineHeight: 20,
  color: colors.text,
})

const $ctaButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.sm,
  backgroundColor: colors.tint,
  borderRadius: 10,
  marginTop: spacing.sm,
})

const $ctaButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  fontSize: 15,
  fontWeight: "700",
})

const $dismissButton: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: spacing.xs,
})

const $dismissButtonText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.textDim,
  fontSize: 15,
  fontWeight: "600",
})
```

- [ ] **Step 3: Mount the gate in `app.tsx`**

In `app/app.tsx`, add the import next to the other component imports (e.g. near the `MaintenanceBanner` import around line 40):

```ts
import { AnnouncementGate } from "./components/AnnouncementGate"
```

Then mount it as a sibling after `<TimerRecoveryGate />` (it needs the RootStore, Subscription, and navigation providers, all of which wrap this point). Find the `<TimerRecoveryGate />` line (around line 960) and add below it:

```tsx
              <TimerRecoveryGate />
              <AnnouncementGate />
```

- [ ] **Step 4: Type-check**

Run: `npm run compile`
Expected: no errors. The `navigate("Settings", { section: "cloudBackup" })` call compiles (the helper takes `unknown`), and `active.titleTx` / `active.cta.labelTx` satisfy the `Text` `tx` prop (`TxKeyPath`). Step 1's union addition keeps `SettingsScreen`'s `route.params.section` type honest that `"cloudBackup"` is a real section.

- [ ] **Step 5: Lint the changed files**

Run: `npm run lint:check -- app/components/AnnouncementGate.tsx app/app.tsx app/navigators/navigationTypes.ts`
Expected: no errors. (Watch for the import-order rule: React → RN → Expo → external → `@/` → relative.)

- [ ] **Step 6: Full test suite (no regressions)**

Run: `npm run test:unit`
Expected: all vitest tests pass, including the new `announcements` and `announcementLogic` suites.

- [ ] **Step 7: Manual device verification**

Reload the app (JS-only; Metro reload). Verify:
1. **Existing-user path:** with `seenAnnouncementIds` empty, the popup appears once. Dismiss it, kill and relaunch → it does **not** reappear.
2. **Subscriber CTA:** as a user with the attendance entitlement, the "Open Cloud Backup" button shows; tapping it lands on Settings scrolled to the Cloud Backup section, and the popup does not return.
3. **Non-subscriber:** without the entitlement, the popup shows text + "Got it" only (no Cloud Backup button).
4. **Timer suppression:** start an external-zoom timer, background to Zoom, return to the app → the popup does **not** cover the timer modal. After the timer flow ends, a later foreground shows it.
5. **Fresh onboarding:** complete onboarding on a clean install → the popup does **not** appear (baseline seeded).

- [ ] **Step 8: Update `CHANGELOG.md`**

Add under `## [Unreleased]` → `### Added`:

```
- **One-time announcement popup.** New features can now be announced to users
  with a single blocking dialog that appears once and never again. First use:
  the Cloud Backup & multi-device sync launch — subscribers get an "Open Cloud
  Backup" shortcut into Settings; everyone else sees the announcement text.
  Fresh installs are seeded "caught up" at onboarding so they get no backlog of
  past announcements.
```

- [ ] **Step 9: Commit**

```bash
git add app/components/AnnouncementGate.tsx app/app.tsx app/navigators/navigationTypes.ts CHANGELOG.md
git commit -m "✨ feat(announcements): blocking one-time popup gate + mount"
```

---

## Notes for the release (not a task)

- This is **JS-only** — ship via `npm run update` (OTA). Do **not** bump `runtimeVersion`.
- "Publishing the announcement" later = append to `ANNOUNCEMENTS`, add its i18n strings, OTA. No native work.
- Existing users on the OTA see the cloud-backup popup (empty seen-set). Brand-new installs of the build that carries it will not (baseline seed) — this is the agreed behavior.
```
