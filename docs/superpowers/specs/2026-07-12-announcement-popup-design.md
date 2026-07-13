# Announcement Popup — Design Spec

**Date:** 2026-07-12
**Status:** Approved (pending user review of this document)
**Type:** JS-only feature — ships via OTA, **no `runtimeVersion` bump**.

## Goal

A one-time, blocking modal that announces a new feature (first use: the
subscriber Cloud Backup & multi-device attendance sync). The team updates a
local content constant, pushes an Expo OTA, and each user's device shows the
popup exactly once, then never again.

## Architecture

Announcement content is a typed constant array baked into the JS bundle, so
"update the announcement" = edit one file + its i18n strings, then `npm run
update` (OTA). A MobX-persisted set of "seen" ids in `ProfileStore` enforces
show-once. A headless gate component, mounted as a sibling to the existing
app-wide overlays in `app.tsx`, re-evaluates on every app foreground, picks
the first unseen announcement that passes the display gates, and renders a
blocking `<Modal>`. The selection/gating decision is a pure function in a
`@/`-free module so it is unit-testable under vitest.

## Tech Stack

React Native `Modal`, MobX-State-Tree (`ProfileStore`), MMKV persistence
(automatic via `onSnapshot`), `AppState` for foreground detection, existing
`navigationRef` for the CTA deep-link, `SubscriptionContext` for
`hasAttendance`, i18n (`tx`/`TxKeyPath`), vitest for the pure core.

## Global Constraints

- **JS-only.** Do **not** bump `runtimeVersion` in `app.json` (stays `4.5.0`).
  Ships via `npm run update` (OTA).
- **No hardcoded UI strings.** All announcement copy is referenced by
  `TxKeyPath` and defined in the i18n files (English required; other locales
  may fall back to English until translated).
- **Pure logic stays `@/`-free.** The selection/gating function lives in a
  module with zero `@/` runtime imports (type-only imports OK), per the repo's
  vitest-no-path-alias rule. I/O and React live in the gate component that
  imports it.
- **Identify announcements by stable string slug**, never a sequential
  integer. Ordering comes from array position, not the id.
- **Never cover a critical surface.** The popup must not render over the
  maintenance/outage screen, during login or onboarding, or over an active
  external-zoom timer.

---

## Data Model — `app/config/announcements.ts` (new)

```ts
import type { TxKeyPath } from "@/i18n"
import type { Ionicons } from "@expo/vector-icons"

type IoniconName = keyof typeof Ionicons.glyphMap

export interface AnnouncementCta {
  /** Button label (i18n key). */
  labelTx: TxKeyPath
  /** When true, the CTA button renders ONLY for users with the
   *  recoverysky-attendance entitlement (hasAttendance). Non-entitled users
   *  still see the announcement, just without this button. */
  requiresAttendance: boolean
  /** Named destination, resolved by the gate to a concrete navigation call.
   *  Keeps announcements.ts free of navigation imports (stays pure/portable). */
  target: "cloudBackupSettings"
}

export interface Announcement {
  /** Stable, unique, human-readable slug. Never reused. Never compared. */
  id: string
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Header icon; defaults to "megaphone-outline" when omitted. */
  icon?: IoniconName
  /** Optional call-to-action button. */
  cta?: AnnouncementCta
}

/**
 * Ordered oldest→newest. The gate shows the FIRST unseen entry, so keep new
 * announcements appended at the end. Editing this array + its i18n strings and
 * shipping an OTA is the entire "publish an announcement" workflow.
 */
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

**`target` resolution** (in the gate, not the constant):
`"cloudBackupSettings"` → `navigationRef.navigate("Settings", { section: "cloudBackup" })`.
Settings already scroll-snaps to `route.params.section` via
`trackSection("cloudBackup")` at `SettingsScreen.tsx:1070` — the same
mechanism the Attendance "go to settings" link uses. No new Settings code.

---

## Persistence — `app/models/ProfileStore.ts`

Add a prop mirroring the existing `dismissedHomeCards` idiom:

```ts
seenAnnouncementIds: types.optional(types.array(types.string), []),
```

Actions:

```ts
markAnnouncementSeen(id: string) {
  if (!self.seenAnnouncementIds.includes(id)) {
    self.seenAnnouncementIds.push(id)
  }
},

/** Baseline seed for fresh installs — mark every currently-bundled
 *  announcement as already seen so a new user never gets a backlog. Called
 *  once, when onboarding completes. Idempotent. */
