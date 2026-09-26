# First-use coach marks (contextual tutorial) — design

**Date:** 2026-09-25
**Status:** Approved design, awaiting implementation plan. JS-only → OTA (no
`runtimeVersion` bump; no new native dependency).

## Goal

A brand-new user who never reads a tutorial still discovers the app's key
actions — joining a Live meeting, In-Person "I'm Here", sending an Attendance
report — within their first few sessions. Existing users updating over OTA see
**nothing** unless they ask.

Chosen shape: **contextual coaching**, not an upfront tour. A tip appears the
first time the user reaches a screen or feature, as a **spotlight + callout**:
the screen dims except a cutout around the target control and a small card
beside it explains it. Each screen that has tips carries a **?** button that
replays them on demand.

The list of tips is a **living registry** and will grow (Search segment,
SchedulePopup, Reminders are already queued). The architecture is judged on
one thing: adding tip #8 must be a data entry plus two hook calls, never a new
component.

## Non-goals

- No upfront swipeable tour. Onboarding (`app/screens/onboarding/`) is
  untouched.
- No changes to Home's "Getting Started" `HELP_CARDS`; they stay as the
  self-serve companion for existing users.
- No coaching of Zoom join (the timer modal explains itself), theme/language
  (onboarding steps), or Search filters on first ship (dense UI; a spotlight
  would be noise). Search is a queued registry entry, not a design change.
- No third-party coach-mark library: `react-native-copilot` / `rn-tourguide`
  want `react-native-svg` (not installed → native dep → store release), fight
  the theme, and treat a11y as an afterthought.

## Existing pieces this builds on

- `seenAnnouncementIds` / `AnnouncementGate` / `announcements.ts` — the
  one-time-seen registry pattern, and the gate rules (authenticated,
  onboarded, no outage, no active timer) that a coach mark needs too.
- `MaintenanceBanner` / `AnnouncementGate` mount as siblings of
  `<AppNavigator />` in `app.tsx`'s provider tree with absolute positioning
  and high `zIndex`; the overlay mounts the same way.
- Tab screens draw their own in-body heading (`headerShown: false` in
  `MainNavigator.tsx`); `AttendanceScreen` already has a right-side icon row
  (`$headerActions`). The **?** goes in that slot on every coached screen.
- `react-native-reanimated ~4.1.1` is present; `react-native-svg`, `expo-blur`
  and `@gorhom/bottom-sheet` are not and must not be added for this.

## 1. Data model & registry

`app/config/coachMoments.ts` — pure data, mirrors `announcements.ts`. It must
stay free of runtime `@/` and native value imports so vitest can load it
(type-only imports are fine).

```ts
/** Closed union: a typo in a registry entry or a useCoachTarget() call is a compile error. */
export type CoachTargetId =
  | "tabBar"
  | "meetings.segments"
  | "meetings.liveRow"
  | "inperson.viewToggle"
  | "inperson.imHere"
  | "attendance.send"
  | "settings.cloudBackup"

/** The screens that own a ? button. */
export type CoachScreenId =
  | "home"
  | "meetings"
  | "attendance"
  | "settings"
  | "schedulePopup"
  | "inPersonPopup"

export interface CoachStep {
  targetId: CoachTargetId
  titleTx: TxKeyPath
  bodyTx: TxKeyPath
  /** Where the callout sits relative to the cutout. Default "auto" (pure logic decides). */
  placement?: "auto" | "above" | "below"
  /** Cutout shape. Default "rounded". */
  cutout?: "rounded" | "pill" | "circle"
}

export interface CoachMoment {
  /** Stable id; this is what `seenCoachMomentIds` stores. Never rename a shipped id. */
  id: string
  /** The ? button that replays this moment. */
  screen: CoachScreenId
  /** ≥ 1. Multi-step chains are how a screen gets "expanded details". */
  steps: CoachStep[]
  /** Auto-fire and ? both skip the moment when unmet. */
  requires?: { attendanceEnabled?: boolean }
}

export const COACH_MOMENTS: CoachMoment[] = [ /* first-ship list below */ ]
```

Rules:

- **Seen state is per moment, not per step.** A moment is marked seen when the
  user taps **Got it** on the last step or **Skip tips** on any step. Leaving
  the screen, backgrounding the app, or an announcement/outage interrupting
  mid-chain does **not** mark it seen — it re-fires next visit from step 1.
