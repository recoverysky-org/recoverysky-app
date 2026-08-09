# Attendance Duration Slider — Design

**Date:** 2026-08-09
**Status:** Approved for planning

## Goal

Make the attendance duration editor usable for large corrections. Today it is a
single ±1-minute stepper, so trimming an hour off a mis-recorded attendance
costs 60 taps. Replace the stepper pair with a drag slider spanning the legal
range, keeping ±1 buttons for landing an exact value.

## Background: what exists

- **`app/components/AttendanceEditModal.tsx`** — the whole editor. A `Modal`
  with two 44pt round `Pressable` stepper circles flanking a large minutes
  readout, a hint line, and Cancel / Save.
  - `MIN_MINUTES = 1` (module constant, `:19`).
  - `originalMinutes` is derived from the record — `Math.round((end - start) /
    60000)`, floored at `MIN_MINUTES` (`:38-41`).
  - `canDecrement = minutes > MIN_MINUTES`, `canIncrement = minutes <
    originalMinutes`, `canSave = minutes !== originalMinutes`. The original
    duration is a **hard ceiling**: the editor can only reduce.
  - State re-seeds from the record on every open via a `visible`-keyed
    `useEffect` (`:47-52`).
- **`AttendanceScreen.handleEditSave`** (`app/screens/AttendanceScreen.tsx:294`)
  — takes `(record, newDurationMinutes)`, writes `end = record.start +
  minutes * 60000` and `credit = minutes * 60000` through `attendanceRepo`,
  patches local state, and announces the change to screen readers. **It needs
  no changes**: the modal's contract with the screen is already "hand me a
  target minute count".
- **`AttendanceRow.tsx:146`** opens the modal via the `attendanceEdit:title`
  labelled affordance. Unaffected.
- **i18n** — `attendanceEdit` namespace at `app/i18n/en.ts:558-567`, mirrored
  across nine locale files.

## Decisions

### D1 — Slider + fine ±, reduce-only ceiling preserved

Layout, top to bottom: meeting name → large minutes readout → slider with `min`
and `max` endpoint labels → a `[−] [+]` row → hint → Cancel / Save.

The slider spans `MIN_MINUTES … originalMinutes` in whole-minute steps. The
ceiling stays the recorded duration and the floor stays 1 minute — recorded
attendance can be corrected downward but never inflated, which keeps the
"credit reflects real elapsed time" guarantee that `EXTERNAL_MIN_CREDIT_MS` and
the timer modals are built on.

`canDecrement` / `canIncrement` / `canSave` semantics are unchanged; only the
controls that drive them change.

### D2 — `PanResponder`, not a slider library and not gesture-handler

Build the slider on React Native's built-in `PanResponder`. **Zero new
dependencies**, which is the load-bearing part of this decision: it makes the
whole change JS-only, so it ships as an OTA and **`runtimeVersion` is not
bumped**.

The two alternatives were rejected:

- **`@react-native-community/slider`** is not installed. Adding it is a native
  module → forced `runtimeVersion` bump → users wait for a store build to get a
  UI fix.
- **`react-native-gesture-handler`** *is* installed, but only as React
  Navigation's side-effect import (`app/app.tsx:23` → `app/utils/gestureHandler
  .native.ts`). There is no `GestureHandlerRootView` anywhere in the tree, so a
  GH-based gesture would be unreliable on Android.

`PanResponder` also works under React Native Web, which the app targets.

This rationale goes in a header comment on the new component — it is exactly
the kind of choice a future contributor would "fix" by reaching for a slider
package.

### D3 — Pure position/value math lives in `app/utils/sliderLogic.ts`

Following the established `*Logic.ts` pattern (`nearbyLogic`, `presenceLogic`,
`locationGateLogic`, …): the arithmetic goes in a module with **zero `@/`
runtime imports** so vitest can import it, and the I/O — gesture handling,
layout measurement, rendering — stays in the component the tests don't touch.

Exports:

- `clampValue(value, min, max): number`
- `positionToValue({ x, trackWidth, min, max }): number` — converts a touch x
  offset to a whole-minute value: fraction `x / trackWidth` clamped to 0–1,
  scaled across the range, rounded, clamped again.
- `valueToFraction({ value, min, max }): number` — 0–1 for positioning the
  thumb and sizing the filled track.

Degenerate inputs return safe values rather than `NaN`: `trackWidth <= 0` and
`max <= min` both yield `min` / `0` respectively.

### D4 — `MinuteSlider` is its own component

New `app/components/MinuteSlider.tsx`, props:

```ts
{ value: number; min: number; max: number
  onChange: (value: number) => void
  disabled?: boolean
  accessibilityLabel: string }
