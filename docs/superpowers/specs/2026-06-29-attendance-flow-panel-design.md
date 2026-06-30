# Attendance Flow Panel — unify the external-Zoom timer + topic/host capture

**Status:** Design approved (2026-06-29). Implementation NOT started.

## Context & problem

The post-join attendance flow for external-Zoom meetings is currently **two
separate surfaces with a fragile handoff between them**:

1. **`ExternalZoomTimerModal`** — a *nested RN `<Modal>`* rendered inside
   `SchedulePopup`. Launches Zoom on mount, runs the session clock, offers
   Save / Cancel.
2. **`TopicPromptContent`** — an *inline `<View>`* that slides up *inside*
   `SchedulePopup` to capture the meeting topic (and host, for external joins).
   It was deliberately made inline (not a modal) to avoid an iOS modal-stacking
   race.

The transition is: timer Save → `saveTimerAttendance()` writes the record and
emits `attendanceEvents.processed` → `SchedulePopup` closes the timer modal
(`setTimerVisible(false)`) AND its `processed` subscription slides the topic
panel in. **That teardown→present seam is where the worst bugs of this codebase
live** — the timer-freeze-on-save (v4.5.0-7/-8/-9), the rating-prompt
modal-stacking freeze, and the keyboard/reanimated `EXC_BAD_ACCESS` crash all
cluster around it.

**Goal:** collapse the two surfaces into **one continuous inline surface** that
morphs `timer → topic`, deleting the modal handoff entirely.

### Goals

- One surface for the whole post-join flow; no nested modal in the normal path.
- Delete the `processed → topic` event round-trip that drives the handoff.
- Preserve **every** hard-won behavioral invariant (see "Invariants").
- Keep crash recovery working (it needs a route-independent surface).

### Non-goals

- Changing *what* is captured (topic/host fields, validity threshold, events).
- Changing the rating engine (already lands on popup-close; unaffected).
- Touching the SDK path (removed in 4.5.0 — external-only now).
- Fixing the `attendanceEnabled === false` "join bypasses timer" gap (separate).

## Architecture — one content component, two containers

The timer is used in **two** places today, which is why we can't literally
delete the modal:
- `SchedulePopup` (normal Join).
- `TimerRecoveryGate` at app root (cold-start crash recovery — no SchedulePopup
  exists on cold start, so it genuinely needs a route-independent surface).

Resolve by splitting **content** from **container**:

```
AttendanceFlowPanel  (NEW — content, a plain <View>, never its own Modal)
  ├─ phase state machine:  "timer" → "topic" → done
  ├─ TimerCard   (presentational — ExternalZoomTimerModal's body, de-modaled)
  └─ TopicCard   (presentational — reuse existing TopicPromptContent as the body)

Rendered by two containers:
  • SchedulePopup     → renders <AttendanceFlowPanel> INLINE (slide-up over body,
                        reusing the existing topic-panel slide mechanism).
                        No nested modal → the handoff bug class is gone.
  • TimerRecoveryGate → wraps <AttendanceFlowPanel> in a SINGLE <Modal>.
                        Route-independent (required). One morphing modal, no
                        handoff → not exposed to the stacking race.
```

`AttendanceFlowPanel` is the orchestrator: it holds the phase, runs the side
effects (`saveTimerAttendance`, `attendanceRepo.update`), and emits the events.
`TimerCard` / `TopicCard` stay split so each file is small and focused.

## Phase state machine & data flow

`phase: "timer" | "topic"`. The panel is shown/hidden by the container
(`active`/`visible`); on becoming active it starts in `"timer"`.

**Timer phase** (logic lifted from `ExternalZoomTimerModal`):
- On activate: launch Zoom via `Linking.openURL` (string-guarded), start the
  1s interval, `saveTimerSession()` for crash recovery, resync on AppState
  `active`.
- **Resume:** if a persisted session matches `id+url`, adopt its `startedAt`
  and DO NOT re-launch Zoom.
- **Save** (`elapsed >= EXTERNAL_MIN_CREDIT_MS`, or 7-tap force): `savingRef`
  guard → `saveTimerAttendance()` → writes record; emits
  `attendanceEvents.processed` (external consumers) + `meetingEvents.completed`
  (rating count); `clearTimerSession()`. Then:
  - if `profileStore.enableMeetingTopic && result.valid` → advance to `"topic"`,
    carrying `attendanceId`.
  - else → emit `acknowledged` immediately (banner) and finish.
- **Cancel:** below threshold → finish; above threshold → confirm Alert
  (keepRunning / save / discard), same as today.

**Topic phase** (reuse `TopicPromptContent` as the body):
- **Save** → `dismissKeyboardAndSettle()` → `attendanceRepo.update(attendanceId,
  {meetingTopic, meetingHost?})` → emit `acknowledged` → finish.
- **Skip** → `dismissKeyboardAndSettle()` → emit `acknowledged` → finish.

