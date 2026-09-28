# First-Use Coach Marks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Contextual first-use tips. The screen dims except a cutout around one control, and a callout card explains it. Tips fire the first time a user reaches a screen or feature. A **?** button on each coached screen replays them. Existing users updating over OTA see nothing unless they ask.

**Architecture:**
- **Registry:** a data file, `app/config/coachMoments.ts`, lists *moments*, which are chains of *steps*. Each step spotlights a named *target*.
- **Hooks:** the controls being spotlit register themselves with `useCoachTarget()`. Screens ask for their moments with `useCoachMoment()`.
- **Overlay:** one `CoachProvider` owns the run state. One `CoachMarkOverlay`, a transparent RN `Modal` mounted once in `app.tsx`, measures the target, draws the scrim, and shows the callout.
- **Pure logic:** every decision lives in `app/coach/coachMarkLogic.ts` (due, skip, advance, placement, OTA seed), and vitest covers it.

**Tech Stack:** React Native 0.81 / Expo 54, MobX-State-Tree (ProfileStore, MMKV-persisted), React Navigation v7, RN `Animated`, i18next (9 locales), Vitest (pure `.ts`), jest-expo (`.tsx`).

**Spec:** `docs/superpowers/specs/2026-09-25-first-use-coach-marks-design.md`. Read the whole file, **including "Planning amendments (2026-09-25)" at the end**. Those amendments supersede §2, §3, §5 and §6 wherever they disagree.

## Global Constraints

- JS-only change. **Do NOT bump `runtimeVersion`** or `version` in `app.json`. Do not add any dependency. In particular: no `react-native-svg`, no `expo-blur`, no coach-mark library.
- Do not use `react-native-reanimated` (nothing under `app/` uses it, and there is no worklets babel plugin). Animate with RN `Animated`.
- Seen state is **per moment**. Moment ids are a permanent contract with MMKV. Never rename or reuse one.
- `app/config/coachMoments.ts` and `app/coach/coachMarkLogic.ts` must have **zero runtime `@/` imports** (type-only imports are fine). Vitest cannot resolve `@/`.
- `app/coach/CoachContext.ts` and `app/coach/useCoachTarget.ts` must not import stores, services or the logger. Target-host components that already have jest tests (`InPersonListHeader`) import them.
- Every new translation key goes in **all nine** locale files (`en`, `ar`, `de`, `es`, `fr`, `pt`, `ru`, `th`, `uk`). Use English text as the placeholder in the other eight.
- The overlay must never dim the screen around nothing. A target that is unregistered, zero-sized, or not fully on screen vertically causes its step to be skipped.
- Auto-fire gate (all must hold): authenticated, onboarding completed, not `outageMode`, no active timer session, no announcement modal showing, no moment running, `AppState` active, tips enabled, moment unseen, and `requires` met. The **?** bypasses only "tips enabled" and "moment unseen".
- Scrim color is `rgba(0, 0, 0, 0.72)`. The cutout is padded by 8 px. The callout card is at most 360 px wide, with a 16 px screen gutter, radius 16 and a `colors.card` surface.
- The scrim swallows every touch. Tapping outside the card does nothing. Android hardware back = **Next**.
- Honor `AccessibilityInfo.isReduceMotionEnabled()`: when it is on, every transition is instant.
- Scope lint to the files you touched: `npx eslint --fix <paths>`. **Never run `npm run lint`**, which rewrites the whole repo.
- Stage only the paths you name (`git add <paths>`). **Never** use `git add -A` or `git stash`. Other sessions share this checkout.
- Follow the repo comment style: comment why a line exists whenever a future contributor could plausibly "fix" it back into a bug.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

These are the five input classes most likely to bite a real user that no screen-level test exercises. Each is pinned by a vitest case in Task 2.

1. **Programmatic navigation while a spotlight is up.** Examples: a notification tap, or a deep link while the scrim covers Home. Expected: the overlay disappears and the moment is not marked seen. It must not spotlight a stale rect on the new screen. Pinned by `cancelRunForMoment` tests. The wiring is `useCoachMoment`'s `present`/focus effect.
2. **Replaying with ? on Meetings while the Live segment is showing.** The `inperson` moment's toggle sits inside a `display: "none"` view and measures 0×0. Expected: that step is skipped silently. Pinned by the `isRectOnScreen` zero-rect case and the `advanceRun(shown=false)` case.
3. **Target below the fold.** Examples: Settings' Cloud Backup row, or InPersonPopup's "I'm Here" at the bottom of its ScrollView. Expected: the step is skipped, and a moment whose steps all skip is **not** marked seen. Pinned by the `isRectOnScreen` off-screen case and the "all skipped → completedMomentId null" case.
4. **First launch after the OTA with an odd MMKV snapshot.** Examples: `null`, no `profileStore`, a non-object, or `onboardingCompleted` stored as a string. Expected: no throw, and seeding happens only for a real `true` with the key missing. Pinned by `seedSeenOnHydrate` cases.
5. **Target hugging a screen edge.** Examples: the segmented control under the notch, or the tab bar at the bottom. Expected: the card stays inside the safe area and the arrow stays on the card. Pinned by `computeCallout` clamp cases.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `app/config/coachMoments.ts` | create | Types plus the `COACH_MOMENTS` registry. Pure data. |
| `app/config/coachMoments.test.ts` | create | Every tx key resolves in `en`; ids are unique. |
| `app/i18n/{en,ar,de,es,fr,pt,ru,th,uk}.ts` | modify | New `coach` namespace. |
| `app/coach/coachMarkLogic.ts` | create | Pure decisions: gate, due, run machine, rect checks, cutout, callout layout, OTA seed. |
| `app/coach/coachMarkLogic.test.ts` | create | Vitest for all of the above. |
| `app/models/ProfileStore.ts` | modify | `seenCoachMomentIds`, `coachTipsEnabled` and their actions; `resetOnboarding` clears them. |
| `app/models/helpers/setupRootStore.ts` | modify | Applies the quiet-by-default seed before `applySnapshot`. |
| `app/coach/CoachContext.ts` | create | Context type, no-op default, `useCoach()`. No store imports. |
| `app/coach/useCoachTarget.ts` | create | Registers a ref'd View as a target. |
| `app/coach/useCoachMoment.ts` | create | Auto-fire on focus+ready; cancel on blur or when the host is not present. |
| `app/coach/CoachProvider.tsx` | create | Owns run state; wires stores, gate and actions. |
| `app/coach/CoachCallout.tsx` | create | Presentational callout card. |
| `app/coach/CoachCallout.test.tsx` | create | Jest: labels, button flow, a11y. |
| `app/coach/CoachMarkOverlay.tsx` | create | Modal, measuring, donut scrim, animation, card placement. |
| `app/coach/CoachHelpButton.tsx` | create | The **?** button. |
| `app/coach/CoachHelpButton.test.tsx` | create | Jest: hidden when nothing to replay; press replays. |
| `app/app.tsx` | modify | Mounts `CoachProvider` + `CoachMarkOverlay`. |
| `app/components/AnnouncementGate.tsx` | modify | Reports its visibility to the coach. |
| `app/navigators/MainNavigator.tsx` | modify | Tab bar target (custom `tabBar` wrapper). |
| `app/screens/HomeScreen.tsx` | modify | ? button (also a target), `home` moment. |
| `app/screens/MeetingsScreen.tsx` | modify | Segments target, ? button, passes `visible` to Live. |
| `app/screens/LiveScreen.tsx` | modify | First-row target, `meetings` moment. |
| `app/screens/InPersonScreen.tsx` | modify | `inperson` moment. |
| `app/components/InPersonListHeader.tsx` | modify | View-toggle target. |
| `app/components/InPersonPopup.tsx` | modify | I'm Here target, ? button, `inpersonPopup` moment. |
| `app/components/SchedulePopup.tsx` | modify | ? button (renders null until a `schedulePopup` moment exists). |
| `app/screens/AttendanceScreen.tsx` | modify | Send target, ? button, `attendance` moment. |
| `app/screens/SettingsScreen.tsx` | modify | Cloud Backup target, ? button, `settings` moment, "Show tips automatically" row. |
| `CHANGELOG.md`, `docs/translation-review-2026-08-03.md`, `CLAUDE.md` | modify | Release note, review queue, subsystem note. |

---

### Task 1: Registry + i18n keys

**Files:**
- Create: `app/config/coachMoments.ts`
- Create: `app/config/coachMoments.test.ts`
- Modify: `app/i18n/en.ts`, `ar.ts`, `de.ts`, `es.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts`, `uk.ts`

**Interfaces:**
- Produces:
  - `type CoachTargetId`
  - `type CoachScreenId`
  - `interface CoachStep { targetId; titleTx; bodyTx; placement?; cutout? }`
  - `interface CoachMoment { id; screen; steps; requires? }`
  - `type CoachCutoutShape = "rounded" | "pill" | "circle"`
  - `type CoachPlacement = "auto" | "above" | "below"`
  - `const COACH_MOMENTS: readonly CoachMoment[]`
  - `const COACH_MOMENT_IDS: readonly string[]`
  - i18n keys `coach:*`

- [ ] **Step 1: Write the failing registry test**

Create `app/config/coachMoments.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import en from "../i18n/en"

import { COACH_MOMENTS, COACH_MOMENT_IDS } from "./coachMoments"

/** Resolve an i18n key like "coach:moments.home.tabBar.title" against `en`. */
function resolveTx(key: string): unknown {
  const [namespace, path] = key.split(":")
  let node: unknown = (en as Record<string, unknown>)[namespace]
  for (const part of (path ?? "").split(".")) {
    if (node === null || typeof node !== "object") return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

describe("COACH_MOMENTS registry", () => {
  it("has unique moment ids", () => {
    expect(new Set(COACH_MOMENT_IDS).size).toBe(COACH_MOMENT_IDS.length)
  })

  it("exports ids in registry order", () => {
    expect(COACH_MOMENT_IDS).toEqual(COACH_MOMENTS.map((m) => m.id))
  })

  it("gives every moment at least one step", () => {
    for (const moment of COACH_MOMENTS) expect(moment.steps.length).toBeGreaterThan(0)
  })

  it("never repeats a target inside one moment", () => {
    for (const moment of COACH_MOMENTS) {
      const targets = moment.steps.map((s) => s.targetId)
      expect(new Set(targets).size).toBe(targets.length)
    }
  })

  it("resolves every title and body key to an English string", () => {
    for (const moment of COACH_MOMENTS) {
      for (const step of moment.steps) {
        expect(typeof resolveTx(step.titleTx), step.titleTx).toBe("string")
        expect(typeof resolveTx(step.bodyTx), step.bodyTx).toBe("string")
      }
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit -- app/config/coachMoments.test.ts`
Expected: FAIL, because it cannot resolve `./coachMoments`.

- [ ] **Step 3: Create the registry**

Create `app/config/coachMoments.ts`:

```ts
/**
 * Coach-mark registry — content for first-use contextual tips.
 *
 * A *moment* is a chain of *steps*; each step spotlights one *target* (a
 * control that registered itself with `useCoachTarget(targetId)`) and shows a
 * callout card. A moment auto-fires the first time its host screen asks for it
 * (`useCoachMoment(id)`) and is then marked seen in
 * `profileStore.seenCoachMomentIds`. The ? button on a screen replays every
 * moment whose `screen` matches, in array order, ignoring seen state.
 *
 * To add a tip: add a `CoachTargetId` below, call `useCoachTarget` on the
 * control, append a moment (or a step) here, add its strings to all nine
 * locale files under `coach.moments`, and call `useCoachMoment` on the host if
 * it's a new moment. JS-only — ship via OTA, do NOT bump `runtimeVersion`.
 *
 * Moment ids are a permanent contract with MMKV: never rename or reuse one.
 * A NEW id fires for existing users too (only the first-launch seed in
 * setupRootStore quiets the ids that exist at that moment) — which is what a
 * genuinely new feature wants. See spec 2026-09-25-first-use-coach-marks.
 *
 * Purity: vitest imports this via coachMarkLogic, so NO runtime `@/` imports
 * and no native value imports. `TxKeyPath` is type-only (erased at build).
 */
import type { TxKeyPath } from "@/i18n"

/**
 * Closed union on purpose: a typo in a registry entry or in a
 * `useCoachTarget()` call is a compile error instead of a tip that silently
 * never shows.
 */
export type CoachTargetId =
  | "tabBar"
  | "home.helpButton"
  | "meetings.segments"
  | "meetings.liveRow"
  | "inperson.viewToggle"
  | "inperson.imHere"
  | "attendance.send"
  | "settings.cloudBackup"

/** The surfaces that carry a ? replay button. */
export type CoachScreenId =
  | "home"
  | "meetings"
  | "attendance"
  | "settings"
  | "schedulePopup"
  | "inPersonPopup"

export type CoachCutoutShape = "rounded" | "pill" | "circle"
export type CoachPlacement = "auto" | "above" | "below"

export interface CoachStep {
  targetId: CoachTargetId
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Callout position relative to the cutout. Default "auto" (below if it fits). */
  placement?: CoachPlacement
  /** Cutout shape. Default "rounded" (12 px corners). */
  cutout?: CoachCutoutShape
}

export interface CoachMoment {
  /** Stable, unique slug. Stored in MMKV. Never renamed, never reused. */
  id: string
  /** Which ? button replays this moment. */
  screen: CoachScreenId
  /** At least one. Unrunnable steps (target missing / off-screen) are skipped at runtime. */
  steps: readonly CoachStep[]
  /** Unmet requirements hide the moment from both auto-fire and replay. */
  requires?: { attendanceEnabled?: boolean }
}

export const COACH_MOMENTS: readonly CoachMoment[] = [
  {
    id: "home",
    screen: "home",
    steps: [
      {
        targetId: "tabBar",
        titleTx: "coach:moments.home.tabBar.title",
        bodyTx: "coach:moments.home.tabBar.body",
        // The tab bar is the bottom edge of the screen — there is never room below.
        placement: "above",
      },
      {
        targetId: "home.helpButton",
        titleTx: "coach:moments.home.helpButton.title",
        bodyTx: "coach:moments.home.helpButton.body",
        cutout: "circle",
      },
    ],
  },
  {
    id: "meetings",
    screen: "meetings",
    steps: [
      {
        targetId: "meetings.segments",
        titleTx: "coach:moments.meetings.segments.title",
        bodyTx: "coach:moments.meetings.segments.body",
        cutout: "pill",
      },
      {
        targetId: "meetings.liveRow",
        titleTx: "coach:moments.meetings.liveRow.title",
        bodyTx: "coach:moments.meetings.liveRow.body",
      },
    ],
  },
  {
    id: "inperson",
    screen: "meetings",
    steps: [
      {
        targetId: "inperson.viewToggle",
        titleTx: "coach:moments.inperson.viewToggle.title",
        bodyTx: "coach:moments.inperson.viewToggle.body",
        cutout: "pill",
      },
    ],
  },
  {
    id: "inpersonPopup",
    screen: "inPersonPopup",
    steps: [
      {
        targetId: "inperson.imHere",
        titleTx: "coach:moments.inpersonPopup.imHere.title",
        bodyTx: "coach:moments.inpersonPopup.imHere.body",
      },
    ],
    // "I'm Here" only renders when attendance is on (InPersonPopup).
    requires: { attendanceEnabled: true },
  },
  {
    id: "attendance",
    screen: "attendance",
    steps: [
      {
        targetId: "attendance.send",
        titleTx: "coach:moments.attendance.send.title",
        bodyTx: "coach:moments.attendance.send.body",
      },
    ],
    // The Attendance tab itself only exists when attendance is on.
    requires: { attendanceEnabled: true },
  },
  {
    id: "settings",
    screen: "settings",
    steps: [
      {
        targetId: "settings.cloudBackup",
        titleTx: "coach:moments.settings.cloudBackup.title",
        bodyTx: "coach:moments.settings.cloudBackup.body",
      },
    ],
  },
]

export const COACH_MOMENT_IDS: readonly string[] = COACH_MOMENTS.map((m) => m.id)
```