- One screen may own several moments (Meetings owns `meetings`, `inperson`,
  and later `search`). Order in the array is the order the **?** replays them.
- A moment's `id` is a permanent contract with MMKV. Append new moments; never
  reuse or rename an id.

### First-ship moments

| id | screen | steps (targetId → gist) | requires |
|---|---|---|---|
| `home` | home | `tabBar` → "Everything lives in these four tabs; Meetings is where you'll spend most of your time." | — |
| `meetings` | meetings | `meetings.segments` → Live / In-Person / Search in one line each; `meetings.liveRow` → "Tap a meeting to see details and join in Zoom." | — |
| `inperson` | meetings | `inperson.viewToggle` → "Switch to the map to see what's near you." | — |
| `inpersonPopup` | inPersonPopup | `inperson.imHere` → "When you're at the venue, tap here to log your attendance." | — |
| `attendance` | attendance | `attendance.send` → "Records land here after a meeting. Send a report when you're ready." | `attendanceEnabled: true` |
| `settings` | settings | `settings.cloudBackup` → one line on opt-in backup. | — |

Queued (not in this ship, but the registry must make them trivial): `search`
(filters → day picker → results row), `schedulePopup` (details → join →
reminder bell), `reminders`.

## 2. Runtime: provider + two hooks

New self-contained folder `app/coach/`:

```
app/coach/
  CoachProvider.tsx       # context: target registry + running-moment state + actions
  useCoachTarget.ts       # a control registers itself as a spotlight target
  useCoachMoment.ts       # a screen asks for a moment to auto-fire when due
  CoachMarkOverlay.tsx    # the scrim + callout, mounted once in app.tsx
  CoachHelpButton.tsx     # the ? button
  coachMarkLogic.ts       # pure decisions, vitest-covered, zero runtime @/ imports
  coachMarkLogic.test.ts
  CoachMarkOverlay.test.tsx
  CoachHelpButton.test.tsx
```

### `CoachProvider`

Holds:

- `targets: Map<CoachTargetId, { ref: RefObject<View>, enabled: boolean }>`
- `running: { momentIds: string[]; momentIndex: number; stepIndex: number; forced: boolean } | null`
  — `momentIds` is a queue so the **?** can chain every moment for a screen.

Exposes: `registerTarget`, `unregisterTarget`, `setTargetEnabled`,
`start(momentIds, { force })`, `next()`, `skipAll()`, plus `running` for the
overlay.

`start()` refuses (no-op, debug log) when `running` is non-null, an
announcement modal is showing, `outageMode` is true, or
`isTimerSessionActive()` — regardless of `force`. Those are safety rules, not
preferences. `force` only bypasses `seenCoachMomentIds` and
`coachTipsEnabled`.

### `useCoachTarget(targetId, enabled = true)`

Returns a `ref` to spread onto the target `View` / `Pressable`. Registers on
mount, unregisters on unmount, calls `setTargetEnabled` when `enabled`
changes.

`enabled` exists because the Meetings segments stay **mounted** behind
`display: "none"` (see CLAUDE.md "Navigation"): a hidden target measures at a
real-looking rect on some platforms and zero on others. `InPersonContent`
passes `enabled: visible`; `LiveContent` passes `enabled: visible`. A
disabled target is treated as unmeasurable → its step is skipped.

### `useCoachMoment(momentId, ready = true)`

Called by the owning screen. On `useFocusEffect` (or the popup's `visible`
edge) **and** `ready` true, it asks the provider to `start([momentId])` if
`isMomentDue()` says so. `ready` is how a screen says "the target exists now":
`LiveContent` passes `ready: liveMeetings.length > 0` so the live-row step is
never attempted against an empty list. If `ready` flips true later while the
screen is still focused, the hook fires then — one attempt per focus.

### Measuring

At each step start the overlay calls `measureInWindow` on the target ref. A
missing ref, `enabled: false`, or a zero-width/height rect → the step is
**skipped** (`nextRunnableStep`). A moment whose every step skips is not
marked seen and the overlay never appears — never dim the screen around
nothing. Rects are re-measured on `Dimensions` change (rotation, split
screen).

### `coachMarkLogic.ts` (pure)

```ts
isMomentDue(moment, ctx: { seenIds; tipsEnabled; attendanceEnabled; gateOpen }): boolean
nextRunnableStep(steps, rects: Record<CoachTargetId, Rect | null>, from: number): number | null
computeCallout(cutout: Rect, screen: { width; height }, insets, placement, cardHeight): {
  x; y; width; arrowSide: "top" | "bottom"; arrowX
}
seedSeenOnHydrate(rawSnapshot: unknown, allMomentIds: string[]): string[] | null
replayQueueForScreen(moments, screen, ctx): string[]
```