**Key simplification:** the panel advances `timer → topic` **internally**. The
`attendanceEvents.processed` event is still *emitted* (AttendanceScreen list and
any other external consumers are unaffected), but `SchedulePopup`'s
`processed → setTopicActive` subscription is **removed**. The
`acknowledged → banner` subscription stays in `SchedulePopup`.

## Edge cases & coordination

1. **Crash recovery (`TimerRecoveryGate`):** wraps the same panel in one
   `<Modal>`; starts in `"timer"` with the persisted (resumed) session; can
   still morph to `"topic"` inside that single modal (no handoff → safe). On
   finish/close → `setRecoverySession(null)`.
2. **Closing SchedulePopup while a timer session is live (NEW coordination):**
   today the timer modal sits on top and blocks the popup backdrop; inline, the
   backdrop/close is reachable. The popup's `onClose` (backdrop tap, hardware
   back, focus-loss auto-close at `SchedulePopup.tsx:116`) must **route through
   the panel's guarded cancel** (keep / save / discard) when the panel is in
   `"timer"` with `elapsed >= threshold`, instead of silently discarding a
   saveable session. The panel exposes its "busy/saveable" state (or a
   `requestClose()`); SchedulePopup consults it before tearing down. A persisted
   session means worst-case the session is still recoverable on next launch, but
   we confirm rather than drop.

## Invariants to preserve verbatim (each was a real bug once)

- Timer effect keyed on **`id` + `url`** (not the `meeting` object), or the
  clock restarts + Zoom re-launches on every parent re-render
  (`ExternalZoomTimerModal:108-119`).
- `savingRef` is the **authoritative synchronous** double-tap lock (state isn't
  synchronous).
- **7-tap force-save** shortcut (support escape hatch).
- Session **persistence + resume without re-launching Zoom**.
- **`dismissKeyboardAndSettle()` BEFORE the slide-out** in topic save/skip — the
  concurrent reanimated/layout commit `EXC_BAD_ACCESS` in `folly::dynamic::hash`
  (`SchedulePopup.tsx:556-568`).
- **Event-listener isolation** in `meetingEvents.emit` / `attendanceEvents.emit`
  (fixed this session — keep).
- **`handleSave` always closes** (catch added this session — the timer must
  never get stuck open).
- **Rating soft-ask presents on SchedulePopup close**, never mid-flow
  (`maybePresentRatingPrompt`). Unchanged by this refactor.
- Long-attendance (>2h) heads-up Alert behavior + "Don't show again" flag.

Migrate the associated explanatory comments along with the code — they are the
institutional memory for these races.

## What changes

- **NEW:** `app/components/AttendanceFlowPanel.tsx` (orchestrator + phase
  machine), `app/components/TimerCard.tsx` (timer body, de-modaled from
  `ExternalZoomTimerModal`). Reuse existing `TopicPromptContent` as the topic
  body.
- **`SchedulePopup.tsx`:** remove the nested `<ExternalZoomTimerModal>`, the
  `timerVisible` state, and the `processed → setTopicActive` subscription;
  render `<AttendanceFlowPanel>` inline via the existing slide mechanism; route
  `onClose` through the panel's cancel guard while timing.
- **`TimerRecoveryGate.tsx`:** render `<Modal><AttendanceFlowPanel/></Modal>`
  instead of `<ExternalZoomTimerModal>`.
- **`ExternalZoomTimerModal.tsx`:** removed once its body lives in `TimerCard`
  (verify no other importers first).

## Testing

- **Unit (Vitest):** extract the phase-transition decision as a pure function
  (e.g. `nextPhase(state, saveResult, enableTopic) → "topic" | "done"`) and test
  it: valid + topic-on → topic; valid + topic-off → done; invalid → done.
- **Manual matrix:** full happy path (Join → time → Save → topic → Save →
  banner); cancel below/above threshold; **close popup while timing** → confirm;
  **crash recovery** (kill mid-timer → relaunch → recovery modal → Save → topic);
  topic-disabled path; short/invalid session; 7-tap force-save.
- **Regression:** timer never freezes on Save; rating soft-ask still appears on
  popup close (not mid-flow); no keyboard/reanimated crash on topic teardown.

## Risks

- This is a **sizable refactor of the most race-prone, history-laden area** in
  the app. Primary risk is regressing one of the invariants above. Mitigation:
  treat invariant-preservation as a first-class requirement, migrate comments,
  and lean on the manual matrix (these races are device/timing-specific and
  mostly not unit-testable).
- Visual change: the timer becomes an inline slide-up panel instead of a
  full-screen dark-backdrop modal. Acceptable (user is in Zoom while timing);
  add a backdrop within SchedulePopup for the timer phase if prominence matters.

## Resolved decisions

- Structure: **one inline panel, two phases** (not "topic fields on the timer
  from the start", not "keep a morphing modal in the normal path").
- Recovery keeps the **full timer→topic flow** inside its single modal.
- `attendanceEvents.processed` is still emitted; only SchedulePopup's *reliance*
  on it for the topic transition is removed.
