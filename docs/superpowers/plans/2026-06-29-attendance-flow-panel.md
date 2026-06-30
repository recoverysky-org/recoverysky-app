# Attendance Flow Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the external-Zoom attendance *timer* and the post-meeting *topic/host* capture into one continuous inline surface that morphs `timer → topic`, deleting the modal→panel handoff that has caused this session's freeze bugs.

**Architecture:** Split **content** from **container**. A new `AttendanceFlowPanel` (plain `<View>`, phase state machine) holds the flow and side effects; it's rendered **inline** by `SchedulePopup` (normal Join — no nested modal) and wrapped in a **single `<Modal>`** by `TimerRecoveryGate` (cold-start crash recovery — route-independent). The timer body is extracted from `ExternalZoomTimerModal` into a de-modaled `TimerCard`; the existing `TopicPromptContent` is reused as the topic body.

**Tech Stack:** React Native 0.81 / React 19, Expo 54, MobX-State-Tree, expo-sqlite + Drizzle, MMKV (`@/utils/storage`), react-native-keyboard-controller, Vitest (pure-logic unit tests) + Jest (`jest-expo`, component tests).

## Global Constraints

- **Vitest has NO `@/` alias and can't load native modules.** Pure-logic files under test MUST avoid `@/` *runtime* imports (`import type` is fine). Keep the phase logic dependency-free. (See `memory/vitest-no-path-alias.md`.)
- **Comments are mandatory and must move with the code.** This is the most race-prone area in the app; every invariant comment was a real bug. Migrate them verbatim and update them per the project's comment policy (CLAUDE.md "Comments").
- **No `runtimeVersion` bump.** This is JS-only (no native deps change) → ships as an OTA. Do NOT touch `app.json`.
- **Component conventions:** named React imports only (`import { FC, useState } ...`); no raw `Text`/`TextInput` from react-native (use `@/components`); wrap MST-consuming components in `observer()`; prefix unused vars with `_`.
- **`tx`/`translate` for all strings** — reuse existing `externalZoomTimer:*` and `topicPrompt:*` i18n keys; do not hardcode copy.
- **Preserve every invariant in the "Invariants" task checklist** (Task 7). Treat invariant-preservation as a first-class acceptance criterion.

Spec: `docs/superpowers/specs/2026-06-29-attendance-flow-panel-design.md`.

---

## File structure

- **Create** `app/components/attendanceFlowPhase.ts` — pure phase-decision helpers (no `@/` imports). Vitest-testable.
- **Create** `app/components/attendanceFlowPhase.test.ts` — Vitest tests for the above.
- **Create** `app/components/TimerCard.tsx` — the timer body (clock, Zoom launch, session persist/resume, Save/Cancel, 7-tap), de-modaled from `ExternalZoomTimerModal`. Plain `<View>`.
- **Create** `app/components/AttendanceFlowPanel.tsx` — orchestrator: holds `phase`, composes `TimerCard` + `TopicPromptContent`, owns the topic side effect + event coordination.
- **Modify** `app/components/TimerRecoveryGate.tsx` — render `<Modal><AttendanceFlowPanel/></Modal>` instead of `<ExternalZoomTimerModal>`.
- **Modify** `app/components/SchedulePopup.tsx` — render `<AttendanceFlowPanel>` inline; remove `<ExternalZoomTimerModal>`, `timerVisible`, and the `processed→setTopicActive` subscription; route `onClose` through the panel's cancel-guard while timing.
- **Delete** `app/components/ExternalZoomTimerModal.tsx` — after its body lives in `TimerCard` and both importers are repointed.
- **Reuse unchanged** `app/components/TopicPromptContent.tsx` — already a content `<View>`.

---

## Task 1: Pure phase-decision helpers (TDD)

**Files:**
- Create: `app/components/attendanceFlowPhase.ts`
- Test: `app/components/attendanceFlowPhase.test.ts`