- [ ] **Step 4: Add the `coach` namespace to `en.ts`**

In `app/i18n/en.ts`, insert this block as a new top-level namespace right **after** the `announcements: { ... },` block (which ends with `dismiss: "Got it",` and `},`):

```ts
  // First-use coach marks (app/config/coachMoments.ts). Step copy lives under
  // `moments.<momentId>.<targetKey>`; keep titles to ~4 words and bodies to
  // two short lines — the callout card is at most 360 px wide.
  coach: {
    skip: "Skip tips",
    close: "Close",
    next: "Next",
    gotIt: "Got it",
    stepOf: "{{n}} / {{total}}",
    helpButtonLabel: "Show tips for this screen",
    settingsAutoTips: "Show tips automatically",
    settingsAutoTipsHint: "Point out features the first time you visit a screen",
    moments: {
      home: {
        tabBar: {
          title: "Find your way around",
          body: "Everything lives in these tabs. Meetings is where you'll spend most of your time.",
        },
        helpButton: {
          title: "Tips on demand",
          body: "Tap ? on any screen to see its tips again.",
        },
      },
      meetings: {
        segments: {
          title: "Three ways to find a meeting",
          body: "Live shows online meetings happening now. In-Person finds meetings near you. Search looks up any meeting.",
        },
        liveRow: {
          title: "Join in one tap",
          body: "Tap a meeting to see its details and join it in Zoom.",
        },
      },
      inperson: {
        viewToggle: {
          title: "See it on a map",
          body: "Switch between the list and a map of meetings near you.",
        },
      },
      inpersonPopup: {
        imHere: {
          title: "Log your attendance",
          body: "When you arrive at the venue, tap I'm Here to start your attendance timer.",
        },
      },
      attendance: {
        send: {
          title: "Send a report",
          body: "Meetings you attend are recorded here. Send a report to your sponsor, counselor or court when you're ready.",
        },
      },
      settings: {
        cloudBackup: {
          title: "Back up your attendance",
          body: "Turn on Cloud Backup to keep your records safe and synced across your devices.",
        },
      },
    },
  },
```

- [ ] **Step 5: Add the same block to the other eight locales**

In each of `app/i18n/ar.ts`, `de.ts`, `es.ts`, `fr.ts`, `pt.ts`, `ru.ts`, `th.ts` and `uk.ts`, insert the identical `coach: { ... },` block from Step 4 right after that file's `announcements: { ... },` block. Keep the English strings; they are review-queue placeholders (Task 10). Also keep the leading comment, but replace its first line with `// First-use coach marks — ENGLISH PLACEHOLDER pending native review (see docs/translation-review-2026-08-03.md).`

- [ ] **Step 6: Run the registry test and the type check**

Run: `npm run test:unit -- app/config/coachMoments.test.ts`
Expected: PASS (5 tests).

Run: `npm run compile`
Expected: exits 0. A missing key in any locale is a hard `tsc` error here, and so is a misspelled `titleTx`.

- [ ] **Step 7: Lint and commit**

```bash
npx eslint --fix app/config/coachMoments.ts app/config/coachMoments.test.ts app/i18n/en.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/es.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git add app/config/coachMoments.ts app/config/coachMoments.test.ts app/i18n/en.ts app/i18n/ar.ts app/i18n/de.ts app/i18n/es.ts app/i18n/fr.ts app/i18n/pt.ts app/i18n/ru.ts app/i18n/th.ts app/i18n/uk.ts
git commit -m "✨ feat(coach): coach-mark registry and i18n strings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure decision logic

**Files:**
- Create: `app/coach/coachMarkLogic.ts`
- Test: `app/coach/coachMarkLogic.test.ts`

**Interfaces:**
- Consumes: `CoachMoment`, `CoachScreenId`, `CoachStep`, `CoachCutoutShape` and `CoachPlacement` (all type-only) from Task 1.
- Produces:
  - `interface Rect { x: number; y: number; width: number; height: number }`
  - `interface Size { width: number; height: number }`
  - `interface Insets { top: number; bottom: number }`
  - `interface CoachRun { queue: readonly string[]; momentIndex: number; stepIndex: number; forced: boolean; shownInMoment: boolean }`
  - `interface CoachGateState { isAuthenticated; onboardingCompleted; outageMode; timerSessionActive; announcementVisible; running; appActive }` (all `boolean`)
  - `isGateOpen(s: CoachGateState): boolean`
  - `requiresMet(m: CoachMoment, ctx: { attendanceEnabled: boolean }): boolean`
  - `isMomentDue(m: CoachMoment, ctx: { attendanceEnabled: boolean; seenIds: readonly string[]; tipsEnabled: boolean }): boolean`
  - `replayQueueForScreen(moments: readonly CoachMoment[], screen: CoachScreenId, ctx: { attendanceEnabled: boolean }): string[]`
  - `startRun(queue: readonly string[], forced: boolean): CoachRun | null`
  - `currentStep(run: CoachRun | null, moments: readonly CoachMoment[]): CurrentStep | null`, where `CurrentStep = { moment; step; stepIndex; total; isLast }`
  - `advanceRun(run: CoachRun | null, moments, shown: boolean): { run: CoachRun | null; completedMomentId: string | null }`
  - `skipRun(run: CoachRun | null, moments): { completedMomentId: string | null; disableTips: boolean }`
  - `cancelRunForMoment(run: CoachRun | null, moments, momentId: string): CoachRun | null`
  - `isRectOnScreen(r: Rect | null, screen: Size): r is Rect`
  - `cutoutFor(r: Rect, shape: CoachCutoutShape): { rect: Rect; radius: number }`
  - `computeCallout(cutout: Rect, screen: Size, insets: Insets, placement: CoachPlacement, cardHeight: number): { x; y; width; arrowSide: "top" | "bottom"; arrowX }`
  - `seedSeenOnHydrate(raw: unknown, allMomentIds: readonly string[]): string[] | null`
  - Constants: `CUTOUT_PADDING = 8`, `CALLOUT_GAP = 12`, `SCREEN_GUTTER = 16`, `CALLOUT_MAX_WIDTH = 360`, `CALLOUT_EDGE_MARGIN = 8`, `ARROW_INSET = 20`, `ROUNDED_RADIUS = 12`

- [ ] **Step 1: Write the failing tests**

Create `app/coach/coachMarkLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import type { CoachMoment } from "@/config/coachMoments"

import {
  advanceRun,
  CALLOUT_GAP,
  CALLOUT_MAX_WIDTH,
  cancelRunForMoment,
  computeCallout,
  CUTOUT_PADDING,
  cutoutFor,
  currentStep,
  isGateOpen,
  isMomentDue,
  isRectOnScreen,
  replayQueueForScreen,
  ROUNDED_RADIUS,
  SCREEN_GUTTER,
  seedSeenOnHydrate,
  skipRun,
  startRun,
} from "./coachMarkLogic"

// `as never` on every field: test targets aren't real CoachTargetIds, and a
// cast of the whole object would be rejected by tsc (neither side assignable).
const step = (targetId: string): CoachMoment["steps"][number] => ({
  targetId: targetId as never,
  titleTx: "t" as never,
  bodyTx: "b" as never,
})

const A: CoachMoment = { id: "a", screen: "meetings", steps: [step("s1"), step("s2")] }
const B: CoachMoment = { id: "b", screen: "meetings", steps: [step("s3")] }
const ATT: CoachMoment = {
  id: "att",
  screen: "attendance",
  steps: [step("s4")],
  requires: { attendanceEnabled: true },
}
const MOMENTS = [A, B, ATT] as const

const openGate = {
  isAuthenticated: true,
  onboardingCompleted: true,
  outageMode: false,
  timerSessionActive: false,
  announcementVisible: false,
  running: false,
  appActive: true,
}

describe("isGateOpen", () => {
  it("is open when every condition holds", () => {
    expect(isGateOpen(openGate)).toBe(true)
  })

  it.each([
    ["isAuthenticated", false],
    ["onboardingCompleted", false],
    ["outageMode", true],
    ["timerSessionActive", true],
    ["announcementVisible", true],
    ["running", true],
    ["appActive", false],
  ] as const)("closes when %s is %s", (key, value) => {
    expect(isGateOpen({ ...openGate, [key]: value })).toBe(false)
  })
})

describe("isMomentDue", () => {
  const ctx = { attendanceEnabled: true, seenIds: [] as string[], tipsEnabled: true }

  it("is due when unseen, tips on, requirements met", () => {
    expect(isMomentDue(A, ctx)).toBe(true)
  })

  it("is not due once seen", () => {
    expect(isMomentDue(A, { ...ctx, seenIds: ["a"] })).toBe(false)
  })

  it("is not due with tips turned off", () => {
    expect(isMomentDue(A, { ...ctx, tipsEnabled: false })).toBe(false)
  })

  it("is not due when attendance is required but off", () => {
    expect(isMomentDue(ATT, { ...ctx, attendanceEnabled: false })).toBe(false)
  })
})

describe("replayQueueForScreen", () => {
  it("returns every moment for the screen in registry order", () => {
    expect(replayQueueForScreen(MOMENTS, "meetings", { attendanceEnabled: true })).toEqual([
      "a",
      "b",
    ])
  })

  it("drops moments whose requirements are unmet", () => {
    expect(replayQueueForScreen(MOMENTS, "attendance", { attendanceEnabled: false })).toEqual([])
  })

  it("is empty for a screen with no moments", () => {
    expect(replayQueueForScreen(MOMENTS, "schedulePopup", { attendanceEnabled: true })).toEqual([])
  })
})

describe("run machine", () => {
  it("startRun returns null for an empty queue", () => {
    expect(startRun([], false)).toBeNull()
  })

  it("currentStep reports position and isLast", () => {
    const run = startRun(["a"], false)
    expect(currentStep(run, MOMENTS)).toMatchObject({ stepIndex: 0, total: 2, isLast: false })
  })

  it("currentStep is null for an unknown moment id", () => {
    expect(currentStep(startRun(["zzz"], false), MOMENTS)).toBeNull()
  })

  it("advances through steps then completes the moment when a step was shown", () => {
    const r0 = startRun(["a"], false)
    const r1 = advanceRun(r0, MOMENTS, true)
    expect(r1.completedMomentId).toBeNull()
    expect(r1.run?.stepIndex).toBe(1)
    const r2 = advanceRun(r1.run, MOMENTS, true)
    expect(r2).toEqual({ run: null, completedMomentId: "a" })
  })

  it("marks the moment complete if ANY step was shown, even when the last one skipped", () => {
    const r1 = advanceRun(startRun(["a"], false), MOMENTS, true)
    expect(advanceRun(r1.run, MOMENTS, false).completedMomentId).toBe("a")
  })

  it("does NOT complete a moment whose every step was skipped (Review Focus 2 & 3)", () => {
    const r1 = advanceRun(startRun(["a"], false), MOMENTS, false)
    expect(advanceRun(r1.run, MOMENTS, false)).toEqual({ run: null, completedMomentId: null })
  })

  it("moves to the next queued moment at step 0 with a fresh shown flag", () => {
    const r1 = advanceRun(startRun(["b", "a"], true), MOMENTS, true)
    expect(r1.completedMomentId).toBe("b")
    expect(r1.run).toMatchObject({ momentIndex: 1, stepIndex: 0, shownInMoment: false, forced: true })
  })

  it("advanceRun on a null run is a no-op", () => {
    expect(advanceRun(null, MOMENTS, true)).toEqual({ run: null, completedMomentId: null })
  })
})

describe("skipRun", () => {
  it("marks the current moment seen and disables tips for an automatic run", () => {
    expect(skipRun(startRun(["a"], false), MOMENTS)).toEqual({
      completedMomentId: "a",
      disableTips: true,
    })
  })

  it("does not disable tips for a ? replay", () => {
    expect(skipRun(startRun(["a"], true), MOMENTS)).toEqual({
      completedMomentId: "a",
      disableTips: false,
    })
  })

  it("is inert with nothing running", () => {
    expect(skipRun(null, MOMENTS)).toEqual({ completedMomentId: null, disableTips: false })
  })
})