## 3. Overlay UI

`<CoachMarkOverlay />` mounts **once** in `app.tsx`, sibling to
`<MaintenanceBanner />` and `<AnnouncementGate />`, absolute-positioned with a
`zIndex` above both, so targets inside `SchedulePopup` / `InPersonPopup`
(RN `Modal`s) can be spotlit without each modal hosting its own overlay.
Renders `null` when `running` is null — zero cost in the normal case.

- **Scrim:** four plain `Animated.View`s (top / bottom / left / right of the
  cutout) at `rgba(0,0,0,0.72)`. No SVG mask. Cutout = measured rect + 8 px
  padding, radius per `cutout` shape (`rounded` 12, `pill` = height/2,
  `circle` = max side/2). A 2 px border at `colors.tint` 40 % alpha on the
  cutout gives the "designed, not sliced" edge.
- **Callout card:** `colors.card` surface, radius 16, 16 px padding, max
  width 360, clamped to a 16 px screen gutter. Small arrow (rotated square)
  on the side facing the target. Contents, top to bottom: eyebrow
  `coach:stepOf` (`"1 / 3"`, `textDim`, hidden when a chain has one step),
  title (`preset="subheading"`), body (1–2 lines), button row: **Skip tips**
  (text button, left, `textDim`) and **Next** / **Got it** (filled tint,
  right).
- **Placement:** `computeCallout` puts the card below the cutout when there's
  ≥ card height + 24 px of room below, else above; `placement` overrides.
- **Motion (Reanimated):** scrim fades in over 220 ms. Between steps the four
  scrim views **spring** to the new cutout (position + size) and the card
  cross-fades (120 ms out / 180 ms in). Honors
  `AccessibilityInfo.isReduceMotionEnabled()` → instant jumps, no springs.