**Interfaces:**
- Produces:
  - `type AttendancePhase = "timer" | "topic"`
  - `phaseAfterSave(valid: boolean, enableTopic: boolean): AttendancePhase | "done"`
  - `isTimerSaveable(phase: AttendancePhase, elapsedMs: number, minCreditMs: number): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// app/components/attendanceFlowPhase.test.ts
import { describe, expect, it } from "vitest"

import { isTimerSaveable, phaseAfterSave } from "./attendanceFlowPhase"

describe("phaseAfterSave", () => {
  it("goes to topic when the save is valid and topic capture is on", () => {
    expect(phaseAfterSave(true, true)).toBe("topic")
  })
  it("is done when topic capture is off, even if valid", () => {
    expect(phaseAfterSave(true, false)).toBe("done")
  })
  it("is done when the session was invalid, even if topic capture is on", () => {
    expect(phaseAfterSave(false, true)).toBe("done")
  })
})

describe("isTimerSaveable", () => {
  it("is true only in the timer phase at/over the credit threshold", () => {
    expect(isTimerSaveable("timer", 60000, 60000)).toBe(true)
    expect(isTimerSaveable("timer", 59999, 60000)).toBe(false)
  })
  it("is false in the topic phase regardless of elapsed", () => {
    expect(isTimerSaveable("topic", 999999, 60000)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/components/attendanceFlowPhase.test.ts`
Expected: FAIL — `Cannot find module './attendanceFlowPhase'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/components/attendanceFlowPhase.ts
/**
 * Pure phase-decision helpers for AttendanceFlowPanel. Kept free of `@/` runtime
 * imports so they're Vitest-testable (this repo has no `@/` alias in Vitest).
 */

export type AttendancePhase = "timer" | "topic"

/**
 * Phase to enter after a successful timer Save. The topic/host capture only
 * makes sense for a VALID session and when the user enabled meeting-topic
 * capture; otherwise the flow is done.
 */
export function phaseAfterSave(valid: boolean, enableTopic: boolean): AttendancePhase | "done" {
  return valid && enableTopic ? "topic" : "done"
}

/**
 * Whether a live timer session is worth confirming before discarding it — used
 * to guard SchedulePopup's close so an inline timer can't be silently dropped by
 * a stray backdrop tap (the timer modal used to block that tap).
 */
export function isTimerSaveable(
  phase: AttendancePhase,
  elapsedMs: number,
  minCreditMs: number,
): boolean {
  return phase === "timer" && elapsedMs >= minCreditMs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/components/attendanceFlowPhase.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/components/attendanceFlowPhase.ts app/components/attendanceFlowPhase.test.ts
git commit -m "✨ feat(attendance): pure phase-decision helpers for unified flow"
```

---

## Task 2: `TimerCard` — de-modal the timer body

Extract `ExternalZoomTimerModal`'s internals into a plain-`<View>` `TimerCard`, removing the `<Modal>` wrapper and reporting outcomes via callbacks instead of closing itself.

**Files:**
- Create: `app/components/TimerCard.tsx`
- Reference (copy from): `app/components/ExternalZoomTimerModal.tsx` (do NOT delete yet — Task 6)