```

Behavior:

- Track width is captured in a **ref** via `onLayout`, not state — the
  `PanResponder` closure reads it at gesture time and a state round-trip would
  re-create the responder mid-drag.
- `onPanResponderGrant` and `onPanResponderMove` both map touch x through
  `positionToValue`, so **tapping anywhere on the track jumps the thumb there**
  as well as dragging.
- `onChange` fires **only when the rounded integer actually changes**, so a
  drag across a 120-minute range produces ~120 updates rather than one per
  pixel.
- Rendering: a rounded track in `colors.border`, a filled portion in
  `colors.tint`, and a circular thumb. The touchable region is a transparent
  row taller than the visible track so the drag target clears 44pt vertically;
  the thumb carries `hitSlop`.
- `disabled` renders the whole control at reduced opacity and refuses the
  responder.

### D5 — Accessibility is part of the component, not an afterthought

A drag gesture is invisible to VoiceOver and TalkBack, so the slider must
expose the platform's native adjustable semantics:

- `accessibilityRole="adjustable"`
- `accessibilityValue={{ min, max, now: value }}`
- `accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}` with
  an `onAccessibilityAction` handler stepping ±1 within the clamp

That is what makes swipe-up / swipe-down adjust the value on both platforms,
and it lets the screen reader announce the new value itself — no manual
`AccessibilityInfo.announceForAccessibility` calls during the drag.

The existing ± buttons keep their current `attendanceEdit:decrement` /
`attendanceEdit:increment` labels ("Decrease by one minute" / "Increase by one
minute"), which remain accurate.

### D6 — One-minute records render a disabled slider

When `originalMinutes === MIN_MINUTES` the range is empty. The slider renders
`disabled` (full track, no drag, no responder) rather than a zero-width or
`NaN`-positioned thumb. Both ± buttons are already disabled in this state by
the existing `canDecrement` / `canIncrement` logic, and `canSave` is false, so
the modal degrades to a read-only view — which is correct, there is nothing
legal to change it to.

### D7 — No haptics

`expo-haptics` is not a dependency. Adding it for detent feedback would be a
native module → `runtimeVersion` bump, which defeats D2. Not worth it for this
change.

## Files

| File | Change |
| --- | --- |
| `app/utils/sliderLogic.ts` | **new** — pure position ↔ value math |
| `app/utils/sliderLogic.test.ts` | **new** — vitest |
| `app/components/MinuteSlider.tsx` | **new** — `PanResponder` slider |
| `app/components/MinuteSlider.test.tsx` | **new** — jest-expo, a11y actions + disabled |
| `app/components/AttendanceEditModal.tsx` | relayout: steppers → readout + slider + ± row |
| `app/i18n/*.ts` (×9) | one new key, `attendanceEdit.slider` |
| `CHANGELOG.md` | `[Unreleased] → Changed` |

`AttendanceScreen.tsx` and `AttendanceRow.tsx` are untouched.

## i18n

One new key in the `attendanceEdit` namespace:

```ts
slider: "Duration",
```

It is the slider's `accessibilityLabel` — screen readers append the value
themselves from `accessibilityValue`, so the label stays a bare noun.

Per repo convention this is a **nine-file change**: `en.ts` declares
`Translations` and the other eight fail `tsc` until the key exists. The eight
non-`en` files ship the English string as a placeholder for the translation
review queue.

## Testing

**Vitest — `app/utils/sliderLogic.test.ts`:**

- `positionToValue` with `x < 0` → `min`; `x > trackWidth` → `max`
- `trackWidth === 0` → `min` (no divide-by-zero, no `NaN`)
- `max === min` → `min`
- midpoint rounding: `x = trackWidth / 2` over 1…121 → 61
- `valueToFraction` at both endpoints and the midpoint; `max === min` → 0
- `clampValue` above, below, and inside the range

**Jest — `app/components/MinuteSlider.test.tsx`:**

- `increment` / `decrement` accessibility actions call `onChange` with ±1
- neither action pushes past `min` or `max`
- `disabled` suppresses `onChange` for both actions
- `accessibilityValue` reflects `min` / `max` / `now`

Pan gestures are deliberately **not** simulated — `PanResponder` in jsdom
tests the mock, not the behavior. The arithmetic underneath the gesture is
covered by the vitest suite, and the drag itself is a manual check.

**Manual:**

- Drag on iOS, Android, and web; confirm the readout tracks the thumb and that
  a tap on the track jumps to that position.
- Drag to the far left → 1 min; far right → original; Save disabled at the
  original value.
- VoiceOver (iOS) and TalkBack (Android): focus the slider, swipe up/down,
  confirm the value is announced and changes by 1.
- Open the editor on a 1-minute record → slider and both ± buttons disabled,
  Save disabled.
- Save a reduced value → row updates, `credit` and `end` both move, and the
  attendance list reflects the new duration after a reload.

## Release

JS-only. **Do not bump `runtimeVersion`** — this ships via `npm run update`.