- **Input:** the scrim swallows all touches; tapping outside does **not**
  advance or dismiss (accidental dismissal of an unread tip is the classic
  coach-mark failure). Android hardware back = **Next** (never "lose the
  chain"). Only the two buttons act.
- **Interruption:** if `outageMode` flips true, a timer session starts, or an
  announcement wants to show while a moment is running, the overlay unmounts
  immediately without marking seen.

## 4. Gating, persistence & the OTA seed

### `ProfileStore` additions (MMKV-persisted props)

```ts
seenCoachMomentIds: types.optional(types.array(types.string), []),
coachTipsEnabled: types.optional(types.boolean, true),
```

Actions: `markCoachMomentSeen(id)`, `setCoachTipsEnabled(bool)`,
`resetCoachMoments()` (clears the list, re-enables). `resetOnboarding()` also
calls `resetCoachMoments()` so a re-onboarded user is treated as new.
`completeOnboarding()` is **not** changed — it pre-seeds announcements and
must **not** pre-seed coach moments (that would silence tips for the very
users they're for).

### Auto-fire gate

A moment starts automatically only when **all** hold:

1. `authStore.isAuthenticated`, `profileStore.onboardingCompleted`,
   `!configStore.outageMode`, `!isTimerSessionActive()` — identical to
   `AnnouncementGate`.
2. `profileStore.coachTipsEnabled`; `moment.id` not in
   `seenCoachMomentIds`; `moment.requires` satisfied.
3. No announcement modal showing; `running` is null — one overlay at a time,
   and **announcements win** (rarer, usually more important).
   `CoachProvider` mounts **above** `AnnouncementGate` in `app.tsx` and
   exposes `setAnnouncementVisible(bool)`; `AnnouncementGate` calls it in an
   effect on its own `visible` state. When it flips true mid-moment the
   overlay unmounts without marking seen (§3 "Interruption").
4. The owning screen is focused and `AppState` is `active`.

The **?** bypasses only rule 2.

### Quiet-by-default on OTA

In `setupRootStore`, before `applySnapshot`, call
`seedSeenOnHydrate(rawSnapshot, COACH_MOMENTS.map(m => m.id))`. It returns
the full id list **only** when the raw snapshot has `onboardingCompleted:
true` **and** lacks a `seenCoachMomentIds` key entirely — i.e. the first
launch on the new bundle for an already-onboarded user. Otherwise it returns
`null` (do nothing). Fresh installs have `onboardingCompleted: false` and so
receive every tip.

Consequence: a moment **appended later** fires for everyone, existing users
included — the right default for a genuinely new feature. If a future moment
should stay quiet for existing users, add `quietForExisting: true` to
`CoachMoment` and have `seedSeenOnHydrate` include those ids whenever
`onboardingCompleted` is true. Not built now; recorded here so it isn't
reinvented.

## 5. The **?** button & Settings

`<CoachHelpButton screen="meetings" />`:

- `Ionicons name="help-circle-outline"`, 22 px, `colors.textDim`, `hitSlop 8`
  — visually identical to Attendance's existing settings glyph.
- `accessibilityRole="button"`, `accessibilityLabel={t("coach:helpButtonLabel")}`.
- On press: `start(replayQueueForScreen(COACH_MOMENTS, screen, ctx), { force: true })`.
- Renders `null` when the screen has zero moments whose `requires` are met.
- Placed in the heading row of `HomeScreen`, `MeetingsScreen`,
  `AttendanceScreen`, `SettingsScreen`, and in the header of `SchedulePopup`
  and `InPersonPopup`.

**Settings → Preferences:** one new row, **"Show tips automatically"**, a
`Switch` bound to `coachTipsEnabled`. There is deliberately **no** "Replay
tips" row — the **?** buttons are replay, where it's useful.

## 6. i18n, accessibility, testing, shipping

### i18n (nine-file change)

Namespace `coach:`

- `skip`, `next`, `gotIt`, `stepOf` (`"{{n}} / {{total}}"`),
  `helpButtonLabel`, `settingsAutoTips`
- `moments.<momentId>.<stepKey>.title` / `.body`

English placeholder text in the other eight locales; add the keys to the
native-speaker review queue (`docs/translation-review-2026-08-03.md` or its
successor).

### Accessibility (first-class, per repo standard)

- On step open: `AccessibilityInfo.setAccessibilityFocus` on the callout
  title. Card has `accessibilityViewIsModal` so VoiceOver / TalkBack can't
  wander behind the scrim. Reading order: title → body → step-of → Skip →
  Next.
- Spotlit target is `importantForAccessibility="no-hide-descendants"` /
  `accessibilityElementsHidden` **while dimmed** — it's for looking at, not
  tapping.
- Reduce-motion honored (§3). Every color pair meets 4.5:1 on `colors.card`
  in both themes.

### Testing

- `coachMarkLogic.test.ts` (vitest): `isMomentDue` across every gate flag;
  `nextRunnableStep` skips null/zero rects and returns null when nothing is
  runnable; `computeCallout` above/below/clamp cases; `seedSeenOnHydrate`
  returns ids only for `onboardingCompleted: true` + missing key, `null` for
  fresh installs, `null` when the key already exists; `replayQueueForScreen`
  respects `requires`.
- `coachMoments.test.ts` (vitest): every step's `titleTx` / `bodyTx` resolves
  in `en`; ids unique; targets unique per moment.
- `CoachMarkOverlay.test.tsx` (jest-expo): two-step moment with stubbed rects
  → Next advances, Got it marks seen, Skip tips sets `coachTipsEnabled` false;
  a11y props present.
- `CoachHelpButton.test.tsx` (jest-expo): `null` when no eligible moments;
  calls `start` with `force`.
- `app/coach/CoachProvider.tsx` has no automated coverage by design (it
  imports `@/`); manual checklist in the plan covers: Meetings segments
  hidden-target skip, popup target under a `Modal`, announcement precedence,
  timer-session interruption, OTA seed on an existing install.

### Shipping

JS-only. `CHANGELOG.md` → `[Unreleased]` → `Added`. Ship via `npm run update`;
**no `runtimeVersion` bump.** Verify locally (`compile`, scoped `lint`,
`test`) — there is no CI.

## Decisions log

- **Contextual coaching over upfront tour** — Jenova, 2026-09-25.
- **Spotlight + callout over tooltip-only / bottom sheet** — recommended,
  accepted.
- **Central registry + single overlay (A)** over per-screen overlays (B) or a
  library (C) — accepted; the growing registry is the deciding factor.
- **Quiet by default for existing users** on the shipping OTA — Jenova.
- **? button per coached screen** as the replay mechanism, replacing a
  Settings "Replay tips" row — Jenova.
- **Scrim swallows outside taps; back = Next** — recommended, accepted.