seedAnnouncementBaseline(ids: string[]) {
  for (const id of ids) {
    if (!self.seenAnnouncementIds.includes(id)) {
      self.seenAnnouncementIds.push(id)
    }
  }
},
```

**Reset behavior:** `seenAnnouncementIds` is **NOT** cleared on logout/reset
(unlike `dismissedHomeCards`). "Seen this news" is device-scoped, not
account-scoped; clearing it would re-pop the modal after every re-login. Do
**not** add it to the `.clear()` calls at `ProfileStore.ts:377` / `:471`.

---

## Baseline Seed — onboarding completion

Where onboarding sets `onboardingCompleted = true` (the final onboarding
step's completion action), also call:

```ts
profileStore.seedAnnouncementBaseline(ANNOUNCEMENTS.map((a) => a.id))
```

This produces the intended existing-vs-new split, keyed on the
`onboardingCompleted` transition:

| User | State when the OTA lands | Result |
|------|--------------------------|--------|
| Existing user (onboarded in a prior build) | `seenAnnouncementIds` empty; never re-runs onboarding | Sees the cloud-backup popup |
| Brand-new install of this build | Finishes onboarding → seeds `[cloud-backup-sync-2026-07]` | No "new feature" popup for a feature that shipped with their install |
| Future new install after announcement #5 | Onboarding seeds `[#1…#5]` | Sees only #6 onward, never a stale backlog |

Mental model: **announcements are "news since your baseline," and your
baseline is set the day you finish onboarding.** Existing users have no
baseline (empty ⇒ show current pending). Accepted consequence: a brand-new
user does not see an announcement that predates their install; greeting new
users belongs in the onboarding flow, not here.

---

## Selection Core — `app/utils/announcementLogic.ts` (new, pure)

Zero `@/` runtime imports (type-only OK). Fully unit-tested.

```ts
import type { Announcement } from "@/config/announcements" // type-only

export interface AnnouncementGateState {
  announcements: readonly Announcement[]
  seenIds: readonly string[]
  /** Display gates — ALL must be true for anything to show. */
  isAuthenticated: boolean
  onboardingCompleted: boolean
  outageMode: boolean
  timerSessionActive: boolean
}

/** Returns the first unseen announcement that may be shown right now, or
 *  null if none qualifies or a gate blocks display. Pure. */
export function selectPendingAnnouncement(
  state: AnnouncementGateState,
): Announcement | null {
  if (!state.isAuthenticated) return null
  if (!state.onboardingCompleted) return null
  if (state.outageMode) return null
  if (state.timerSessionActive) return null
  return (
    state.announcements.find((a) => !state.seenIds.includes(a.id)) ?? null
  )
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

---

## Gate Component — `app/components/AnnouncementGate.tsx` (new)

Headless-until-needed; renders the blocking `<Modal>`. `observer()`-wrapped.

**Data sources:**
- `useProfileStore()` → `seenAnnouncementIds`, `onboardingCompleted`,
  `markAnnouncementSeen`.
- `useSubscription()` → `hasAttendance`.
- `useAuth` / auth store → `isAuthenticated`.
- `configStore.outageMode`.
- `loadTimerSession()` from `@/services/zoom/timerSession` (non-null ⇒
  `timerSessionActive`).
- `navigationRef` for the CTA.

**Trigger:** compute the pending announcement (via `selectPendingAnnouncement`)
- on mount, and
- on every `AppState` change to `"active"` (foreground).

Show at most one announcement per foreground event (render the single result;
do not stack). Because `timerSessionActive` is read at evaluation time, a
foreground that lands mid-timer is suppressed; the next clean foreground shows
it (show-once is preserved — nothing is marked seen until dismiss/CTA).

**Rendering:**
- Blocking `<Modal>` (no dismiss-on-backdrop; must use a button).
- Icon (default `megaphone-outline`), `tx={titleTx}`, `tx={bodyTx}`.
- Buttons:
  - **Dismiss** — always present (`tx="announcements:dismiss"`, e.g. "Got
    it"). Calls `markAnnouncementSeen(id)`, closes.
  - **CTA** — rendered only when `shouldShowCta(announcement, hasAttendance)`.
    Calls `markAnnouncementSeen(id)`, then resolves `target`
    (`cloudBackupSettings` → `navigate("Settings", { section: "cloudBackup" })`),
    closes.
- Both paths persist the id, so the popup is strictly once.

**Mount point — `app/app.tsx`**, as a sibling to the other app-wide overlays,
after `<TimerRecoveryGate />` (needs the provider tree: RootStore,
Subscription, navigation):

```tsx
<AppNavigator ... />
<MaintenanceBanner />
<TimerRecoveryGate />
<AnnouncementGate />   {/* new */}
```

---

## i18n — `app/i18n/*.ts`

New `announcements` namespace. English required:

```ts
announcements: {
  cloudBackupTitle: "Cloud Backup & Multi-Device Sync",
  cloudBackupBody:
    "Your attendance records can now back up to the cloud and sync across "
    + "all your devices. Turn it on anytime in Settings.",
  cloudBackupCta: "Open Cloud Backup",
  dismiss: "Got it",
},
```

Add the same keys (translated or English-fallback) to the other locale files
already present (`es`, `de`, `fr`, `pt`, `ru`, `uk`, `ar`, `th`).

---

## Testing

**`app/utils/announcementLogic.test.ts` (vitest):**
- returns null when unauthenticated / onboarding incomplete / outage /
  timer-active, each independently.
- returns the first unseen when all gates pass.
- skips seen ids; returns the next unseen in array order.
- returns null when all are seen.
- `shouldShowCta`: false when no cta; false when `requiresAttendance` &&
  `!hasAttendance`; true when `requiresAttendance` && `hasAttendance`; true
  when cta present && `!requiresAttendance`.

**Manual (device):**
- Existing-user simulation: empty `seenAnnouncementIds` → popup shows once;
  kill/relaunch → does not show again.
- Subscriber sees "Open Cloud Backup" → lands on Settings scrolled to Cloud
  Backup; non-subscriber sees text + "Got it" only.
- Foreground during an active external-zoom timer → popup suppressed until a
  clean foreground.
- Fresh onboarding completes → popup does not appear.

---

## Out of Scope / Future

- Server-driven announcements (via `/config`) — deliberately not chosen;
  content ships in-bundle via OTA.
- Non-subscriber upsell CTA (paywall deep-link) — non-subscribers get
  text-only by decision. The `requiresAttendance` flag leaves room to add a
  second, differently-targeted CTA later.
- Auto-scroll-to-row beyond section granularity — Settings section scroll is
  sufficient.
- Rich media / images in the popup — text + icon only for now.
```