describe("cancelRunForMoment (Review Focus 1)", () => {
  it("ends the run when the cancelled moment is the one showing", () => {
    expect(cancelRunForMoment(startRun(["a"], false), MOMENTS, "a")).toBeNull()
  })

  it("returns the SAME run object when another moment is showing", () => {
    const run = startRun(["a"], false)
    expect(cancelRunForMoment(run, MOMENTS, "b")).toBe(run)
  })

  it("is null-safe", () => {
    expect(cancelRunForMoment(null, MOMENTS, "a")).toBeNull()
  })
})

describe("isRectOnScreen (Review Focus 2 & 3)", () => {
  const screen = { width: 390, height: 844 }

  it("accepts a normal visible rect", () => {
    expect(isRectOnScreen({ x: 16, y: 100, width: 200, height: 40 }, screen)).toBe(true)
  })

  it("rejects null", () => {
    expect(isRectOnScreen(null, screen)).toBe(false)
  })

  it("rejects a zero-size rect (display:none segment)", () => {
    expect(isRectOnScreen({ x: 0, y: 0, width: 0, height: 0 }, screen)).toBe(false)
  })

  it("rejects NaN geometry", () => {
    expect(isRectOnScreen({ x: NaN, y: 10, width: 10, height: 10 }, screen)).toBe(false)
  })

  it("rejects a rect below the fold", () => {
    expect(isRectOnScreen({ x: 16, y: 900, width: 200, height: 40 }, screen)).toBe(false)
  })

  it("rejects a rect partly below the fold", () => {
    expect(isRectOnScreen({ x: 16, y: 820, width: 200, height: 40 }, screen)).toBe(false)
  })

  it("rejects a rect scrolled above the top", () => {
    expect(isRectOnScreen({ x: 16, y: -10, width: 200, height: 40 }, screen)).toBe(false)
  })

  it("rejects a rect fully off to the side", () => {
    expect(isRectOnScreen({ x: 400, y: 100, width: 50, height: 40 }, screen)).toBe(false)
  })
})

describe("cutoutFor", () => {
  const r = { x: 100, y: 200, width: 60, height: 20 }

  it("pads a rounded cutout and uses the fixed radius", () => {
    expect(cutoutFor(r, "rounded")).toEqual({
      rect: { x: 100 - CUTOUT_PADDING, y: 200 - CUTOUT_PADDING, width: 76, height: 36 },
      radius: ROUNDED_RADIUS,
    })
  })

  it("gives a pill a radius of half its padded height", () => {
    expect(cutoutFor(r, "pill").radius).toBe(18)
  })

  it("makes a circle square around the target's centre", () => {
    const c = cutoutFor(r, "circle")
    expect(c.rect.width).toBe(c.rect.height)
    expect(c.rect.width).toBe(60 + CUTOUT_PADDING * 2)
    expect(c.rect.x + c.rect.width / 2).toBe(130)
    expect(c.rect.y + c.rect.height / 2).toBe(210)
    expect(c.radius).toBe(c.rect.width / 2)
  })
})

describe("computeCallout (Review Focus 5)", () => {
  const screen = { width: 390, height: 844 }
  const insets = { top: 47, bottom: 34 }

  it("places the card below when it fits, arrow pointing up", () => {
    const layout = computeCallout({ x: 100, y: 100, width: 100, height: 40 }, screen, insets, "auto", 150)
    expect(layout.arrowSide).toBe("top")
    expect(layout.y).toBe(100 + 40 + CALLOUT_GAP)
  })

  it("flips above when there is no room below", () => {
    const layout = computeCallout({ x: 100, y: 700, width: 100, height: 40 }, screen, insets, "auto", 150)
    expect(layout.arrowSide).toBe("bottom")
    expect(layout.y).toBe(700 - CALLOUT_GAP - 150)
  })

  it("honours an explicit placement", () => {
    const layout = computeCallout({ x: 0, y: 760, width: 390, height: 84 }, screen, insets, "above", 150)
    expect(layout.arrowSide).toBe("bottom")
  })

  it("caps width and keeps a gutter on a wide screen", () => {
    const layout = computeCallout({ x: 0, y: 100, width: 50, height: 40 }, { width: 1024, height: 768 }, insets, "auto", 150)
    expect(layout.width).toBe(CALLOUT_MAX_WIDTH)
    expect(layout.x).toBe(SCREEN_GUTTER)
  })

  it("clamps horizontally at the right edge", () => {
    const layout = computeCallout({ x: 360, y: 100, width: 22, height: 22 }, screen, insets, "auto", 150)
    expect(layout.x + layout.width).toBe(screen.width - SCREEN_GUTTER)
    expect(layout.arrowX).toBeLessThanOrEqual(layout.width - 20)
  })

  it("never puts the card under the notch", () => {
    const layout = computeCallout({ x: 100, y: 0, width: 100, height: 10 }, screen, insets, "above", 150)
    expect(layout.y).toBeGreaterThanOrEqual(insets.top)
  })

  it("never pushes the card into the home indicator", () => {
    const layout = computeCallout({ x: 100, y: 780, width: 100, height: 20 }, screen, insets, "below", 150)
    expect(layout.y + 150).toBeLessThanOrEqual(screen.height - insets.bottom)
  })
})