**Interfaces:**
- Consumes: `saveTimerAttendance`, `saveTimerSession`, `loadTimerSession`, `clearTimerSession`, `EXTERNAL_MIN_CREDIT_MS` from `@/services/zoom`; `extractZoomMeetingNumber` from `@/services/zoom/useZoomMeeting`.
- Produces:
  - `interface TimerCardMeeting { id: string; name: string; url: string }`
  - `interface TimerCardProps { meeting: TimerCardMeeting; active: boolean; onSaved: (r: { attendanceId: string; valid: boolean }) => void; onCancelled: () => void; onElapsedChange?: (ms: number) => void }`
  - `export const TimerCard: FC<TimerCardProps>`
  - `export const EXTERNAL_TIMER_MIN_CREDIT_MS` (re-export of `EXTERNAL_MIN_CREDIT_MS` for the panel's close-guard math)

- [ ] **Step 1: Create `TimerCard.tsx` by porting `ExternalZoomTimerModal`**

Port `ExternalZoomTimerModal.tsx` into `TimerCard.tsx` with these exact transformations:

1. **Drop the `<Modal>` wrapper.** Return only the card content (`$overlay` → `$card` subtree). Remove `Modal`, `onRequestClose`, `transparent`, `animationType`, `statusBarTranslucent`, and the `$overlay`/`$backdrop` styles (the container — SchedulePopup or the recovery Modal — owns overlay/backdrop now).
2. **Rename the component** to `TimerCard`; change props to `TimerCardProps` above. Replace the `visible` prop with `active` (drives the launch/cleanup effect identically — keep the `[active, meetingId, meetingUrl, meetingName, uid]` dependency array shape, renamed from `visible`).
3. **Change the Save outcome:** in `handleSave`, where the original calls `onSaved(result.attendanceId)` / `onClose()`, instead call:
   - on `result.ok && result.attendanceId`: `onSaved({ attendanceId: result.attendanceId, valid: !!result.valid })`
   - on `!result.ok`: `onCancelled()`
   - Keep the long-attendance (>2h) Alert exactly as-is (it fires before reporting).
4. **Change Cancel:** `handleCancel`'s discard/below-threshold paths call `onCancelled()` instead of `onClose()`. Keep the confirm-above-threshold Alert (keepRunning / save / discard) verbatim.
5. **Report elapsed:** add `useEffect(() => { onElapsedChange?.(elapsed) }, [elapsed, onElapsedChange])` so the parent can compute the close-guard. (Keep `onElapsedChange` optional.)
6. **Keep verbatim** (these are load-bearing — copy comments too): the `id+url`-keyed launch effect (NOT `meeting`-object keyed); the persisted-session resume that does NOT re-launch Zoom; the `savingRef` synchronous double-tap lock; the 7-tap force-save; the `try/catch/finally` in `handleSave` (the catch that guarantees the card resolves — call `onCancelled()` in the catch instead of `onClose()`); AppState resync.
7. Keep the imports the card still needs (`saveTimerAttendance`, session helpers, `extractZoomMeetingNumber`, `EXTERNAL_MIN_CREDIT_MS`, theme, logger, `Text`, `Ionicons`, `Pressable`, `View`, `Alert`, `AppState`, `Linking`, `useTranslation`, `useAuthenticationStore`, `navigate`, `load`/`save`). Drop `Modal`/`StyleSheet` if now unused.
8. Add `export const EXTERNAL_TIMER_MIN_CREDIT_MS = EXTERNAL_MIN_CREDIT_MS`.

- [ ] **Step 2: Typecheck**

Run: `npm run compile`
Expected: PASS (0 errors). Fix any type mismatches in the new prop wiring.

- [ ] **Step 3: Lint**

Run: `npx eslint app/components/TimerCard.tsx`
Expected: clean (apply `--fix` for prettier if needed).

- [ ] **Step 4: Commit**

```bash
git add app/components/TimerCard.tsx
git commit -m "✨ feat(attendance): extract de-modaled TimerCard from ExternalZoomTimerModal"
```

---

## Task 3: `AttendanceFlowPanel` — the orchestrator

**Files:**
- Create: `app/components/AttendanceFlowPanel.tsx`

**Interfaces:**
- Consumes: `TimerCard`, `TimerCardMeeting`, `EXTERNAL_TIMER_MIN_CREDIT_MS` (Task 2); `phaseAfterSave`, `isTimerSaveable`, `AttendancePhase` (Task 1); `TopicPromptContent` (existing); `attendanceRepo`, `attendanceEvents` from `@/db`; `useProfileStore` from `@/models`; `logger`.
- Produces:
  - `interface AttendanceFlowPanelProps { meeting: TimerCardMeeting; active: boolean; onClose: () => void; onSaved?: (attendanceId: string) => void; requestCloseRef?: MutableRefObject<(() => boolean) | null> }`
  - `export const AttendanceFlowPanel: FC<AttendanceFlowPanelProps>`

- [ ] **Step 1: Implement the orchestrator**

```tsx
// app/components/AttendanceFlowPanel.tsx
import { FC, MutableRefObject, useCallback, useEffect, useRef, useState } from "react"
import { View } from "react-native"

import { attendanceEvents, attendanceRepo } from "@/db"
import { useProfileStore } from "@/models"
import { logger } from "@/utils/logger"

import {
  type AttendancePhase,
  isTimerSaveable,
  phaseAfterSave,
} from "./attendanceFlowPhase"
import { EXTERNAL_TIMER_MIN_CREDIT_MS, TimerCard, type TimerCardMeeting } from "./TimerCard"
import { TopicPromptContent } from "./TopicPromptContent"

const log = logger.child({ module: "AttendanceFlowPanel" })

interface AttendanceFlowPanelProps {
  meeting: TimerCardMeeting
  /** True while the flow should be live (mounted + running). */
  active: boolean
  /** Called when the whole flow is finished (saved+topic-resolved, or cancelled). */
  onClose: () => void
  /** Called once with the attendanceId on a successful timer Save (before topic). */
  onSaved?: (attendanceId: string) => void
  /**
   * The container (SchedulePopup) sets this ref to a function it can call when the
   * user tries to dismiss the surrounding popup. Returns true if the panel handled
   * the close (e.g. routed it through the timer's cancel-confirm), false if the
   * container should close normally. Lets an inline timer guard a stray backdrop tap.
   */
  requestCloseRef?: MutableRefObject<(() => boolean) | null>
}

/**
 * One continuous post-join surface: phase "timer" (clock + Save/Cancel) morphs in
 * place to phase "topic" (topic/host capture) — no modal teardown, no
 * attendanceEvents round-trip to trigger the next surface. See the design doc
 * (docs/superpowers/specs/2026-06-29-attendance-flow-panel-design.md).
 */
export const AttendanceFlowPanel: FC<AttendanceFlowPanelProps> = ({
  meeting,
  active,
  onClose,
  onSaved,
  requestCloseRef,
}) => {
  const profileStore = useProfileStore()
  const [phase, setPhase] = useState<AttendancePhase>("timer")
  // attendanceId carried from the timer Save into the topic phase.
  const savedAttendanceRef = useRef<{ id: string; mid: string } | null>(null)
  // Latest elapsed from TimerCard, for the close-guard.
  const elapsedRef = useRef(0)

  // Reset to the timer phase each time the flow (re)activates.
  useEffect(() => {
    if (active) {
      setPhase("timer")
      savedAttendanceRef.current = null
      elapsedRef.current = 0
    }
  }, [active])

  const handleTimerSaved = useCallback(
    ({ attendanceId, valid }: { attendanceId: string; valid: boolean }) => {
      onSaved?.(attendanceId)
      const next = phaseAfterSave(valid, profileStore.enableMeetingTopic)
      if (next === "topic") {
        savedAttendanceRef.current = { id: attendanceId, mid: meeting.id }
        setPhase("topic")
        return
      }
      // No topic capture → acknowledge now so the banner fires, then finish.
      attendanceEvents.emit({ type: "acknowledged", id: attendanceId, mid: meeting.id, valid: true })
      onClose()
    },
    [meeting.id, onClose, onSaved, profileStore.enableMeetingTopic],
  )

  const handleTimerCancelled = useCallback(() => {
    onClose()
  }, [onClose])

  const handleTopicSave = useCallback(
    async ({ topic, host }: { topic: string; host?: string }) => {
      const pending = savedAttendanceRef.current
      savedAttendanceRef.current = null
      if (!pending) {
        onClose()
        return
      }
      try {
        const result = await attendanceRepo.update(pending.id, {
          meetingTopic: topic,
          ...(host ? { meetingHost: host } : {}),
        })
        if (!result.ok) log.error("Failed to persist meeting topic/host", { id: pending.id })
      } catch (err) {
        log.error("Failed to persist meeting topic/host", { id: pending.id, error: String(err) })
      }
      attendanceEvents.emit({ type: "acknowledged", id: pending.id, mid: pending.mid, valid: true })
      onClose()
    },
    [onClose],
  )

  const handleTopicSkip = useCallback(() => {
    const pending = savedAttendanceRef.current
    savedAttendanceRef.current = null
    if (pending) {
      attendanceEvents.emit({ type: "acknowledged", id: pending.id, mid: pending.mid, valid: true })
    }
    onClose()
  }, [onClose])

  // Expose a guarded-close to the container. While timing with a saveable
  // session, return true (handled) — TimerCard's own Cancel/confirm owns the
  // teardown; the container must NOT tear us down underneath it.
  useEffect(() => {
    if (!requestCloseRef) return undefined
    requestCloseRef.current = () => {
      if (isTimerSaveable(phase, elapsedRef.current, EXTERNAL_TIMER_MIN_CREDIT_MS)) {
        // Defer the decision to the user via TimerCard's confirm by leaving the
        // panel open; the container should NOT close. (TimerCard already shows
        // the keep/save/discard Alert on its Cancel button.)
        return true
      }
      return false
    }
    return () => {
      requestCloseRef.current = null
    }
  }, [phase, requestCloseRef])

  if (!meeting) return null

  return (
    <View>
      {phase === "timer" ? (
        <TimerCard
          meeting={meeting}
          active={active}
          onSaved={handleTimerSaved}
          onCancelled={handleTimerCancelled}
          onElapsedChange={(ms) => {
            elapsedRef.current = ms
          }}
        />
      ) : (
        <TopicPromptContent
          active={phase === "topic"}
          meetingName={meeting.name}
          includeHost
          onSave={handleTopicSave}
          onSkip={handleTopicSkip}
        />
      )}
    </View>
  )
}
```

> **Keyboard-settle note:** `TopicPromptContent` does NOT itself run
> `dismissKeyboardAndSettle()` — today that lives in `SchedulePopup.handleTopicSave`
> *before the slide-out*. The slide-out is the CONTAINER's animation, so the
> settle must stay in the container (Task 5), not here. On the recovery container
> (Task 4) there's no keyboard-avoiding slide, so no settle is needed there.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run compile && npx eslint app/components/AttendanceFlowPanel.tsx`
Expected: PASS / clean.

- [ ] **Step 3: Commit**

```bash
git add app/components/AttendanceFlowPanel.tsx
git commit -m "✨ feat(attendance): AttendanceFlowPanel orchestrator (timer→topic phase machine)"
```

---

## Task 4: Wire `TimerRecoveryGate` to the panel (recovery container)

This is the simplest container and a good first integration — recovery wraps the panel in one Modal.

**Files:**
- Modify: `app/components/TimerRecoveryGate.tsx`

**Interfaces:**
- Consumes: `AttendanceFlowPanel` (Task 3).

- [ ] **Step 1: Replace the modal body**

Rewrite `TimerRecoveryGate.tsx` to wrap the panel in a single `<Modal>` (keeping the existing `useRecoverySession`/`setRecoverySession` wiring and the `meeting` memo):

```tsx
import { useCallback, useMemo } from "react"
import { Modal, StyleSheet, View } from "react-native"

import { setRecoverySession, useRecoverySession } from "@/services/zoom"
import { useAppTheme } from "@/theme/context"

import { AttendanceFlowPanel } from "./AttendanceFlowPanel"

export function TimerRecoveryGate() {
  const session = useRecoverySession()
  const { theme } = useAppTheme()

  const handleClose = useCallback(() => {
    setRecoverySession(null)
  }, [])

  const meeting = useMemo(() => {
    if (!session) return null
    return { id: session.meetingId, name: session.meetingName, url: session.meetingUrl }
  }, [session])

  if (!session || !meeting) return null

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent>
      <View
        style={[
          StyleSheet.absoluteFillObject,
          { backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "center", padding: 16 },
        ]}
      >
        <AttendanceFlowPanel
          meeting={meeting}
          active
          onClose={handleClose}
          onSaved={handleClose}
        />
      </View>
    </Modal>
  )
}
```

> Note: `onSaved={handleClose}` is harmless — `onClose` is what finishes the
> flow; `onSaved` just fires once on the timer Save (recovery still advances to
> the topic phase inside this same Modal before `onClose`).

- [ ] **Step 2: Typecheck + lint**

Run: `npm run compile && npx eslint app/components/TimerRecoveryGate.tsx`
Expected: PASS / clean.

- [ ] **Step 3: Manual verification (device/simulator)**

`ExternalZoomTimerModal` is still wired in SchedulePopup at this point, so the normal flow is unaffected. Verify recovery in isolation:
1. Join a meeting, let the timer run ~1 min, force-quit the app (swipe-kill).
2. Relaunch → the recovery Modal should appear with the resumed clock (Zoom NOT re-launched).
3. Tap Save → topic/host card appears in the same modal → Save → modal dismisses, no freeze.

- [ ] **Step 4: Commit**

```bash
git add app/components/TimerRecoveryGate.tsx
git commit -m "♻️ refactor(attendance): recovery gate uses AttendanceFlowPanel"
```

---

## Task 5: Wire `SchedulePopup` to the panel (normal container) + close-guard

The complex container. Replace the nested timer modal + inline topic panel with one inline `AttendanceFlowPanel`, delete the `processed→topic` handoff, and guard the popup close while timing.

**Files:**
- Modify: `app/components/SchedulePopup.tsx`

**Interfaces:**
- Consumes: `AttendanceFlowPanel` (Task 3).

- [ ] **Step 1: Swap imports + state**

In `SchedulePopup.tsx`:
- Add `import { AttendanceFlowPanel } from "@/components/AttendanceFlowPanel"`.
- Remove `import { ExternalZoomTimerModal } ...` and `import { TopicPromptContent } ...` (the panel composes them now).
- Keep `const [timerVisible, setTimerVisible] = useState(false)` BUT repurpose it as the panel's `active` flag (the panel needs an active/visible flag to launch). Rename to `const [flowActive, setFlowActive] = useState(false)` for clarity; update `proceedExternalJoin` (`SchedulePopup.tsx:~496`) to `setFlowActive(true)`.
- Remove `topicActive`/`setTopicActive` state and the `topicContextRef` (the panel owns the topic phase + attendanceId now). Keep `topicProgress`/`cardExpansion`/the slide Animated — that animation now drives the WHOLE panel (timer + topic) instead of just the topic panel. Drive it off `flowActive` instead of `topicActive` in the `Animated.parallel` effect (`SchedulePopup.tsx:~189-203`).

- [ ] **Step 2: Delete the `processed→topic` subscription, keep `acknowledged→banner`**

In the `attendanceEvents.subscribe` effect (`SchedulePopup.tsx:~284-324`): delete the entire `if (event.type === "processed" && event.valid) { ... setTopicActive(true) ... }` branch. Keep the `if (event.type === "acknowledged" && event.valid)` branch (the banner) unchanged. The panel now advances to topic internally and emits `acknowledged` itself.

- [ ] **Step 3: Remove `handleTopicSave`/`handleTopicSkip`; move the keyboard-settle into the close path**

- Delete `handleTopicSave` (`:551-598`) and `handleTopicSkip` (`:600-616`) — the panel owns topic persistence now.
- The reanimated-crash guard (`dismissKeyboardAndSettle()` BEFORE the slide-out) must NOT be lost. The panel calls `onClose` when the topic resolves; SchedulePopup's `onClose` for the flow must dismiss the keyboard and settle BEFORE running the slide-out. Implement the flow's close handler:

```tsx
// Closes the inline attendance flow: settle the keyboard FIRST (the topic phase
// may have it up), THEN slide the panel out — preserving the serialized
// hide→slide ordering that avoids the reanimated EXC_BAD_ACCESS commit crash
// (see CHANGELOG 4.5.0-4 / the old handleTopicSave comment).
const handleFlowClose = useCallback(async () => {
  await dismissKeyboardAndSettle()
  setFlowActive(false)
}, [])
```

- [ ] **Step 4: Render the panel inline; remove the two old surfaces**

- Delete the `<ExternalZoomTimerModal ... />` block (`SchedulePopup.tsx:~905-915`).
- Replace the inline `TopicPromptContent` render (the `active={topicActive}` block near `:889`) with the panel, mounted inside the same slide-up `Animated.View` the topic panel used:

```tsx
{flowActive && (
  <AttendanceFlowPanel
    meeting={{ id: meeting.id, name: meeting.name, url: meeting.url }}
    active={flowActive}
    onClose={handleFlowClose}
    requestCloseRef={flowRequestCloseRef}
  />
)}
```

Add the ref near the other refs: `const flowRequestCloseRef = useRef<(() => boolean) | null>(null)`.

- [ ] **Step 5: Route the popup close through the panel's guard**

The popup's existing dismissers — backdrop `Pressable onPress={onClose}` (`:589`), `onRequestClose={onClose}` (`:625`), and the focus-loss auto-close (`:116-118`) — must consult the panel while a timer session is live so a stray tap can't silently drop it. Wrap them:

```tsx
// While the inline timer is live with a saveable session, defer to the panel:
// it keeps itself open and the user uses the timer's own Cancel (keep/save/
// discard). Otherwise close normally.
const handlePopupClose = useCallback(() => {
  if (flowRequestCloseRef.current?.()) return
  onClose()
}, [onClose])
```

Replace the backdrop `onPress`, `onRequestClose`, and the focus-loss `onClose()` call with `handlePopupClose`. (Leave the rating `onDismiss={presentRatingAfterClose}` untouched.)

- [ ] **Step 6: Typecheck + lint**

Run: `npm run compile && npx eslint app/components/SchedulePopup.tsx`
Expected: PASS / clean. Resolve any now-unused imports/vars (prefix with `_` only if genuinely intentional; otherwise delete).

- [ ] **Step 7: Manual verification (device/simulator) — the core matrix**

1. **Happy path:** Join (attendance ON, topic ON) → timer card slides up → return from Zoom → Save → card morphs to topic/host (no freeze, no flicker) → enter topic → Save → panel slides out → "Attendance Saved" banner.
2. **Topic OFF:** same, Save → panel slides out directly, banner fires, no topic card.
3. **Cancel below threshold:** Join → Save disabled → Cancel → closes immediately.
4. **Cancel above threshold:** time ≥ credit → Cancel → keep/save/discard confirm.
5. **Close-while-timing guard:** time ≥ credit → tap the popup backdrop → it must NOT silently close; the session survives (use the timer's Cancel to keep/save/discard).
6. **No-freeze regression:** Save never hangs the timer; the rating soft-ask (if `REVIEW_ENABLED` + eligible) appears only AFTER the popup closes.
7. **Keyboard crash regression:** Save/Skip the topic with the keyboard up → no `EXC_BAD_ACCESS`.

- [ ] **Step 8: Commit**

```bash
git add app/components/SchedulePopup.tsx
git commit -m "♻️ refactor(attendance): SchedulePopup renders one inline AttendanceFlowPanel"
```

---

## Task 6: Delete `ExternalZoomTimerModal`

**Files:**
- Delete: `app/components/ExternalZoomTimerModal.tsx`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn "ExternalZoomTimerModal" app/`
Expected: only the file itself (both `SchedulePopup` and `TimerRecoveryGate` were repointed in Tasks 4-5). If anything else references it, repoint it to `AttendanceFlowPanel` first.

- [ ] **Step 2: Delete and verify the build**

```bash
git rm app/components/ExternalZoomTimerModal.tsx
npm run compile
```
Expected: compile PASS (0 errors).

- [ ] **Step 3: Commit**

```bash
git commit -m "🔥 chore(attendance): remove ExternalZoomTimerModal (folded into TimerCard)"
```

---

## Task 7: Invariant audit + full verification + changelog

A dedicated review pass — this area's bugs are timing/device-specific and mostly not unit-testable, so the audit IS the safety net.

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Invariant checklist (read the new code, confirm each holds)**

- [ ] Timer launch effect keyed on `id`+`url` (not the `meeting` object) — no clock restart / Zoom re-launch on re-render.
- [ ] Persisted-session resume adopts `startedAt` and does NOT re-launch Zoom.
- [ ] `savingRef` synchronous double-tap lock present in `TimerCard.handleSave`.
- [ ] 7-tap force-save preserved.
- [ ] `TimerCard.handleSave` keeps the `try/catch/finally`; the catch resolves the card (`onCancelled()`), never leaves it stuck.
- [ ] `meetingEvents.emit` / `attendanceEvents.emit` still isolate listeners (untouched this plan — confirm not regressed).
- [ ] `dismissKeyboardAndSettle()` runs BEFORE the slide-out in `SchedulePopup.handleFlowClose`.
- [ ] Rating soft-ask still presents on SchedulePopup close via `presentRatingAfterClose` (untouched).
- [ ] Long-attendance (>2h) Alert + "Don't show again" preserved in `TimerCard`.
- [ ] `attendanceEvents.processed` is still emitted by `saveTimerAttendance` for external consumers (AttendanceScreen list) — confirm AttendanceScreen still updates after a save.

- [ ] **Step 2: Full gate**

Run: `npm run compile && npm run test:unit && npx eslint app/components/`
Expected: compile PASS; vitest PASS (incl. `attendanceFlowPhase.test.ts`); eslint clean for the touched components (pre-existing `password` unused-var in SchedulePopup is out of scope — do not fix here).

- [ ] **Step 3: Changelog**

Add under `## [Unreleased]` in `CHANGELOG.md`:

```markdown
### Changed
- **External-Zoom attendance is now one continuous surface.** The post-join
  timer and the meeting topic/host capture were merged into a single inline
  panel that morphs timer → topic in place, instead of a modal that closed and
  handed off to a separate panel. This deletes the modal→panel seam that caused
  the recent Save-time freezes and keeps the whole flow visually coherent.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "📝 docs(attendance): changelog for unified attendance flow"
```

---

## Self-review (completed by plan author)

- **Spec coverage:** architecture (Tasks 2-5), phase machine (Tasks 1, 3), internal-transition simplification / delete `processed→topic` (Task 5 Step 2), recovery container (Task 4), close-while-timing guard (Tasks 3 + 5 Step 5), keyboard-settle preservation (Task 5 Step 3), deletions (Task 6), invariants + testing (Task 7). All spec sections map to a task.
- **Placeholder scan:** no TBD/"add error handling"/"similar to" — each step has concrete code or an exact transform + command.
- **Type consistency:** `TimerCardMeeting`, `TimerCardProps.onSaved({attendanceId, valid})`, `phaseAfterSave`, `isTimerSaveable`, `requestCloseRef` signatures are used identically across Tasks 1-5.
- **Known carve-out:** the pre-existing `const password` unused-var lint in `SchedulePopup.tsx` is explicitly out of scope (Task 7 Step 2).
```