describe("seedSeenOnHydrate (Review Focus 4)", () => {
  const ids = ["a", "b"]

  it("seeds every id for an onboarded user missing the key (first launch after OTA)", () => {
    expect(seedSeenOnHydrate({ profileStore: { onboardingCompleted: true } }, ids)).toEqual(ids)
  })

  it("returns a copy, not the input array", () => {
    const out = seedSeenOnHydrate({ profileStore: { onboardingCompleted: true } }, ids)
    expect(out).not.toBe(ids)
  })

  it("does nothing once the key exists (even empty)", () => {
    expect(
      seedSeenOnHydrate({ profileStore: { onboardingCompleted: true, seenCoachMomentIds: [] } }, ids),
    ).toBeNull()
  })

  it("does nothing for a user still in onboarding", () => {
    expect(seedSeenOnHydrate({ profileStore: { onboardingCompleted: false } }, ids)).toBeNull()
  })

  it.each([null, undefined, 42, "x", {}, { profileStore: null }, { profileStore: "x" }])(
    "tolerates a malformed snapshot: %p",
    (raw) => {
      expect(seedSeenOnHydrate(raw, ids)).toBeNull()
    },
  )

  it("requires a real boolean true", () => {
    expect(seedSeenOnHydrate({ profileStore: { onboardingCompleted: "true" } }, ids)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- app/coach/coachMarkLogic.test.ts`
Expected: FAIL, because it cannot resolve `./coachMarkLogic`.

- [ ] **Step 3: Implement**

Create `app/coach/coachMarkLogic.ts`:

```ts
/**
 * Pure decision logic for first-use coach marks. No runtime `@/` imports and
 * no native imports, so vitest can exercise it directly (vitest has no `@/`
 * alias). CoachProvider / CoachMarkOverlay supply live state; every branch
 * lives here. Spec: docs/superpowers/specs/2026-09-25-first-use-coach-marks-design.md
 */
import type {
  CoachCutoutShape,
  CoachMoment,
  CoachPlacement,
  CoachScreenId,
  CoachStep,
} from "@/config/coachMoments"

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Size {
  width: number
  height: number
}
export interface Insets {
  top: number
  bottom: number
}

/** Breathing room between the target's measured edge and the cutout's edge. */
export const CUTOUT_PADDING = 8
/** Distance between the cutout and the callout card. */
export const CALLOUT_GAP = 12
export const SCREEN_GUTTER = 16
export const CALLOUT_MAX_WIDTH = 360
/** Minimum distance between the card and the safe-area edge. */
export const CALLOUT_EDGE_MARGIN = 8
/** Keeps the arrow off the card's rounded corners. */
export const ARROW_INSET = 20
export const ROUNDED_RADIUS = 12

// ---------------------------------------------------------------------------
// Gate & due
// ---------------------------------------------------------------------------

export interface CoachGateState {
  isAuthenticated: boolean
  onboardingCompleted: boolean
  outageMode: boolean
  /** A live attendance timer — never cover it (same rule as AnnouncementGate). */
  timerSessionActive: boolean
  /** Announcements win: one overlay at a time. */
  announcementVisible: boolean
  running: boolean
  appActive: boolean
}

/** Safety rules. The ? replay respects these too — only seen/tips-enabled are bypassable. */
export function isGateOpen(s: CoachGateState): boolean {
  return (
    s.isAuthenticated &&
    s.onboardingCompleted &&
    !s.outageMode &&
    !s.timerSessionActive &&
    !s.announcementVisible &&
    !s.running &&
    s.appActive
  )
}

export interface MomentContext {
  attendanceEnabled: boolean
}

export function requiresMet(moment: CoachMoment, ctx: MomentContext): boolean {
  const need = moment.requires?.attendanceEnabled
  if (need !== undefined && need !== ctx.attendanceEnabled) return false
  return true
}

export interface DueContext extends MomentContext {
  seenIds: readonly string[]
  tipsEnabled: boolean
}

/** Auto-fire eligibility (the gate is checked separately by the caller). */
export function isMomentDue(moment: CoachMoment, ctx: DueContext): boolean {
  if (!requiresMet(moment, ctx)) return false
  if (!ctx.tipsEnabled) return false
  return !ctx.seenIds.includes(moment.id)
}

/** Every moment the ? on `screen` replays, in registry order. */
export function replayQueueForScreen(
  moments: readonly CoachMoment[],
  screen: CoachScreenId,
  ctx: MomentContext,
): string[] {
  return moments
    .filter((m) => m.screen === screen && m.steps.length > 0 && requiresMet(m, ctx))
    .map((m) => m.id)
}

// ---------------------------------------------------------------------------
// Run machine
// ---------------------------------------------------------------------------

export interface CoachRun {
  /** Moment ids to play in order. Auto-fire queues one; the ? queues a screen's worth. */
  queue: readonly string[]
  momentIndex: number
  stepIndex: number
  /** Started by the ? button. Changes the secondary button to "Close" and stops it disabling tips. */
  forced: boolean
  /** Whether any step of the CURRENT moment actually rendered. A moment is only marked seen if so. */
  shownInMoment: boolean
}

export interface CurrentStep {
  moment: CoachMoment
  step: CoachStep
  stepIndex: number
  total: number
  isLast: boolean
}

export function startRun(queue: readonly string[], forced: boolean): CoachRun | null {
  if (queue.length === 0) return null
  return { queue, momentIndex: 0, stepIndex: 0, forced, shownInMoment: false }
}

export function currentStep(
  run: CoachRun | null,
  moments: readonly CoachMoment[],
): CurrentStep | null {
  if (!run) return null
  const moment = moments.find((m) => m.id === run.queue[run.momentIndex])
  const step = moment?.steps[run.stepIndex]
  if (!moment || !step) return null
  return {
    moment,
    step,
    stepIndex: run.stepIndex,
    total: moment.steps.length,
    isLast: run.stepIndex === moment.steps.length - 1,
  }
}

export interface AdvanceResult {
  run: CoachRun | null
  /** Set when a moment just finished AND at least one of its steps was shown — mark it seen. */
  completedMomentId: string | null
}

/**
 * Move past the current step. `shown` is true when the user pressed Next on a
 * rendered step and false when the overlay skipped an unrunnable one (target
 * missing, zero-size, or off-screen). A moment whose every step skipped is NOT
 * completed, so it re-fires on a later visit when its target exists.
 */
export function advanceRun(
  run: CoachRun | null,
  moments: readonly CoachMoment[],
  shown: boolean,
): AdvanceResult {
  const cur = currentStep(run, moments)
  if (!run || !cur) return { run: null, completedMomentId: null }
  const shownInMoment = run.shownInMoment || shown
  if (!cur.isLast) {
    return { run: { ...run, stepIndex: run.stepIndex + 1, shownInMoment }, completedMomentId: null }
  }
  const completedMomentId = shownInMoment ? cur.moment.id : null
  if (run.momentIndex + 1 < run.queue.length) {
    return {
      run: { ...run, momentIndex: run.momentIndex + 1, stepIndex: 0, shownInMoment: false },
      completedMomentId,
    }
  }
  return { run: null, completedMomentId }
}

/**
 * "Skip tips" (auto run) or "Close" (? replay). Either way the current moment
 * is marked seen — the user looked at it. Only an automatic run's skip turns
 * auto tips off: asking for tips with ? is not a request to stop them.
 */
export function skipRun(
  run: CoachRun | null,
  moments: readonly CoachMoment[],
): { completedMomentId: string | null; disableTips: boolean } {
  const cur = currentStep(run, moments)
  if (!run || !cur) return { completedMomentId: null, disableTips: false }
  return { completedMomentId: cur.moment.id, disableTips: !run.forced }
}

/**
 * The host of `momentId` left the screen (blur, popup closed, programmatic
 * navigation). End the run WITHOUT marking seen if that moment is the one
 * showing; otherwise return the same object so callers can skip a re-render.
 */
export function cancelRunForMoment(
  run: CoachRun | null,
  moments: readonly CoachMoment[],
  momentId: string,
): CoachRun | null {
  const cur = currentStep(run, moments)
  if (cur && cur.moment.id === momentId) return null
  return run
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * A target is spotlightable only when it has real size and sits fully inside
 * the window vertically. Hidden Meetings segments (display:none) measure 0×0;
 * rows below the fold measure past the bottom — both must skip, never dim the
 * screen around nothing.
 */
export function isRectOnScreen(r: Rect | null, screen: Size): r is Rect {
  if (!r) return false
  const { x, y, width, height } = r
  if (![x, y, width, height].every(Number.isFinite)) return false
  if (!(width > 0 && height > 0)) return false
  if (y < 0 || y + height > screen.height) return false
  if (x + width <= 0 || x >= screen.width) return false
  return true
}

/** Padded cutout rect + corner radius for a step's shape. */
export function cutoutFor(r: Rect, shape: CoachCutoutShape): { rect: Rect; radius: number } {
  if (shape === "circle") {
    const side = Math.max(r.width, r.height) + CUTOUT_PADDING * 2
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    return { rect: { x: cx - side / 2, y: cy - side / 2, width: side, height: side }, radius: side / 2 }
  }
  const rect = {
    x: r.x - CUTOUT_PADDING,
    y: r.y - CUTOUT_PADDING,
    width: r.width + CUTOUT_PADDING * 2,
    height: r.height + CUTOUT_PADDING * 2,
  }
  return { rect, radius: shape === "pill" ? rect.height / 2 : ROUNDED_RADIUS }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)

export interface CalloutLayout {
  x: number
  y: number
  width: number
  /** Which edge of the card the arrow sits on ("top" = card is below the cutout). */
  arrowSide: "top" | "bottom"
  /** Arrow centre, measured from the card's left edge. */
  arrowX: number
}

/** Card position for an already-padded cutout. */
export function computeCallout(
  cutout: Rect,
  screen: Size,
  insets: Insets,
  placement: CoachPlacement,
  cardHeight: number,
): CalloutLayout {
  const width = Math.min(CALLOUT_MAX_WIDTH, screen.width - SCREEN_GUTTER * 2)
  const centerX = cutout.x + cutout.width / 2
  const x = clamp(centerX - width / 2, SCREEN_GUTTER, screen.width - SCREEN_GUTTER - width)

  const minY = insets.top + CALLOUT_EDGE_MARGIN
  const maxY = Math.max(minY, screen.height - insets.bottom - CALLOUT_EDGE_MARGIN - cardHeight)
  const belowY = cutout.y + cutout.height + CALLOUT_GAP
  const aboveY = cutout.y - CALLOUT_GAP - cardHeight

  const below = placement === "below" || (placement === "auto" && belowY <= maxY)
  const y = clamp(below ? belowY : aboveY, minY, maxY)
  const arrowX = clamp(centerX - x, ARROW_INSET, width - ARROW_INSET)
  return { x, y, width, arrowSide: below ? "top" : "bottom", arrowX }
}

// ---------------------------------------------------------------------------
// OTA seed
// ---------------------------------------------------------------------------

/**
 * Quiet-by-default for existing users. Returns every moment id when the raw
 * MMKV snapshot belongs to an already-onboarded user AND predates coach marks
 * (no `seenCoachMomentIds` key at all) — i.e. the first launch on the bundle
 * that introduced them. Fresh installs (no snapshot, or onboarding not done)
 * get null and therefore see every tip. Once the key exists — even as [] —
 * this never seeds again, so moments appended later DO reach existing users.
 */
export function seedSeenOnHydrate(raw: unknown, allMomentIds: readonly string[]): string[] | null {
  if (!raw || typeof raw !== "object") return null
  const profile = (raw as { profileStore?: unknown }).profileStore
  if (!profile || typeof profile !== "object") return null
  const p = profile as Record<string, unknown>
  if (p.onboardingCompleted !== true) return null
  if ("seenCoachMomentIds" in p) return null
  return [...allMomentIds]
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit -- app/coach/coachMarkLogic.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/coach/coachMarkLogic.ts app/coach/coachMarkLogic.test.ts
git add app/coach/coachMarkLogic.ts app/coach/coachMarkLogic.test.ts
git commit -m "✨ feat(coach): pure coach-mark decisions (gate, run machine, geometry, OTA seed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ProfileStore state + quiet-by-default seed

**Files:**
- Modify: `app/models/ProfileStore.ts`. The props block is at lines ~40–110. Put the new props after `seenAnnouncementIds`. Put the actions near `markAnnouncementSeen` (~line 430) and change `resetOnboarding` (~line 401).
- Modify: `app/models/helpers/setupRootStore.ts`, the `restoredState` branch (~lines 35–42).

**Interfaces:**
- Consumes: `seedSeenOnHydrate` (Task 2) and `COACH_MOMENT_IDS` (Task 1).
- Produces:
  - Props: `profileStore.seenCoachMomentIds: string[]` and `profileStore.coachTipsEnabled: boolean`.
  - Actions: `markCoachMomentSeen(id: string)`, `setCoachTipsEnabled(value: boolean)` and `resetCoachMoments()`.

MST stores import `@/`, so vitest cannot reach them. The seed decision is already covered by Task 2, and this task is verified by `compile` plus the manual check in Task 10.

- [ ] **Step 1: Add the props**

In `app/models/ProfileStore.ts`, directly after the `seenAnnouncementIds: types.optional(types.array(types.string), []),` line, add:

```ts

    // First-use coach marks (app/config/coachMoments.ts). Ids of moments the
    // user has seen (finished or skipped). Device-scoped like
    // seenAnnouncementIds. Already-onboarded users get every id seeded on the
    // first launch after the OTA that introduced this (seedSeenOnHydrate in
    // setupRootStore), so coach marks stay quiet for them unless they tap ?.
    seenCoachMomentIds: types.optional(types.array(types.string), []),
    // "Show tips automatically" (Settings). "Skip tips" on an automatic tip
    // sets this false; the ? buttons still work either way.
    coachTipsEnabled: types.optional(types.boolean, true),
```

- [ ] **Step 2: Add the actions**

In the same `.actions(...)` block, directly after the `markAnnouncementSeen(id: string) { ... },` action, add:

```ts

      /** Mark a coach-mark moment as seen so it never auto-fires again (? still replays it). */
      markCoachMomentSeen(id: string) {
        if (!self.seenCoachMomentIds.includes(id)) {
          self.seenCoachMomentIds.push(id)
        }
      },

      setCoachTipsEnabled(value: boolean) {
        self.coachTipsEnabled = value
      },

      /** Forget every seen coach moment and turn auto tips back on. */
      resetCoachMoments() {
        self.seenCoachMomentIds.clear()
        self.coachTipsEnabled = true
      },
```

- [ ] **Step 3: Make `resetOnboarding` treat the user as new**

Replace the body of `resetOnboarding()`:

```ts
      resetOnboarding() {
        self.onboardingCompleted = false
        self.imported = false
        // ADDED 2026-09-25: a re-onboarded user is treated as new for coach
        // marks too. Inlined (not a sibling action call) because MST doesn't
        // type sibling actions on `self` within the same .actions() block.
        // Deliberately NOT mirrored in completeOnboarding(): that pre-seeds
        // announcements, and pre-seeding coach moments there would silence
        // tips for exactly the new users they exist for.
        self.seenCoachMomentIds.clear()
        self.coachTipsEnabled = true
      },
```

- [ ] **Step 4: Apply the seed in `setupRootStore`**

In `app/models/helpers/setupRootStore.ts`, add these imports under the existing `@/` import group:

```ts
import { seedSeenOnHydrate } from "@/coach/coachMarkLogic"
import { COACH_MOMENT_IDS } from "@/config/coachMoments"
```

Then replace:

```ts
      const { configStore: _configStore, ...stateWithoutConfig } = restoredState
      applySnapshot(rootStore, stateWithoutConfig)
```

with:

```ts
      const { configStore: _configStore, ...stateWithoutConfig } = restoredState
      // ADDED 2026-09-25: quiet-by-default coach marks. On the first launch of
      // the bundle that introduced them, an already-onboarded user's snapshot
      // has no seenCoachMomentIds key; seed every current moment id so the
      // update doesn't ambush existing users with tips. Must run BEFORE
      // applySnapshot — afterwards the MST default ([]) has filled the key in
      // and the "key missing" signal is gone. See seedSeenOnHydrate.
      const coachSeed = seedSeenOnHydrate(restoredState, COACH_MOMENT_IDS)
      const hydrated = coachSeed
        ? {
            ...stateWithoutConfig,
            profileStore: { ...stateWithoutConfig.profileStore, seenCoachMomentIds: coachSeed },
          }
        : stateWithoutConfig
      applySnapshot(rootStore, hydrated)
      if (coachSeed) log.info("Seeded coach moments as seen for existing user", { count: coachSeed.length })
```

- [ ] **Step 5: Type check**

Run: `npm run compile`
Expected: exits 0. (Spreading a possibly-undefined `profileStore` is legal TS. At runtime the seed only fires when `profileStore` exists, because `seedSeenOnHydrate` checks for it.)

- [ ] **Step 6: Run the full unit suite (regression)**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npx eslint --fix app/models/ProfileStore.ts app/models/helpers/setupRootStore.ts
git add app/models/ProfileStore.ts app/models/helpers/setupRootStore.ts
git commit -m "✨ feat(coach): persist seen coach moments; stay quiet for existing users on OTA

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Coach runtime (context, provider, hooks)

**Files:**
- Create: `app/coach/CoachContext.ts`
- Create: `app/coach/useCoachTarget.ts`
- Create: `app/coach/useCoachMoment.ts`
- Create: `app/coach/CoachProvider.tsx`

**Interfaces:**
- Consumes: from Task 2, `advanceRun`, `cancelRunForMoment`, `isGateOpen`, `isMomentDue`, `replayQueueForScreen`, `skipRun`, `startRun`, `CoachRun` and `Rect`. From Task 1, `COACH_MOMENTS`. From Task 3, the ProfileStore actions.
- Produces:
  - `CoachContextValue` with these members:
    - `run: CoachRun | null`
    - `registerTarget(id: CoachTargetId, measure: MeasureFn): () => void`
    - `measureTarget(id): Promise<Rect | null>`
    - `requestAuto(momentId: string): void`
    - `cancelMoment(momentId: string): void`
    - `replay(screen: CoachScreenId): void`
    - `hasReplay(screen): boolean`
    - `next(shown: boolean): void`
    - `skip(): void`
    - `setAnnouncementVisible(visible: boolean): void`
  - `type MeasureFn = () => Promise<Rect | null>`
  - `NOOP_COACH`, `CoachContext` and `useCoach()`
  - `useCoachTarget(targetId: CoachTargetId | null | undefined, enabled?: boolean): RefObject<View | null>`
  - `measureView(view: View | null): Promise<Rect | null>`
  - `useCoachMoment(momentId: string, opts?: { ready?: boolean; present?: boolean }): void` and `COACH_SETTLE_MS = 450`
  - `<CoachProvider>{children}</CoachProvider>`

This task has no automated coverage by design: the provider imports `@/models`, which vitest can't load, and its decisions are the Task 2 functions. It is verified by `compile`, and by the jest tests in Tasks 5–6 that exercise the context contract.

- [ ] **Step 1: Create the context module (store-free)**

Create `app/coach/CoachContext.ts`:

```ts
/**
 * Coach-mark context contract. Deliberately store-free: target hosts that
 * already have jest tests (InPersonListHeader) import useCoachTarget → this
 * file, and pulling @/models in here would drag MMKV into their test graph.
 * The default value is a no-op so a host rendered without <CoachProvider>
 * (tests, storybook-style renders) behaves as "coach marks off".
 */
import { createContext, useContext } from "react"

import type { CoachScreenId, CoachTargetId } from "@/config/coachMoments"

import type { CoachRun, Rect } from "./coachMarkLogic"

export type MeasureFn = () => Promise<Rect | null>

export interface CoachContextValue {
  run: CoachRun | null
  /** Returns an unregister function. Identity-guarded: a stale unregister can't remove a newer target. */
  registerTarget: (id: CoachTargetId, measure: MeasureFn) => () => void
  measureTarget: (id: CoachTargetId) => Promise<Rect | null>
  /** Start `momentId` if the gate is open and it's due (auto-fire). */
  requestAuto: (momentId: string) => void
  /** Host left the screen: end the run without marking seen if `momentId` is showing. */
  cancelMoment: (momentId: string) => void
  /** The ? button: play every eligible moment for `screen`, ignoring seen state. */
  replay: (screen: CoachScreenId) => void
  /** Whether `screen` has anything to replay (reads observable store state — call from an observer). */
  hasReplay: (screen: CoachScreenId) => boolean
  /** `shown` = the step rendered (user pressed Next) vs. was skipped as unrunnable. */
  next: (shown: boolean) => void
  skip: () => void
  setAnnouncementVisible: (visible: boolean) => void
}

const noop = () => {}

export const NOOP_COACH: CoachContextValue = {
  run: null,
  registerTarget: () => noop,
  measureTarget: async () => null,
  requestAuto: noop,
  cancelMoment: noop,
  replay: noop,
  hasReplay: () => false,
  next: noop,
  skip: noop,
  setAnnouncementVisible: noop,
}

export const CoachContext = createContext<CoachContextValue>(NOOP_COACH)

export function useCoach(): CoachContextValue {
  return useContext(CoachContext)
}
```

- [ ] **Step 2: Create `useCoachTarget`**

Create `app/coach/useCoachTarget.ts`:

```ts
/**
 * Register a View as a coach-mark spotlight target.
 *
 *   const ref = useCoachTarget("meetings.segments")
 *   <View ref={ref} collapsable={false}>…</View>
 *
 * `collapsable={false}` is REQUIRED on a plain wrapper View: Android's view
 * flattening removes layout-only Views from the native tree, and a flattened
 * View has nothing to measure (measureInWindow never answers usefully).
 * Pressable / TouchableOpacity targets can take the ref directly.
 *
 * `enabled` false unregisters — use it for targets inside a segment that is
 * mounted but hidden (display:none), so a moment can't try to spotlight them.
 */
import { useEffect, useRef } from "react"
import type { View } from "react-native"

import type { CoachTargetId } from "@/config/coachMoments"

import type { Rect } from "./coachMarkLogic"
import { useCoach } from "./CoachContext"

export function measureView(view: View | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!view) {
      resolve(null)
      return
    }
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }))
  })
}

export function useCoachTarget(targetId: CoachTargetId | null | undefined, enabled = true) {
  const ref = useRef<View>(null)
  const { registerTarget } = useCoach()

  useEffect(() => {
    if (!targetId || !enabled) return
    return registerTarget(targetId, () => measureView(ref.current))
  }, [targetId, enabled, registerTarget])

  return ref
}
```

- [ ] **Step 3: Create `useCoachMoment`**

Create `app/coach/useCoachMoment.ts`:

```ts
/**
 * Ask for a coach-mark moment to auto-fire on this screen.
 *
 * - `present`: the host is actually on screen (a Meetings segment is the
 *   visible one; a popup is open). Default true.
 * - `ready`: the moment's first target exists (e.g. Live has at least one
 *   row). Default true. Auto-fire waits for it; if it flips true later while
 *   the host is focused and present, the moment fires then.
 *
 * Losing focus or presence cancels the moment if it's the one showing — this
 * is what clears the overlay when a notification tap or deep link navigates
 * away underneath it (the scrim blocks touches, not programmatic navigation).
 * Cancel runs only on a TRANSITION (effect deps), so a host that is already
 * absent when a ? replay reaches its moment doesn't kill the replay.
 */
import { useEffect } from "react"
import { useIsFocused } from "@react-navigation/native"

import { useCoach } from "./CoachContext"

/**
 * Settle delay before measuring. Covers the tab-switch transition and a
 * popup Modal's slide-in (~300 ms): measuring mid-animation spotlights where
 * the control WAS, and on iOS presenting our overlay Modal before the popup's
 * finishes presenting can fail to stack.
 */
export const COACH_SETTLE_MS = 450

export interface UseCoachMomentOptions {
  ready?: boolean
  present?: boolean
}

export function useCoachMoment(
  momentId: string,
  { ready = true, present = true }: UseCoachMomentOptions = {},
) {
  const isFocused = useIsFocused()
  const { requestAuto, cancelMoment } = useCoach()

  useEffect(() => {
    if (!isFocused || !present || !ready) return
    const timer = setTimeout(() => requestAuto(momentId), COACH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [isFocused, present, ready, momentId, requestAuto])

  useEffect(() => {
    if (isFocused && present) return
    cancelMoment(momentId)
  }, [isFocused, present, momentId, cancelMoment])
}
```

- [ ] **Step 4: Create the provider**

Create `app/coach/CoachProvider.tsx`:

```tsx
/**
 * Owns coach-mark run state. Mounted once in app.tsx, inside the store and
 * theme providers and around AppNavigator + the other global overlays, so
 * every screen, popup, AnnouncementGate and CoachMarkOverlay share it.
 *
 * Every decision is a pure function in coachMarkLogic.ts; this file only reads
 * live state and writes results. `runRef` mirrors `run` so two requests in the
 * same tick (e.g. two hosts focusing together) see each other synchronously.
 */
import { FC, PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AppState } from "react-native"
import { reaction } from "mobx"

import { COACH_MOMENTS, type CoachScreenId, type CoachTargetId } from "@/config/coachMoments"
import { useStores } from "@/models"
import { isTimerSessionActive } from "@/services/attendance"
import { logger } from "@/utils/logger"

import {
  advanceRun,
  cancelRunForMoment,
  isGateOpen,
  isMomentDue,
  replayQueueForScreen,
  skipRun,
  startRun,
  type CoachRun,
} from "./coachMarkLogic"
import { CoachContext, type CoachContextValue, type MeasureFn } from "./CoachContext"

const log = logger.child({ module: "Coach" })

export const CoachProvider: FC<PropsWithChildren> = function CoachProvider({ children }) {
  const { authenticationStore, configStore, profileStore } = useStores()

  const targetsRef = useRef(new Map<CoachTargetId, MeasureFn>())
  const runRef = useRef<CoachRun | null>(null)
  const announcementVisibleRef = useRef(false)
  const [run, setRunState] = useState<CoachRun | null>(null)

  const setRun = useCallback((next: CoachRun | null) => {
    runRef.current = next
    setRunState(next)
  }, [])

  const gateOpen = useCallback(
    () =>
      isGateOpen({
        isAuthenticated: authenticationStore.isAuthenticated,
        onboardingCompleted: profileStore.onboardingCompleted,
        outageMode: configStore.outageMode,
        timerSessionActive: isTimerSessionActive(),
        announcementVisible: announcementVisibleRef.current,
        running: runRef.current !== null,
        appActive: AppState.currentState === "active",
      }),
    [authenticationStore, configStore, profileStore],
  )

  const registerTarget = useCallback((id: CoachTargetId, measure: MeasureFn) => {
    targetsRef.current.set(id, measure)
    return () => {
      // Identity guard: a remounted host registers a new fn before the old
      // effect's cleanup runs; don't let the stale cleanup delete the new one.
      if (targetsRef.current.get(id) === measure) targetsRef.current.delete(id)
    }
  }, [])

  const measureTarget = useCallback(async (id: CoachTargetId) => {
    const measure = targetsRef.current.get(id)
    if (!measure) return null
    try {
      return await measure()
    } catch (e) {
      log.debug("Coach target measure failed", { targetId: id, error: String(e) })
      return null
    }
  }, [])

  const requestAuto = useCallback(
    (momentId: string) => {
      const moment = COACH_MOMENTS.find((m) => m.id === momentId)
      if (!moment || !gateOpen()) return
      const due = isMomentDue(moment, {
        seenIds: profileStore.seenCoachMomentIds.slice(),
        tipsEnabled: profileStore.coachTipsEnabled,
        attendanceEnabled: profileStore.attendanceEnabled,
      })
      if (!due) return
      log.debug("Coach moment starting", { momentId, forced: false })
      setRun(startRun([momentId], false))
    },
    [gateOpen, profileStore, setRun],
  )

  const replay = useCallback(
    (screen: CoachScreenId) => {
      if (!gateOpen()) return
      const queue = replayQueueForScreen(COACH_MOMENTS, screen, {
        attendanceEnabled: profileStore.attendanceEnabled,
      })
      log.debug("Coach replay", { screen, moments: queue.length })
      setRun(startRun(queue, true))
    },
    [gateOpen, profileStore, setRun],
  )

  const hasReplay = useCallback(
    (screen: CoachScreenId) =>
      replayQueueForScreen(COACH_MOMENTS, screen, {
        attendanceEnabled: profileStore.attendanceEnabled,
      }).length > 0,
    [profileStore],
  )

  const next = useCallback(
    (shown: boolean) => {
      const { run: nextRun, completedMomentId } = advanceRun(runRef.current, COACH_MOMENTS, shown)
      if (completedMomentId) profileStore.markCoachMomentSeen(completedMomentId)
      setRun(nextRun)
    },
    [profileStore, setRun],
  )

  const skip = useCallback(() => {
    const { completedMomentId, disableTips } = skipRun(runRef.current, COACH_MOMENTS)
    if (completedMomentId) profileStore.markCoachMomentSeen(completedMomentId)
    if (disableTips) profileStore.setCoachTipsEnabled(false)
    log.debug("Coach skipped", { momentId: completedMomentId, disableTips })
    setRun(null)
  }, [profileStore, setRun])

  const cancelMoment = useCallback(
    (momentId: string) => {
      const nextRun = cancelRunForMoment(runRef.current, COACH_MOMENTS, momentId)
      if (nextRun !== runRef.current) setRun(nextRun)
    },
    [setRun],
  )

  const setAnnouncementVisible = useCallback(
    (visible: boolean) => {
      announcementVisibleRef.current = visible
      // Announcements win (spec §4): one appearing mid-moment interrupts it
      // WITHOUT marking seen, so the moment re-fires on the next visit.
      if (visible && runRef.current) setRun(null)
    },
    [setRun],
  )

  // Outage takes over the navigator (MaintenanceScreen); a spotlight left up
  // would point at a screen that no longer exists. Not marked seen.
  useEffect(
    () =>
      reaction(
        () => configStore.outageMode,
        (outage) => {
          if (outage && runRef.current) setRun(null)
        },
      ),
    [configStore, setRun],
  )

  const value = useMemo<CoachContextValue>(
    () => ({
      run,
      registerTarget,
      measureTarget,
      requestAuto,
      cancelMoment,
      replay,
      hasReplay,
      next,
      skip,
      setAnnouncementVisible,
    }),
    [run, registerTarget, measureTarget, requestAuto, cancelMoment, replay, hasReplay, next, skip, setAnnouncementVisible],
  )

  return <CoachContext.Provider value={value}>{children}</CoachContext.Provider>
}
```

- [ ] **Step 5: Type check and dependency check**

Run: `npm run compile`
Expected: exits 0.

Run: `npm run lint:deps`
Expected: no new violations. `app/coach/` depends on `config`, `models`, `services/attendance` and `utils/logger`. No existing module imports `app/coach/` yet, so a cycle is impossible. An orphan warning for these files is expected until Task 7 mounts them. Ignore it only if it names these new files.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint --fix app/coach/CoachContext.ts app/coach/useCoachTarget.ts app/coach/useCoachMoment.ts app/coach/CoachProvider.tsx
git add app/coach/CoachContext.ts app/coach/useCoachTarget.ts app/coach/useCoachMoment.ts app/coach/CoachProvider.tsx
git commit -m "✨ feat(coach): coach provider, target and moment hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Callout card + overlay

**Files:**
- Create: `app/coach/CoachCallout.tsx`
- Test: `app/coach/CoachCallout.test.tsx`
- Create: `app/coach/CoachMarkOverlay.tsx`

**Interfaces:**
- Consumes: from Task 4, `useCoach()`. From Task 2, `computeCallout`, `currentStep`, `cutoutFor`, `isRectOnScreen` and `Rect`. From Task 1, `COACH_MOMENTS`.
- Produces:
  - `<CoachCallout titleTx bodyTx stepIndex total isLast forced onNext onSkip arrowSide arrowX />`
  - `<CoachMarkOverlay />`, which takes no props

- [ ] **Step 1: Write the failing callout test**

Create `app/coach/CoachCallout.test.tsx`:

```tsx
/**
 * CoachCallout is the presentational half of the overlay: the parts a user
 * reads and taps. The run machine behind it is vitest-covered in
 * coachMarkLogic.test.ts. i18n is mocked in test/setup.ts to return
 * "<key> <params>", so labels are matched by key.
 */
import { AccessibilityInfo } from "react-native"
import { fireEvent, render, screen } from "@testing-library/react-native"

import { CoachCallout } from "./CoachCallout"

describe("CoachCallout", () => {
  const base = {
    titleTx: "coach:moments.home.tabBar.title" as const,
    bodyTx: "coach:moments.home.tabBar.body" as const,
    stepIndex: 0,
    total: 2,
    isLast: false,
    forced: false,
    arrowSide: "top" as const,
    arrowX: 40,
    onNext: jest.fn(),
    onSkip: jest.fn(),
  }

  beforeEach(() => jest.clearAllMocks())

  it("shows Next and Skip tips mid-chain", () => {
    render(<CoachCallout {...base} />)
    expect(screen.getByText(/coach:next/)).toBeTruthy()
    expect(screen.getByText(/coach:skip/)).toBeTruthy()
  })

  it("shows Got it on the last step", () => {
    render(<CoachCallout {...base} stepIndex={1} isLast />)
    expect(screen.getByText(/coach:gotIt/)).toBeTruthy()
  })

  it("says Close instead of Skip tips on a ? replay", () => {
    render(<CoachCallout {...base} forced />)
    expect(screen.getByText(/coach:close/)).toBeTruthy()
    expect(screen.queryByText(/coach:skip/)).toBeNull()
  })

  it("hides the step counter for a one-step moment", () => {
    render(<CoachCallout {...base} total={1} isLast />)
    expect(screen.queryByTestId("coach-step-of")).toBeNull()
  })

  it("wires Next and Skip", () => {
    render(<CoachCallout {...base} />)
    fireEvent.press(screen.getByTestId("coach-next"))
    fireEvent.press(screen.getByTestId("coach-skip"))
    expect(base.onNext).toHaveBeenCalledTimes(1)
    expect(base.onSkip).toHaveBeenCalledTimes(1)
  })

  it("is an accessibility-modal card whose buttons are buttons", () => {
    render(<CoachCallout {...base} />)
    expect(screen.getByTestId("coach-callout").props.accessibilityViewIsModal).toBe(true)
    expect(screen.getByTestId("coach-next").props.accessibilityRole).toBe("button")
    expect(screen.getByTestId("coach-skip").props.accessibilityRole).toBe("button")
  })

  it("moves screen-reader focus to the title when the step appears", () => {
    render(<CoachCallout {...base} />)
    expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(expect.anything(), "focus")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:component -- app/coach/CoachCallout.test.tsx`
Expected: FAIL, because it cannot find `./CoachCallout`.

- [ ] **Step 3: Implement the callout**

Create `app/coach/CoachCallout.tsx`:

```tsx
/**
 * The coach-mark callout card. Presentational only — everything arrives as a
 * prop — so it can be jest-tested without the provider, stores, or a Modal.
 */
import { FC, useEffect, useRef } from "react"
import { AccessibilityInfo, Pressable, TextStyle, View, ViewStyle } from "react-native"

import { Text } from "@/components/Text"
import type { TxKeyPath } from "@/i18n"
import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"

const ARROW_SIZE = 14

export interface CoachCalloutProps {
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  stepIndex: number
  total: number
  isLast: boolean
  /** Started from a ? button: secondary button reads "Close", not "Skip tips". */
  forced: boolean
  arrowSide: "top" | "bottom"
  /** Arrow centre from the card's left edge (computeCallout). */
  arrowX: number
  onNext: () => void
  onSkip: () => void
}

export const CoachCallout: FC<CoachCalloutProps> = function CoachCallout({
  titleTx,
  bodyTx,
  stepIndex,
  total,
  isLast,
  forced,
  arrowSide,
  arrowX,
  onNext,
  onSkip,
}) {
  const { themed } = useAppTheme()
  const titleRef = useRef<View>(null)

  // Screen readers: land on the title each time a new step appears, so the
  // reading order is title → body → counter → buttons. Keyed on titleTx
  // because the card stays mounted between steps.
  useEffect(() => {
    const node = titleRef.current
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, "focus")
  }, [titleTx])

  return (
    <View style={themed($card)} testID="coach-callout" accessibilityViewIsModal>
      {/* Arrow: a rotated square half-tucked under the card edge facing the target. */}
      <View
        style={[
          themed($arrow),
          arrowSide === "top" ? $arrowTop : $arrowBottom,
          { left: arrowX - ARROW_SIZE / 2 },
        ]}
        importantForAccessibility="no"
        accessibilityElementsHidden
      />

      <View ref={titleRef} accessible accessibilityRole="header">
        <Text preset="subheading" tx={titleTx} />
      </View>
      <Text style={themed($body)} tx={bodyTx} />

      {total > 1 && (
        <Text
          testID="coach-step-of"
          style={themed($stepOf)}
          tx="coach:stepOf"
          txOptions={{ n: stepIndex + 1, total }}
        />
      )}

      <View style={$buttonRow}>
        <Pressable testID="coach-skip" onPress={onSkip} accessibilityRole="button" hitSlop={8}>
          <Text style={themed($skipText)} tx={forced ? "coach:close" : "coach:skip"} />
        </Pressable>
        <Pressable
          testID="coach-next"
          onPress={onNext}
          accessibilityRole="button"
          style={themed($nextButton)}
        >
          <Text style={themed($nextText)} tx={isLast ? "coach:gotIt" : "coach:next"} />
        </Pressable>
      </View>
    </View>
  )
}

const $card: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.card,
  borderRadius: 16,
  padding: spacing.md,
  gap: spacing.xs,
})

const $arrow: ThemedStyle<ViewStyle> = ({ colors }) => ({
  position: "absolute",
  width: ARROW_SIZE,
  height: ARROW_SIZE,
  backgroundColor: colors.card,
  transform: [{ rotate: "45deg" }],
})

const $arrowTop: ViewStyle = { top: -ARROW_SIZE / 2 }
const $arrowBottom: ViewStyle = { bottom: -ARROW_SIZE / 2 }

const $body: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  lineHeight: 21,
  color: colors.text,
})

const $stepOf: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
})

const $buttonRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginTop: 4,
}

const $skipText: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 15,
  fontWeight: "600",
  color: colors.textDim,
})

const $nextButton: ThemedStyle<ViewStyle> = ({ colors, spacing }) => ({
  backgroundColor: colors.tint,
  borderRadius: 10,
  paddingVertical: spacing.xs,
  paddingHorizontal: spacing.md,
})

// Same pairing AnnouncementGate uses for text on a tint button.
const $nextText: ThemedStyle<TextStyle> = ({ colors }) => ({
  color: colors.background,
  fontSize: 15,
  fontWeight: "700",
})
```

- [ ] **Step 4: Run the callout test**

Run: `npm run test:component -- app/coach/CoachCallout.test.tsx`
Expected: PASS (7 tests). RN's jest preset mocks `AccessibilityInfo.sendAccessibilityEvent` as a `jest.fn()`, and the last test relies on that.

- [ ] **Step 5: Implement the overlay**

Create `app/coach/CoachMarkOverlay.tsx`:

```tsx
/**
 * Draws the running coach-mark step: a dimmed screen with a rounded hole
 * around the target, and a callout card beside it. Mounted ONCE in app.tsx.
 *
 * Renders its own transparent <Modal>, not an absolute View: an RN Modal is a
 * separate native window, so a plain View could never cover SchedulePopup /
 * InPersonPopup and their targets would be spotlit UNDER the popup (spec
 * planning amendment §3). The Modal also swallows every touch and hides the
 * app beneath from screen readers, which is the behaviour we want.
 *
 * Scrim: one "donut" View — the cutout rect grown by B on each side, with
 * borderWidth B and borderRadius r + B, so its inner hole has corner radius
 * exactly r. With B ≥ the window diagonal the outer edge is off-screen. No
 * react-native-svg needed (that would be a native dep → store release).
 *
 * Motion: RN Animated (useNativeDriver:false — left/top/width/height/
 * borderRadius are layout props). Reanimated is deliberately not used; nothing
 * in app/ uses it and babel has no worklets plugin.
 */
import { FC, useCallback, useEffect, useRef, useState } from "react"
import { AccessibilityInfo, Animated, Modal, StyleSheet, useWindowDimensions } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { COACH_MOMENTS } from "@/config/coachMoments"
import { useAppTheme } from "@/theme/context"

import { CoachCallout } from "./CoachCallout"
import {
  computeCallout,
  currentStep,
  cutoutFor,
  isRectOnScreen,
  type Rect,
} from "./coachMarkLogic"
import { useCoach } from "./CoachContext"

const SCRIM_COLOR = "rgba(0, 0, 0, 0.72)"
const SCRIM_FADE_MS = 220
const CARD_OUT_MS = 120
const CARD_IN_MS = 180
/** Used to place the card before its real height has been measured (it is invisible until then). */
const CARD_HEIGHT_GUESS = 160

interface Cutout {
  rect: Rect
  radius: number
}

export const CoachMarkOverlay: FC = function CoachMarkOverlay() {
  const { run, measureTarget, next, skip } = useCoach()
  const { theme } = useAppTheme()
  const window = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const cur = currentStep(run, COACH_MOMENTS)

  const [cutout, setCutout] = useState<Cutout | null>(null)
  const [cardHeight, setCardHeight] = useState<number | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)

  // Border thickness of the donut. Must cover the whole window from any hole.
  const border = Math.ceil(Math.hypot(window.width, window.height)) + 1

  const hole = useRef({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    w: new Animated.Value(0),
    h: new Animated.Value(0),
    r: new Animated.Value(0),
    outerR: new Animated.Value(0),
  }).current
  const scrimOpacity = useRef(new Animated.Value(0)).current
  const cardOpacity = useRef(new Animated.Value(0)).current
  const scrimShownRef = useRef(false)

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {})
  }, [])

  const moveHole = useCallback(
    (c: Cutout) => {
      const targets: [Animated.Value, number][] = [
        [hole.x, c.rect.x],
        [hole.y, c.rect.y],
        [hole.w, c.rect.width],
        [hole.h, c.rect.height],
        [hole.r, c.radius],
        [hole.outerR, c.radius + border],
      ]
      // First step of a run (or reduced motion): jump. Later steps: the hole
      // springs from the previous target to the next — the "sleek" moment.
      if (!scrimShownRef.current || reduceMotion) {
        targets.forEach(([v, to]) => v.setValue(to))
      } else {
        Animated.parallel(
          targets.map(([v, to]) =>
            Animated.spring(v, { toValue: to, friction: 9, tension: 60, useNativeDriver: false }),
          ),
        ).start()
      }
      if (!scrimShownRef.current) {
        scrimShownRef.current = true
        Animated.timing(scrimOpacity, {
          toValue: 1,
          duration: reduceMotion ? 0 : SCRIM_FADE_MS,
          useNativeDriver: true,
        }).start()
      }
    },
    [hole, border, reduceMotion, scrimOpacity],
  )

  // Measure the current step's target whenever the step or window changes.
  // Keyed on a string, not `cur` (a fresh object every render).
  const stepKey = cur ? `${cur.moment.id}:${cur.stepIndex}` : null
  useEffect(() => {
    if (!cur) {
      setCutout(null)
      scrimShownRef.current = false
      scrimOpacity.setValue(0)
      return
    }
    let cancelled = false
    // NOT resetting cardHeight here on purpose: onLayout only fires when the
    // card's layout CHANGES, so two consecutive cards of equal height would
    // leave it null forever and the card would never fade in. The previous
    // height is a fine first placement; onLayout corrects it if it differs.
    cardOpacity.setValue(0)
    measureTarget(cur.step.targetId).then((raw) => {
      if (cancelled) return
      // Never dim around nothing: unregistered, 0×0 (hidden segment) or
      // off-screen (below the fold) targets skip this step, unmarked.
      if (!isRectOnScreen(raw, window)) {
        next(false)
        return
      }
      const c = cutoutFor(raw, cur.step.cutout ?? "rounded")
      moveHole(c)
      setCutout(c)
    })
    return () => {
      cancelled = true
    }
    // `cur`, `next`, `measureTarget`, `moveHole` are read but not deps: the
    // step identity is `stepKey`, and re-running on their identity would
    // re-measure (and re-animate) the same step on every provider render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, window.width, window.height])

  // Fade the card in once its real height is known and it's been re-placed.
  useEffect(() => {
    if (!cutout || cardHeight === null) return
    Animated.timing(cardOpacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : CARD_IN_MS,
      useNativeDriver: true,
    }).start()
  }, [cutout, cardHeight, reduceMotion, cardOpacity])

  const handleNext = useCallback(() => {
    if (reduceMotion) {
      next(true)
      return
    }
    Animated.timing(cardOpacity, {
      toValue: 0,
      duration: CARD_OUT_MS,
      useNativeDriver: true,
    }).start(() => next(true))
  }, [reduceMotion, cardOpacity, next])

  if (!run || !cur || !cutout) return null

  const layout = computeCallout(
    cutout.rect,
    window,
    insets,
    cur.step.placement ?? "auto",
    cardHeight ?? CARD_HEIGHT_GUESS,
  )

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Android back = Next, never "lose the whole chain" to a reflex.
      onRequestClose={handleNext}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: scrimOpacity }]} pointerEvents="none">
        <Animated.View
          style={[
            $hole,
            {
              left: hole.x,
              top: hole.y,
              width: hole.w,
              height: hole.h,
              borderRadius: hole.r,
              // Thin tint ring so the edge reads as designed, not sliced.
              borderColor: theme.colors.tint + "66",
            },
          ]}
        >
          <Animated.View
            style={[
              $donut,
              {
                top: -border,
                left: -border,
                right: -border,
                bottom: -border,
                borderWidth: border,
                borderRadius: hole.outerR,
              },
            ]}
          />
        </Animated.View>
      </Animated.View>

      <Animated.View
        style={[$card, { left: layout.x, top: layout.y, width: layout.width, opacity: cardOpacity }]}
        // Unconditional: a same-value setState is a no-op, and a changed
        // height re-places the card via computeCallout on the next render.
        onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
      >
        <CoachCallout
          titleTx={cur.step.titleTx}
          bodyTx={cur.step.bodyTx}
          stepIndex={cur.stepIndex}
          total={cur.total}
          isLast={cur.isLast}
          forced={run.forced}
          arrowSide={layout.arrowSide}
          arrowX={layout.arrowX}
          onNext={handleNext}
          onSkip={skip}
        />
      </Animated.View>
    </Modal>
  )
}

const $hole = {
  position: "absolute" as const,
  borderWidth: 2,
  // The donut child extends far past this box; Android must not clip it.
  overflow: "visible" as const,
}

const $donut = {
  position: "absolute" as const,
  borderColor: SCRIM_COLOR,
}

const $card = {
  position: "absolute" as const,
}
```

Note: `theme.colors.tint + "66"` gives 40 % alpha when the tint is a `#RRGGBB` hex. The default is `"#FF10F0"`. A user-chosen `themeColor` also comes from the picker as hex. If `tint` is ever a non-hex string, the ring just renders fully opaque, which is harmless.

- [ ] **Step 6: Type check and run the component tests**

Run: `npm run compile`
Expected: exits 0.

Run: `npm run test:component -- app/coach/`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
npx eslint --fix app/coach/CoachCallout.tsx app/coach/CoachCallout.test.tsx app/coach/CoachMarkOverlay.tsx
git add app/coach/CoachCallout.tsx app/coach/CoachCallout.test.tsx app/coach/CoachMarkOverlay.tsx
git commit -m "✨ feat(coach): spotlight overlay and callout card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The ? help button

**Files:**
- Create: `app/coach/CoachHelpButton.tsx`
- Test: `app/coach/CoachHelpButton.test.tsx`

**Interfaces:**
- Consumes: from Task 4, `useCoach()`, `CoachContext`, `NOOP_COACH` and `useCoachTarget`. From Task 1, `CoachScreenId` and `CoachTargetId`.
- Produces: `<CoachHelpButton screen={CoachScreenId} targetId?={CoachTargetId} />`. It renders `null` when there is nothing to replay. Its testID is `coach-help-<screen>`.

- [ ] **Step 1: Write the failing test**

Create `app/coach/CoachHelpButton.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native"

import { CoachHelpButton } from "./CoachHelpButton"
import { CoachContext, NOOP_COACH, type CoachContextValue } from "./CoachContext"

function renderWith(value: Partial<CoachContextValue>) {
  return render(
    <CoachContext.Provider value={{ ...NOOP_COACH, ...value }}>
      <CoachHelpButton screen="meetings" />
    </CoachContext.Provider>,
  )
}

describe("CoachHelpButton", () => {
  it("renders nothing when the screen has no eligible moments", () => {
    renderWith({ hasReplay: () => false })
    expect(screen.queryByTestId("coach-help-meetings")).toBeNull()
  })

  it("renders nothing outside a CoachProvider (no-op default)", () => {
    render(<CoachHelpButton screen="meetings" />)
    expect(screen.queryByTestId("coach-help-meetings")).toBeNull()
  })

  it("replays the screen's moments on press", () => {
    const replay = jest.fn()
    renderWith({ hasReplay: () => true, replay })
    fireEvent.press(screen.getByTestId("coach-help-meetings"))
    expect(replay).toHaveBeenCalledWith("meetings")
  })

  it("is a labelled button", () => {
    renderWith({ hasReplay: () => true })
    const button = screen.getByTestId("coach-help-meetings")
    expect(button.props.accessibilityRole).toBe("button")
    expect(button.props.accessibilityLabel).toMatch(/coach:helpButtonLabel/)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:component -- app/coach/CoachHelpButton.test.tsx`
Expected: FAIL, because it cannot find `./CoachHelpButton`.

- [ ] **Step 3: Implement**

Create `app/coach/CoachHelpButton.tsx`:

```tsx
/**
 * The ? button on each coached screen: replays every moment for that screen,
 * ignoring seen state and the "Show tips automatically" preference (an
 * explicit ask). Sized and coloured to match the existing header glyphs
 * (AttendanceScreen's settings icon: 22 px, textDim, hitSlop 8).
 *
 * Renders null when the screen has nothing eligible to replay (e.g. Attendance
 * moments with attendance off, or SchedulePopup before it has any moments).
 * `observer` because hasReplay() reads profileStore.attendanceEnabled.
 *
 * `targetId` lets the button itself be a spotlight target (Home's
 * "Tips on demand" step).
 */
import { FC } from "react"
import { Pressable, View } from "react-native"
import { Ionicons } from "@expo/vector-icons"
import { observer } from "mobx-react-lite"

import type { CoachScreenId, CoachTargetId } from "@/config/coachMoments"
import { translate } from "@/i18n"
import { useAppTheme } from "@/theme/context"

import { useCoach } from "./CoachContext"
import { useCoachTarget } from "./useCoachTarget"

export interface CoachHelpButtonProps {
  screen: CoachScreenId
  targetId?: CoachTargetId
}

export const CoachHelpButton: FC<CoachHelpButtonProps> = observer(function CoachHelpButton({
  screen,
  targetId,
}) {
  const { replay, hasReplay } = useCoach()
  const { theme } = useAppTheme()
  const ref = useCoachTarget(targetId)

  if (!hasReplay(screen)) return null

  return (
    <View ref={ref} collapsable={false}>
      <Pressable
        testID={`coach-help-${screen}`}
        onPress={() => replay(screen)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={translate("coach:helpButtonLabel")}
      >
        <Ionicons name="help-circle-outline" size={22} color={theme.colors.textDim} />
      </Pressable>
    </View>
  )
})
```

- [ ] **Step 4: Run the test**

Run: `npm run test:component -- app/coach/CoachHelpButton.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint --fix app/coach/CoachHelpButton.tsx app/coach/CoachHelpButton.test.tsx
git add app/coach/CoachHelpButton.tsx app/coach/CoachHelpButton.test.tsx
git commit -m "✨ feat(coach): ? button to replay a screen's tips

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mount the provider and overlay; announcements take precedence

**Files:**
- Modify: `app/app.tsx`, the provider tree (~lines 1236–1262) and the imports (~line 41).
- Modify: `app/components/AnnouncementGate.tsx`

**Interfaces:**
- Consumes: from Tasks 4–5, `CoachProvider`, `CoachMarkOverlay` and `useCoach().setAnnouncementVisible`.

- [ ] **Step 1: Mount in `app.tsx`**

Add imports next to the existing `AnnouncementGate` / `MaintenanceBanner` imports (keep the file's relative-import style):

```ts
import { CoachMarkOverlay } from "./coach/CoachMarkOverlay"
import { CoachProvider } from "./coach/CoachProvider"
```

Wrap the `<ToastProvider>` children in `<CoachProvider>`, and add `<CoachMarkOverlay />` after `<AnnouncementGate />`:

```tsx
                    <ToastProvider>
                      {/* First-use coach marks (app/coach/). The provider wraps
                          the navigator AND the global overlays so screens,
                          popups, AnnouncementGate and the overlay share one run
                          state. It sits inside RootStoreProvider (reads
                          profile/auth/config stores) and ThemeProvider. */}
                      <CoachProvider>
                        <DatabaseLoadingOverlay />
                        <AppNavigator
                          linking={linking}
                          initialState={initialNavigationState}
                          onStateChange={onNavigationStateChange}
                        />
                        {/* …keep the existing MaintenanceBanner / TimerRecoveryGate comments and elements unchanged… */}
                        <MaintenanceBanner />
                        <TimerRecoveryGate />
                        <AnnouncementGate />
                        {/* Last so its Modal presents above AnnouncementGate's if
                            both ever race; the provider's gate normally keeps
                            them mutually exclusive (announcements win). */}
                        <CoachMarkOverlay />
                      </CoachProvider>
                    </ToastProvider>
```

Keep the existing multi-line comments above `<MaintenanceBanner />` and `<TimerRecoveryGate />` exactly as they are. The only change there is one extra level of indentation.

- [ ] **Step 2: Report announcement visibility**

In `app/components/AnnouncementGate.tsx`, add this import with the other `@/` imports:

```ts
import { useCoach } from "@/coach/CoachContext"
```

Inside the component, directly after `const [active, setActive] = useState<Announcement | null>(null)`, add:

```ts
  // Coach marks yield to announcements (one overlay at a time). Reporting
  // visibility also interrupts a coach moment already on screen — unmarked,
  // so it re-fires next visit. See CoachProvider.setAnnouncementVisible.
  const { setAnnouncementVisible } = useCoach()
  useEffect(() => {
    setAnnouncementVisible(active !== null)
  }, [active, setAnnouncementVisible])
```

- [ ] **Step 3: Verify**

Run: `npm run compile`
Expected: exits 0.

Run: `npm test`
Expected: vitest and jest both PASS.

Run: `npm run lint:deps`
Expected: no violations. The earlier orphan warnings for `app/coach/*` are gone now.

- [ ] **Step 4: Lint and commit**

```bash
npx eslint --fix app/app.tsx app/components/AnnouncementGate.tsx
git add app/app.tsx app/components/AnnouncementGate.tsx
git commit -m "✨ feat(coach): mount coach provider and overlay; announcements take precedence

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wire Home, the tab bar, and the Meetings segments

**Files:**
- Modify: `app/navigators/MainNavigator.tsx`
- Modify: `app/screens/HomeScreen.tsx`, the header at ~line 215
- Modify: `app/screens/MeetingsScreen.tsx`
- Modify: `app/screens/LiveScreen.tsx`: props at ~56–66, `renderItem` at ~249
- Modify: `app/screens/InPersonScreen.tsx`, next to `showMapToggleNow` at ~line 1233
- Modify: `app/components/InPersonListHeader.tsx`, the toggle wrapper at ~line 334

**Interfaces:**
- Consumes: `useCoachTarget`, `useCoachMoment` and `CoachHelpButton` (Tasks 4 and 6).
- Produces: registered targets `tabBar`, `home.helpButton`, `meetings.segments`, `meetings.liveRow` and `inperson.viewToggle`, plus the `home`, `meetings` and `inperson` moments. `LiveContent` gains an optional `visible?: boolean` prop (default `true`).

- [ ] **Step 1: Tab bar target**

In `app/navigators/MainNavigator.tsx`:
- Change the bottom-tabs import to `import { BottomTabBar, type BottomTabBarProps, createBottomTabNavigator } from "@react-navigation/bottom-tabs"`.
- Add `useCallback` to the `react` import.
- Add `import { useCoachTarget } from "@/coach/useCoachTarget"` in the `@/` group.

Inside the component, after `const { liveMeetings } = useMeetings()`:

```tsx
  // Coach-mark target for Home's "Find your way around" tip. The default tab
  // bar has no ref to hang a target on, so we render the stock BottomTabBar
  // inside a measurable wrapper — same component, same props, same layout.
  // collapsable={false}: Android would otherwise flatten the wrapper away.
  const tabBarRef = useCoachTarget("tabBar")
  const renderTabBar = useCallback(
    (props: BottomTabBarProps) => (
      <View ref={tabBarRef} collapsable={false}>
        <BottomTabBar {...props} />
      </View>
    ),
    [tabBarRef],
  )
```

Add `tabBar={renderTabBar}` to `<Tab.Navigator ...>`, directly after `initialRouteName`.

- [ ] **Step 2: Home: ? button and moment**

In `app/screens/HomeScreen.tsx`, add these imports:

```ts
import { CoachHelpButton } from "@/coach/CoachHelpButton"
import { useCoachMoment } from "@/coach/useCoachMoment"
```

Add near the other hooks at the top of the component body:

```ts
  // First-use tips: tab bar orientation, then the ? replay affordance.
  useCoachMoment("home")
```

Replace the header:

```tsx
      <View style={$header}>
        <Text preset="heading" tx="homeScreen:title" />
        {/* ? replays this screen's tips; it is also the target of the "Tips
            on demand" step. $header is already row + space-between. */}
        <CoachHelpButton screen="home" targetId="home.helpButton" />
      </View>
```

- [ ] **Step 3: Meetings: segments target, ? button, Live visibility**

In `app/screens/MeetingsScreen.tsx`, add these imports:

```ts
import { CoachHelpButton } from "@/coach/CoachHelpButton"
import { useCoachTarget } from "@/coach/useCoachTarget"
```

In the component body, after `const { themed } = useAppTheme()`:

```ts
  // Coach-mark target: the Live / In-Person / Search control.
  const segmentsRef = useCoachTarget("meetings.segments")
```

Replace the header block:

```tsx
      {/* Segment Control + ? (replays the Meetings and In-Person tips) */}
      <View style={themed($header)}>
        <View ref={segmentsRef} collapsable={false} style={$segmentsWrap}>
          <SegmentedControl
            segments={SEGMENTS}
            selectedIndex={selectedIndex}
            onChange={handleSegmentChange}
          />
        </View>
        <CoachHelpButton screen="meetings" />
      </View>
```

Pass visibility to Live:

```tsx
        <LiveContent meetingId={route.params?.meetingId} visible={activeSegment === "live"} />
```

Update the styles:

```ts
const $header: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  paddingVertical: spacing.sm,
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.sm,
})

const $segmentsWrap: ViewStyle = {
  flex: 1,
}
```

- [ ] **Step 4: Live: first-row target and `meetings` moment**

In `app/screens/LiveScreen.tsx`, add these imports:

```ts
import { useCoachMoment } from "@/coach/useCoachMoment"
import { useCoachTarget } from "@/coach/useCoachTarget"
```

Extend the props:

```ts
interface LiveContentProps {
  meetingId?: string
  /**
   * Whether Live is the on-screen Meetings segment. All three segments stay
   * mounted (display:none), so coach marks need this to avoid spotlighting a
   * hidden row. Defaults true for callers that don't host segments.
   */
  visible?: boolean
}
```

Destructure `visible = true` alongside `meetingId: _meetingId`. After `sortedMeetings` is defined, and before any `return`, add:

```ts
  // Coach marks: the "meetings" moment spotlights the segment control, then
  // the first live row. It waits for a row to exist (ready) so the second
  // step isn't always skipped on a quiet hour — a moment only counts as seen
  // if something rendered.
  const liveRowRef = useCoachTarget("meetings.liveRow", visible)
  useCoachMoment("meetings", { present: visible, ready: visible && sortedMeetings.length > 0 })
```

Change `renderItem` to wrap only the first row:

```tsx
  const renderItem = useCallback(
    ({ item, index }: { item: MeetingWithTrex; index: number }) => {
      // Use displayFeedback for live UI updates (doesn't affect sort order)
      const feedback = displayFeedback.get(item.id)
      const row = (
        <MeetingRow
          meeting={item}
          rating={feedback?.rates ?? 0}
          isFavorite={feedback?.loves ?? false}
          hasReminder={meetingHasReminder(item, reminderLookup)}
          onPress={() => handleMeetingPress(item)}
        />
      )
      // First row doubles as the "Join in one tap" coach-mark target.
      if (index !== 0) return row
      return (
        <View ref={liveRowRef} collapsable={false}>
          {row}
        </View>
      )
    },
    [handleMeetingPress, displayFeedback, reminderLookup, liveRowRef],
  )
```

- [ ] **Step 5: In-Person: toggle target and `inperson` moment**

In `app/components/InPersonListHeader.tsx`, add this import:

```ts
import { useCoachTarget } from "@/coach/useCoachTarget"
```

Inside the component body, after the props destructure:

```ts
  // Coach-mark target: the list/map toggle. Registered only while the toggle
  // renders (location on + map configured). Imports only the store-free
  // CoachContext, so this component's jest test needs no provider.
  const viewToggleRef = useCoachTarget("inperson.viewToggle", showMapToggle)
```

Attach the ref to the existing `<View>` that wraps `MapListToggle` (the `<View>` directly inside `$controlsRow`):

```tsx
            <View ref={viewToggleRef} collapsable={false}>
              {showMapToggle && (
                <MapListToggle
```

In `app/screens/InPersonScreen.tsx`, add this import:

```ts
import { useCoachMoment } from "@/coach/useCoachMoment"
```

Put the hook directly after the `const showMapToggleNow = showMapToggle && profileStore.locationEnabled` line. That line is above the component's only `return`, at ~1239.

```ts
  // Coach marks: "See it on a map" — only once the toggle actually renders
  // (location on), which is usually a later visit than the first one.
  useCoachMoment("inperson", { present: visible, ready: visible && showMapToggleNow })
```

- [ ] **Step 6: Verify**

Run: `npm run compile`
Expected: exits 0.

Run: `npm test`
Expected: PASS. `InPersonListHeader.test.tsx` and `MapListToggle.test.tsx` must still pass with no changes, because the default context is a no-op.

- [ ] **Step 7: Visual check on a simulator**

Run: `npm run ios`. Then check:
- Home heading row shows **?** at the right, with the same size and colour as other header glyphs.
- The Meetings segmented control shares its row with **?** and does not clip.
- The tab bar looks unchanged, including its height and the Meetings badge.

To see the tips as a new user: Settings → reset onboarding (or delete the app), finish onboarding, and land on Home. Expected: after ~0.5 s the tab bar is spotlit with the card above it, then Next → the **?** is spotlit with a circle cutout → Got it. Open Meetings with a live meeting present: segments → first row. Tap **?** on Meetings: the same chain replays, and the In-Person step skips silently while Live is showing.

- [ ] **Step 8: Lint and commit**

```bash
npx eslint --fix app/navigators/MainNavigator.tsx app/screens/HomeScreen.tsx app/screens/MeetingsScreen.tsx app/screens/LiveScreen.tsx app/screens/InPersonScreen.tsx app/components/InPersonListHeader.tsx
git add app/navigators/MainNavigator.tsx app/screens/HomeScreen.tsx app/screens/MeetingsScreen.tsx app/screens/LiveScreen.tsx app/screens/InPersonScreen.tsx app/components/InPersonListHeader.tsx
git commit -m "✨ feat(coach): tips for Home, tab bar, Meetings and In-Person

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the popups, Attendance, and Settings (+ Show tips row)

**Files:**
- Modify: `app/components/InPersonPopup.tsx`: hooks at ~130–140, header close button at ~731, I'm Here at ~946
- Modify: `app/components/SchedulePopup.tsx`, the header close button at ~604
- Modify: `app/screens/AttendanceScreen.tsx`: `NewListHeader` send button at ~157, screen hooks at ~925, `$headerActions` at ~1025
- Modify: `app/screens/SettingsScreen.tsx`: title at ~834, `useSubscription()` at ~309, App Settings section at ~1203–1264, Cloud Backup row at ~1385

**Interfaces:**
- Consumes: `useCoachTarget`, `useCoachMoment` and `CoachHelpButton`. From Task 3, `profileStore.coachTipsEnabled` and `setCoachTipsEnabled`.
- Produces: targets `inperson.imHere`, `attendance.send` and `settings.cloudBackup`; moments `inpersonPopup`, `attendance` and `settings`; and the Settings "Show tips automatically" switch.

- [ ] **Step 1: InPersonPopup**

Add these imports:

```ts
import { CoachHelpButton } from "@/coach/CoachHelpButton"
import { useCoachMoment } from "@/coach/useCoachMoment"
import { useCoachTarget } from "@/coach/useCoachTarget"
```

Directly after the auto-close `useEffect` that follows `const isFocused = useIsFocused()` (~line 140), and so before the `if (!meeting) return null` early return, add:

```ts
  // Coach marks: "Log your attendance" points at I'm Here. Present only while
  // the popup is open, so closing it (or the tab blurring, which closes it)
  // cancels a showing tip. I'm Here sits at the bottom of this card's
  // ScrollView — on a long card it may be below the fold, in which case the
  // step skips and the moment stays unseen for a later popup.
  const imHereRef = useCoachTarget("inperson.imHere", visible && profileStore.attendanceEnabled)
  useCoachMoment("inpersonPopup", {
    present: visible,
    ready: visible && profileStore.attendanceEnabled,
  })
```

Put the ref directly on the I'm Here `Pressable` (Pressable forwards its ref to a View):

```tsx
              <Pressable
                ref={imHereRef}
                onPress={handleImHere}
```

In the header, directly before the close-button `<Pressable onPress={onClose} ...>` (the one with the `chevron-down` icon), add:

```tsx
              <CoachHelpButton screen="inPersonPopup" />
```

- [ ] **Step 2: SchedulePopup**

Add `import { CoachHelpButton } from "@/coach/CoachHelpButton"`. Directly before `{/* Close button */}` in the header, add:

```tsx
            {/* ? for this popup's tips. Renders nothing until a
                "schedulePopup" moment is added to app/config/coachMoments.ts
                (queued: details → join → reminder bell). */}
            <CoachHelpButton screen="schedulePopup" />
```

- [ ] **Step 3: Attendance**

Add these imports:

```ts
import { CoachHelpButton } from "@/coach/CoachHelpButton"
import { useCoachMoment } from "@/coach/useCoachMoment"
import { useCoachTarget } from "@/coach/useCoachTarget"
```

In `NewListHeader`, after `const configStore = useConfigStore()`:

```ts
  // Coach-mark target: Send Report. Only renders for entitled users; for
  // everyone else the ref stays unattached, the step skips, and the moment
  // stays unseen (harmless — it just re-checks on the next visit).
  const sendRef = useCoachTarget("attendance.send")
```

Wrap the Send Report `TouchableOpacity` (and nothing else) in a measurable View:

```tsx
          {/* Send Report Button (wrapper = coach-mark target) */}
          <View ref={sendRef} collapsable={false}>
            <TouchableOpacity
              ...unchanged...
            </TouchableOpacity>
          </View>
```

In `AttendanceScreen`, directly after the `useState<AttendanceSection>(...)` declaration:

```ts
    // Coach marks: the Send tip lives on the "new" section.
    useCoachMoment("attendance", {
      present: activeSection === "new",
      ready: activeSection === "new",
    })
```

In `$headerActions`, make the **?** the first child (before the `__DEV__` add button):

```tsx
          <View style={$headerActions}>
            <CoachHelpButton screen="attendance" />
```

- [ ] **Step 4: Settings**

Add these imports:

```ts
import { CoachHelpButton } from "@/coach/CoachHelpButton"
import { useCoachMoment } from "@/coach/useCoachMoment"
import { useCoachTarget } from "@/coach/useCoachTarget"
```

Directly after the `} = useSubscription()` line (~309):

```ts
  // Coach marks: Cloud Backup (entitled users only — the section doesn't
  // render otherwise). The row is usually below the fold on first visit, in
  // which case the step skips and the moment stays unseen until a visit where
  // it's on screen, or until the user taps ?.
  const cloudBackupRef = useCoachTarget("settings.cloudBackup", hasAttendance)
  useCoachMoment("settings", { ready: hasAttendance })
```

Replace the title line `<Text preset="heading" tx="settingsScreen:title" />` with:

```tsx
      <View style={$headerRow}>
        <Text preset="heading" tx="settingsScreen:title" />
        <CoachHelpButton screen="settings" />
      </View>
```

On the Cloud Backup row, add the ref to the existing row View:

```tsx
          <View
            ref={cloudBackupRef}
            collapsable={false}
            style={[themed($settingsRow), themed($lastRow)]}
          >
```

In the App Settings section, directly before `{/* Reset Home Tips */}`, add:

```tsx
        {/* Show tips automatically — first-use coach marks (app/coach/).
            OFF stops auto tips only; every screen's ? still replays them. */}
        <View style={themed($settingsRow)}>
          <View style={$styles.flex1}>
            <Text style={themed($rowLabel)} tx="coach:settingsAutoTips" />
            <Text style={themed($rowHint)} tx="coach:settingsAutoTipsHint" />
          </View>
          <Switch
            value={profileStore.coachTipsEnabled}
            onValueChange={profileStore.setCoachTipsEnabled}
            trackColor={{ false: "#E5E5E5", true: themeColor || theme.colors.tint }}
            thumbColor="#FFFFFF"
            accessibilityLabel={translate("coach:settingsAutoTips")}
          />
        </View>
```

Add at the bottom of the file's style declarations:

```ts
const $headerRow: ViewStyle = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
}
```

If `ViewStyle` isn't already imported from `react-native` in this file, add it to that import.

- [ ] **Step 5: Verify**

Run: `npm run compile`
Expected: exits 0.

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Visual check on a simulator**

- **Attendance** (attendance on, entitled): **?** sits left of the gear. The Send button's layout is unchanged. On first visit, the Send tip shows.
- **Settings:** **?** sits right of the title. "Show tips automatically" appears in App Settings above Reset Home Tips. Toggling it persists across a relaunch.
- **In-Person popup:** **?** sits left of the chevron. With attendance on, **?** spotlights I'm Here above the popup, not under it. Verify this on **both** iOS and Android. It is the Modal-stacking case.
- **SchedulePopup:** no **?** renders yet, as expected.

- [ ] **Step 7: Lint and commit**

```bash
npx eslint --fix app/components/InPersonPopup.tsx app/components/SchedulePopup.tsx app/screens/AttendanceScreen.tsx app/screens/SettingsScreen.tsx
git add app/components/InPersonPopup.tsx app/components/SchedulePopup.tsx app/screens/AttendanceScreen.tsx app/screens/SettingsScreen.tsx
git commit -m "✨ feat(coach): tips for In-Person popup, Attendance and Settings; auto-tips switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Docs, changelog, full verification, manual checklist

**Files:**
- Modify: `CHANGELOG.md`, under `## [Unreleased]` → `### Added`
- Modify: `docs/translation-review-2026-08-03.md`
- Modify: `CLAUDE.md`, the "Smaller Subsystems" list

- [ ] **Step 1: CHANGELOG**

Under `## [Unreleased]` → `### Added` (create the `### Added` heading if it is missing), add:

```markdown
- **First-use tips (coach marks).** The first time someone reaches Home,
  Meetings, In-Person, an In-Person meeting's popup, Attendance, or Settings,
  the screen dims around one key control and a short card explains it (tab
  bar, Live/In-Person/Search, joining a live meeting, the map toggle, I'm Here,
  Send Report, Cloud Backup). Every coached screen has a **?** in its header
  that replays its tips any time. People already using the app see nothing new
  unless they tap **?**. Settings → App Settings → *Show tips automatically*
  turns the automatic tips off. JS-only (`app/coach/`,
  `app/config/coachMoments.ts`).
```

- [ ] **Step 2: Translation review queue**

Append a section to `docs/translation-review-2026-08-03.md`:

```markdown
## 2026-09-25 — `coach` namespace (first-use tips)

All eight non-English locales carry English placeholders for every key under
`coach` (`skip`, `close`, `next`, `gotIt`, `stepOf`, `helpButtonLabel`,
`settingsAutoTips`, `settingsAutoTipsHint`, and `coach.moments.*`). Titles
should stay around four words and bodies around two short lines — the callout
card is at most 360 px wide. `stepOf` keeps the `{{n}}` / `{{total}}`
placeholders.
```

- [ ] **Step 3: CLAUDE.md subsystem note**

In `CLAUDE.md` → "Smaller Subsystems (know they exist before rebuilding one)", add a bullet after the Announcements bullet:

```markdown
- **Coach marks** (`app/coach/`, `app/config/coachMoments.ts`) — first-use
  spotlight tips plus a **?** replay button per coached screen. To add a tip:
  add a `CoachTargetId`, `useCoachTarget()` on the control (plain wrapper
  Views need `collapsable={false}`), append the moment/step to the registry,
  add `coach.moments.*` strings in all nine locales, and `useCoachMoment()` on
  the host. Moment ids are MMKV-permanent — never rename one. A new id fires
  for existing users too; only ids present at first launch of the introducing
  bundle were seeded as seen (`seedSeenOnHydrate`). The overlay is its own
  `Modal` (so it covers popups) and never dims around a missing, hidden or
  off-screen target. JS-only; spec
  `docs/superpowers/specs/2026-09-25-first-use-coach-marks-design.md`.
```

- [ ] **Step 4: Full verification**

Run: `npm run compile`
Expected: exits 0.

Run: `npm test`
Expected: vitest PASS (including `coachMoments.test.ts` and `coachMarkLogic.test.ts`), then jest PASS (including `CoachCallout.test.tsx` and `CoachHelpButton.test.tsx`, plus the existing 8).

Run: `npm run lint:deps`
Expected: no violations.

Run: `git diff --name-only root...HEAD | grep -E '\.(ts|tsx)$' | xargs npx eslint`
Expected: no errors in the touched files.

Run: `git diff root...HEAD -- app.json`
Expected: empty, which confirms that `runtimeVersion` and `version` were not touched.

- [ ] **Step 5: Manual checklist (device or simulator, both platforms where noted)**

Each item below was not provable by an automated test.

1. **Fresh user.** Delete the app, install, and onboard. Home auto-shows the tab-bar step, then the ? step. Finishing marks it seen, and a relaunch shows nothing.
2. **Existing user, the OTA seed (Review Focus 4).**
   - Setup: build the pre-change commit on a simulator and onboard. Then install this branch over it without deleting the app.
   - Expected: no tip appears anywhere.
   - Loki/console shows `Seeded coach moments as seen for existing user` once, and not on the second launch.
   - Tapping **?** on Home still replays.
3. **Skip tips.**
   - On an automatic tip, Skip → Settings shows "Show tips automatically" OFF, and no further auto tips appear.
   - **?** still works, and its secondary button reads **Close**.
   - Close does not flip the switch.
4. **Programmatic navigation (Review Focus 1).**
   - Setup: with a Home tip showing, trigger a push-notification tap (or `npx uri-scheme open recoverysky-app://… --ios`) that navigates to Meetings.
   - Expected: the overlay disappears, and Home's moment is still unseen (it shows again on the next Home visit).
5. **Hidden segment (Review Focus 2).** On Meetings → Live, tap **?**. Segments and the live row show. The In-Person toggle step skips without a flash or a dimmed empty frame.
6. **Below the fold (Review Focus 3).** On Settings, with an entitled account, the auto tip does not appear on first visit (the Cloud Backup row is below the fold). Scroll so the row is visible, then tap **?**: Cloud Backup is spotlit.
7. **Announcement precedence.** Temporarily append a test entry to `ANNOUNCEMENTS`, relaunch on Home as a fresh user: the announcement shows first, and the coach tip appears only after it is dismissed and Home refocuses. Revert the test entry.
8. **Popup stacking.** On **iOS and Android**, open an In-Person meeting popup with attendance on: the I'm Here tip draws **above** the popup, and the cutout lines up with the button.
9. **Cutout alignment.** On **Android** (edge-to-edge) check that the cutout sits exactly on each target and is not offset by the status-bar height. If it is offset, record the delta and stop. Do not guess a fix; report it.
10. **Rotation / split screen (iPad or Android tablet).** Rotate mid-step: the hole re-measures and re-centres.
11. **Reduce Motion ON.** Steps jump instantly, with no springs or fades.
12. **VoiceOver / TalkBack.** Focus lands on the tip title. Swiping goes title → body → counter → Skip → Next, and never reaches the app behind the scrim.
13. **Timer lock.** With an external-Zoom timer running, no tip auto-fires, and **?** does nothing.
14. **Dark mode and a custom theme color.** The card, ring and buttons stay legible.

- [ ] **Step 6: Commit docs**

```bash
git add CHANGELOG.md docs/translation-review-2026-08-03.md CLAUDE.md
git commit -m "📝 docs(coach): changelog, translation queue, subsystem note

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
