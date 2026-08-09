# Attendance Duration Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ±1-minute stepper pair in the attendance duration editor with a drag slider plus fine ± buttons, so trimming an hour off a mis-recorded attendance takes one drag instead of 60 taps.

**Architecture:** Pure position ↔ value arithmetic goes in `app/utils/sliderLogic.ts` (vitest-reachable, no `@/` runtime imports); gesture handling and rendering go in a new `app/components/MinuteSlider.tsx` built on React Native's built-in `PanResponder`; `AttendanceEditModal.tsx` is relaid out to use them. `AttendanceScreen.handleEditSave` is untouched — the modal's contract with the screen is already "hand me a target minute count".

**Tech Stack:** React Native 0.81 (`PanResponder`, `Modal`), TypeScript, i18next, vitest (pure `.ts`), jest-expo + `@testing-library/react-native` (`.tsx`).

**Design spec:** `docs/superpowers/specs/2026-08-09-attendance-duration-slider-design.md`

## Global Constraints

- **No new dependencies.** This is what keeps the change JS-only. Do not install `@react-native-community/slider`, `expo-haptics`, or anything else.
- **Do NOT bump `runtimeVersion` in `app.json`.** It stays `"4.7.0"`. This ships via `npm run update` (OTA).
- **Do not use `react-native-gesture-handler`.** It is installed, but only as React Navigation's side-effect import (`app/app.tsx:23`). There is no `GestureHandlerRootView` in the tree, so its gestures are unreliable on Android.
- **The editor is reduce-only.** Floor is `MIN_MINUTES = 1`; ceiling is the record's original duration. Never allow a value above the original.
- **`*.test.ts` → vitest, `*.test.tsx` → jest.** Enforced by config. Vitest cannot resolve the `@/` alias, so `app/utils/sliderLogic.ts` must have zero `@/` runtime imports.
- **Any new i18n key is a nine-file change**: `app/i18n/{en,es,ar,de,fr,pt,ru,th,uk}.ts`. `en.ts` declares the `Translations` type; the other eight fail `tsc` until the key exists. Non-`en` files ship the English string as a placeholder.
- **Comments are liberal in this repo** (see `CLAUDE.md` → Code Conventions → Comments). Non-obvious choices get a comment explaining *why*, at the call site.
- **Accessibility is a first-class repo standard.** Every new interactive element needs VoiceOver/TalkBack props.
- **Never import `Text` from `react-native`** — ESLint blocks it. Use `@/components/Text`.

## File Structure

| File | Responsibility |
| --- | --- |
| `app/utils/sliderLogic.ts` | **new** — pure clamp / position↔value math. No React, no RN, no `@/`. |
| `app/utils/sliderLogic.test.ts` | **new** — vitest coverage of the math, including degenerate inputs. |
| `app/components/MinuteSlider.tsx` | **new** — `PanResponder` gesture, layout measurement, rendering, a11y. |
| `app/components/MinuteSlider.test.tsx` | **new** — jest coverage of the a11y increment/decrement actions and disabled state. |
| `app/components/AttendanceEditModal.tsx` | modified — relayout only; save contract unchanged. |
| `app/i18n/*.ts` (×9) | modified — one new key, `attendanceEdit.slider`. |
| `CHANGELOG.md` | modified — `[Unreleased] → Changed`. |

---

### Task 1: Pure slider math

**Files:**
- Create: `app/utils/sliderLogic.ts`
- Test: `app/utils/sliderLogic.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `clampValue(value: number, min: number, max: number): number`
  - `positionToValue(args: { x: number; trackWidth: number; min: number; max: number }): number`
  - `valueToFraction(args: { value: number; min: number; max: number }): number`
  - Exported arg types: `PositionToValueArgs`, `ValueToFractionArgs`

- [ ] **Step 1: Write the failing test**

Create `app/utils/sliderLogic.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { clampValue, positionToValue, valueToFraction } from "./sliderLogic"

// A 1..121 range across a 240px track is the shape the attendance editor
// actually produces for a two-hour meeting: 120 steps, so the midpoint of the
// track is exactly 61 with no rounding ambiguity.
const RANGE = { min: 1, max: 121 }
const TRACK = 240

describe("clampValue", () => {
  it("passes through a value inside the range", () => {
    expect(clampValue(50, 1, 121)).toBe(50)
  })

  it("clamps below the floor and above the ceiling", () => {
    expect(clampValue(-10, 1, 121)).toBe(1)
    expect(clampValue(500, 1, 121)).toBe(121)
  })

  it("returns the floor when the range is inverted", () => {
    // Guards against a caller passing max < min and getting a value that is
    // simultaneously above the ceiling and below the floor.
    expect(clampValue(50, 121, 1)).toBe(121)
  })
})

describe("positionToValue", () => {
  it("maps the track start and end to the range endpoints", () => {
    expect(positionToValue({ x: 0, trackWidth: TRACK, ...RANGE })).toBe(1)
    expect(positionToValue({ x: TRACK, trackWidth: TRACK, ...RANGE })).toBe(121)
  })

  it("maps the track midpoint to the range midpoint", () => {
    expect(positionToValue({ x: TRACK / 2, trackWidth: TRACK, ...RANGE })).toBe(61)
  })

  it("clamps a drag that runs past either end of the track", () => {
    // A finger dragged off the edge of the control keeps reporting motion.
    expect(positionToValue({ x: -80, trackWidth: TRACK, ...RANGE })).toBe(1)
    expect(positionToValue({ x: TRACK + 80, trackWidth: TRACK, ...RANGE })).toBe(121)
  })

  it("returns the floor before onLayout has reported a width", () => {
    // trackWidth is 0 on the first render. Dividing by it would yield NaN and
    // strand the thumb, so this must degrade to the floor instead.
    expect(positionToValue({ x: 120, trackWidth: 0, ...RANGE })).toBe(1)
  })

  it("returns the floor for a degenerate range", () => {
    // A one-minute attendance record: min === max, nothing to slide between.
    expect(positionToValue({ x: 120, trackWidth: TRACK, min: 1, max: 1 })).toBe(1)
  })

  it("returns whole minutes only", () => {
    const value = positionToValue({ x: 77, trackWidth: TRACK, ...RANGE })
    expect(Number.isInteger(value)).toBe(true)
  })
})

describe("valueToFraction", () => {
  it("maps the range endpoints to 0 and 1", () => {
    expect(valueToFraction({ value: 1, ...RANGE })).toBe(0)
    expect(valueToFraction({ value: 121, ...RANGE })).toBe(1)
  })

  it("maps the range midpoint to 0.5", () => {
    expect(valueToFraction({ value: 61, ...RANGE })).toBeCloseTo(0.5, 5)
  })

  it("returns 0 for a degenerate range instead of dividing by zero", () => {
    expect(valueToFraction({ value: 1, min: 1, max: 1 })).toBe(0)
  })

  it("clamps a value outside the range", () => {
    expect(valueToFraction({ value: -5, ...RANGE })).toBe(0)
    expect(valueToFraction({ value: 999, ...RANGE })).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:unit -- app/utils/sliderLogic.test.ts`

Expected: FAIL — `Failed to resolve import "./sliderLogic"`.

- [ ] **Step 3: Write the implementation**

Create `app/utils/sliderLogic.ts`:

```ts
/**
 * sliderLogic
 *
 * Pure position ↔ value math for MinuteSlider.
 *
 * Kept free of `@/` runtime imports on purpose: vitest has no `@/` alias and
 * no React Native transform, so anything it needs to import must be plain TS.
 * The gesture handling and rendering that consume these helpers live in
 * `app/components/MinuteSlider.tsx`, which the tests never touch. Same split as
 * nearbyLogic / presenceLogic / locationGateLogic.
 */

/** Clamp `value` into `[min, max]`. An inverted range collapses to `min`. */
export function clampValue(value: number, min: number, max: number): number {
  if (max < min) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export interface PositionToValueArgs {
  /** Touch offset in px from the left edge of the slider's travel. */
  x: number
  /** Width in px of the slider's travel, from onLayout. */
  trackWidth: number
  min: number
  max: number
}

/**
 * Convert a touch offset into a whole-minute value.
 *
 * Both degenerate cases below are reachable in normal use, not defensive
 * padding: `trackWidth` is 0 until onLayout fires on the first render, and
 * `max === min` whenever the user edits a 1-minute attendance record. Either
 * one would produce NaN through the division, which renders as a thumb pinned
 * off-screen and a blank readout.
 */
export function positionToValue({ x, trackWidth, min, max }: PositionToValueArgs): number {
  if (trackWidth <= 0 || max <= min) return min
  const fraction = clampValue(x / trackWidth, 0, 1)
  return clampValue(Math.round(min + fraction * (max - min)), min, max)
}

export interface ValueToFractionArgs {
  value: number
  min: number
  max: number
}

/**
 * Convert a value into a 0–1 position along the slider's travel, for placing
 * the thumb and sizing the filled portion of the track.
 */
export function valueToFraction({ value, min, max }: ValueToFractionArgs): number {
  if (max <= min) return 0
  return clampValue((value - min) / (max - min), 0, 1)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit -- app/utils/sliderLogic.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 5: Type check**

Run: `npm run compile`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/utils/sliderLogic.ts app/utils/sliderLogic.test.ts
git commit -m "✨ feat(slider): pure position and value math for the minute slider"
```

---

### Task 2: The `MinuteSlider` component

**Files:**
- Create: `app/components/MinuteSlider.tsx`
- Test: `app/components/MinuteSlider.test.tsx`

**Interfaces:**
- Consumes: `clampValue`, `positionToValue`, `valueToFraction` from `@/utils/sliderLogic` (Task 1).
- Produces: `MinuteSlider` — a named export taking

  ```ts
  interface MinuteSliderProps {
    value: number
    min: number
    max: number
    onChange: (value: number) => void
    disabled?: boolean
    accessibilityLabel: string
    testID?: string
  }
  ```

  The component's root has `flex: 1`, so it expects a row-flex parent (Task 3 supplies one).

- [ ] **Step 1: Write the failing test**

Create `app/components/MinuteSlider.test.tsx`:

```tsx
/**
 * Covers the parts of MinuteSlider a screen-reader user depends on. Pan
 * gestures are deliberately NOT simulated — PanResponder under jsdom exercises
 * the mock rather than the behaviour, and the arithmetic underneath the drag is
 * already covered by app/utils/sliderLogic.test.ts. The drag itself is a manual
 * check (see the plan's Task 5).
 */
import { fireEvent, render, screen } from "@testing-library/react-native"

import { MinuteSlider } from "./MinuteSlider"

const baseProps = {
  value: 60,
  min: 1,
  max: 120,
  accessibilityLabel: "Duration",
  testID: "minute-slider",
}

const adjust = (action: "increment" | "decrement") =>
  fireEvent(screen.getByTestId("minute-slider"), "accessibilityAction", {
    nativeEvent: { actionName: action },
  })

describe("MinuteSlider", () => {
  it("exposes the range and current value to screen readers", () => {
    render(<MinuteSlider {...baseProps} onChange={jest.fn()} />)

    const slider = screen.getByTestId("minute-slider")
    expect(slider.props.accessibilityRole).toBe("adjustable")
    expect(slider.props.accessibilityValue).toEqual({ min: 1, max: 120, now: 60 })
  })

  it("steps the value by one on the increment and decrement actions", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} onChange={onChange} />)

    adjust("increment")
    expect(onChange).toHaveBeenCalledWith(61)

    adjust("decrement")
    expect(onChange).toHaveBeenCalledWith(59)
  })

  it("does not step past the ceiling", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={120} onChange={onChange} />)

    adjust("increment")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("does not step past the floor", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={1} onChange={onChange} />)

    adjust("decrement")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("ignores both actions while disabled", () => {
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} disabled onChange={onChange} />)

    adjust("increment")
    adjust("decrement")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("minute-slider").props.accessibilityState).toMatchObject({
      disabled: true,
    })
  })

  it("reports itself disabled for a degenerate range", () => {
    // A one-minute attendance record: there is no legal value to slide to.
    const onChange = jest.fn()
    render(<MinuteSlider {...baseProps} value={1} min={1} max={1} onChange={onChange} />)

    adjust("increment")
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId("minute-slider").props.accessibilityState).toMatchObject({
      disabled: true,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:component -- app/components/MinuteSlider.test.tsx`

Expected: FAIL — `Cannot find module './MinuteSlider'`.

- [ ] **Step 3: Write the implementation**

Create `app/components/MinuteSlider.tsx`:

```tsx
/**
 * MinuteSlider
 *
 * Horizontal slider over a whole-minute range, built on React Native's built-in
 * PanResponder.
 *
 * WHY PanResponder and not a slider library: `@react-native-community/slider` is
 * a native module, so adding it would force a `runtimeVersion` bump and a store
 * build for what is a pure UI fix. `react-native-gesture-handler` IS installed,
 * but only as React Navigation's side-effect import (app/app.tsx:23) — there is
 * no GestureHandlerRootView anywhere in this app's tree, so its gestures are
 * unreliable on Android. PanResponder needs neither, and works under React
 * Native Web, which this app targets. Don't "upgrade" this to a slider package
 * without also bumping runtimeVersion in app.json.
 */

import { FC, useMemo, useRef, useState } from "react"
import {
  AccessibilityActionEvent,
  LayoutChangeEvent,
  PanResponder,
  View,
  ViewStyle,
} from "react-native"

import { useAppTheme } from "@/theme/context"
import type { ThemedStyle } from "@/theme/types"
import { clampValue, positionToValue, valueToFraction } from "@/utils/sliderLogic"

const THUMB_SIZE = 28
const TRACK_HEIGHT = 6
/** Tall enough that the drag target clears the 44pt minimum on both platforms. */
const ROW_HEIGHT = 44

// Frozen at module scope: passing a fresh array on every render makes the
// native accessibility bridge re-register the actions each time.
const A11Y_ACTIONS = [{ name: "increment" }, { name: "decrement" }]

export interface MinuteSliderProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  disabled?: boolean
  accessibilityLabel: string
  testID?: string
}

export const MinuteSlider: FC<MinuteSliderProps> = ({
  value,
  min,
  max,
  onChange,
  disabled = false,
  accessibilityLabel,
  testID,
}) => {
  const { themed, theme } = useAppTheme()

  // A range with nowhere to travel (a 1-minute attendance record) is treated
  // exactly like an explicitly disabled slider — see the spec's D6.
  const isDisabled = disabled || max <= min

  // Travel width, measured once by onLayout. It lives in BOTH a ref and state
  // on purpose: the PanResponder closure below is memoized for the life of the
  // component and reads the ref at gesture time (routing it through state would
  // re-create the responder mid-drag), while the render needs the state copy to
  // place the thumb.
  const travelRef = useRef(0)
  const [travel, setTravel] = useState(0)

  // The responder is created once, so it must read live props through a ref
  // rather than capturing the first render's values.
  const propsRef = useRef({ value, min, max, onChange, isDisabled })
  propsRef.current = { value, min, max, onChange, isDisabled }

  // Touch offset at the moment the gesture began. Subsequent moves are tracked
  // via gestureState.dx rather than locationX, because locationX is reported
  // relative to whichever view is under the finger and drifts once the drag
  // leaves this component's bounds.
  const grantXRef = useRef(0)

  const handleLayout = (event: LayoutChangeEvent) => {
    // The thumb's CENTRE travels between THUMB_SIZE/2 and width - THUMB_SIZE/2,
    // so the usable travel is the row width less one whole thumb. Measuring it
    // this way is what keeps the thumb from hanging off either end.
    const next = Math.max(0, event.nativeEvent.layout.width - THUMB_SIZE)
    travelRef.current = next
    setTravel(next)
  }

  const emit = (rawX: number) => {
    const { value: current, min: lo, max: hi, onChange: fire } = propsRef.current
    const next = positionToValue({
      // rawX is measured from the row's left edge; the travel starts half a
      // thumb in from there.
      x: rawX - THUMB_SIZE / 2,
      trackWidth: travelRef.current,
      min: lo,
      max: hi,
    })
    // Only fire when the whole-minute value actually changes. Without this a
    // single drag across a two-hour range would push one update per pixel.
    if (next !== current) fire(next)
  }

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !propsRef.current.isDisabled,
        onMoveShouldSetPanResponder: () => !propsRef.current.isDisabled,
        onPanResponderGrant: (event) => {
          // Grant fires with the touch still on this view, so locationX is
          // accurate here. Emitting on grant is what makes a tap anywhere on
          // the track jump the thumb to that spot.
          grantXRef.current = event.nativeEvent.locationX
          emit(grantXRef.current)
        },
        onPanResponderMove: (_event, gestureState) => {
          emit(grantXRef.current + gestureState.dx)
        },
      }),
    // Intentionally empty: every value the handlers need is read from a ref, so
    // the responder must NOT be rebuilt on prop changes — doing so cancels an
    // in-flight drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    const { value: current, min: lo, max: hi, onChange: fire, isDisabled: off } = propsRef.current
    if (off) return
    const delta =
      event.nativeEvent.actionName === "increment"
        ? 1
        : event.nativeEvent.actionName === "decrement"
          ? -1
          : 0
    if (delta === 0) return
    const next = clampValue(current + delta, lo, hi)
    if (next !== current) fire(next)
  }

  const fraction = valueToFraction({ value, min, max })

  return (
    <View
      style={themed($row)}
      onLayout={handleLayout}
      {...panResponder.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      // This pair is what makes VoiceOver swipe-up/down and TalkBack
      // volume-key adjustment work, and it lets the platform announce the new
      // value itself — no manual announceForAccessibility during the drag.
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={A11Y_ACTIONS}
      onAccessibilityAction={handleAccessibilityAction}
      accessibilityState={{ disabled: isDisabled }}
      testID={testID}
    >
      <View style={[themed($track), isDisabled && themed($dimmed)]}>
        <View style={[themed($fill), { width: `${fraction * 100}%` }]} />
      </View>

      <View
        style={[
          themed($thumb),
          isDisabled && themed($thumbDisabled),
          { left: fraction * travel },
        ]}
        // The thumb is decoration: the whole row owns the gesture, so the thumb
        // must not intercept the touch that starts a drag on top of it.
        pointerEvents="none"
      />
    </View>
  )
}

const $row: ThemedStyle<ViewStyle> = () => ({
  // Expects a row-flex parent — AttendanceEditModal puts endpoint labels on
  // either side of this.
  flex: 1,
  height: ROW_HEIGHT,
  justifyContent: "center",
})

const $track: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: TRACK_HEIGHT,
  borderRadius: TRACK_HEIGHT / 2,
  backgroundColor: colors.border,
  // Inset by half a thumb on each side so the track's ends line up with the
  // extremes of the thumb's travel.
  marginHorizontal: THUMB_SIZE / 2,
  overflow: "hidden",
})

const $fill: ThemedStyle<ViewStyle> = ({ colors }) => ({
  height: "100%",
  backgroundColor: colors.tint,
})

const $thumb: ThemedStyle<ViewStyle> = ({ colors }) => ({
  position: "absolute",
  width: THUMB_SIZE,
  height: THUMB_SIZE,
  borderRadius: THUMB_SIZE / 2,
  backgroundColor: colors.tint,
  borderWidth: 2,
  borderColor: colors.card,
})

const $thumbDisabled: ThemedStyle<ViewStyle> = ({ colors }) => ({
  backgroundColor: colors.tintInactive,
})

const $dimmed: ThemedStyle<ViewStyle> = () => ({
  opacity: 0.4,
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:component -- app/components/MinuteSlider.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 5: Type check and lint**

Run: `npm run compile && npm run lint`

Expected: no errors. If `theme` is reported unused, drop it from the `useAppTheme()` destructure and keep only `themed`.

- [ ] **Step 6: Commit**

```bash
git add app/components/MinuteSlider.tsx app/components/MinuteSlider.test.tsx
git commit -m "✨ feat(slider): PanResponder MinuteSlider with adjustable a11y role"
```

---

### Task 3: i18n key for the slider label

**Files:**
- Modify: `app/i18n/en.ts` (the `attendanceEdit` block, currently lines 558-567)
- Modify: `app/i18n/{es,ar,de,fr,pt,ru,th,uk}.ts` (the matching `attendanceEdit` block in each)

**Interfaces:**
- Consumes: nothing.
- Produces: translation key `attendanceEdit:slider`, consumed by Task 4.

- [ ] **Step 1: Add the key to `en.ts`**

In `app/i18n/en.ts`, inside the `attendanceEdit` object, add `slider` directly after `minutes`:

```ts
  attendanceEdit: {
    title: "Edit Duration",
    minutes: "minutes",
    // Accessibility label for the drag slider. Screen readers append the
    // current value themselves from accessibilityValue, so this stays a bare
    // noun rather than "Duration, 60 minutes".
    slider: "Duration",
    hint: "Original: {{minutes}} min. You can only reduce the duration.",
    decrement: "Decrease by one minute",
    increment: "Increase by one minute",
    save: "Save",
    saved: "Duration updated",
    saveError: "Could not update duration. Please try again.",
  },
```

- [ ] **Step 2: Run the type check to see the other eight locales fail**

Run: `npm run compile`

Expected: FAIL — eight errors, one per locale file, of the form `Property 'slider' is missing in type ... but required in type`. This is the repo's designed behaviour: `en.ts` exports `Translations = typeof en` and every other locale is typed against it.

- [ ] **Step 3: Add the key to the other eight locales**

In each of `app/i18n/{es,ar,de,fr,pt,ru,th,uk}.ts`, add `slider` in the same position within that file's `attendanceEdit` block. Ship the English string as a placeholder in all eight — a native-speaker review queue item beats a broken build:

```ts
    slider: "Duration",
```

- [ ] **Step 4: Run the type check to verify it passes**

Run: `npm run compile`

Expected: no errors.

- [ ] **Step 5: Run the i18n test**

Run: `npm run test:unit -- test/i18n.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/i18n
git commit -m "🌐 i18n: accessibility label for the duration slider"
```

---

### Task 4: Relayout `AttendanceEditModal`

**Files:**
- Modify: `app/components/AttendanceEditModal.tsx`

**Interfaces:**
- Consumes: `MinuteSlider` from `./MinuteSlider` (Task 2); the `attendanceEdit:slider` key (Task 3).
- Produces: no change to the component's public props. `onSave(record, newDurationMinutes)` is unchanged, so `AttendanceScreen.handleEditSave` (`app/screens/AttendanceScreen.tsx:294`) needs no edit.

- [ ] **Step 1: Import the slider**

In `app/components/AttendanceEditModal.tsx`, add to the internal-import group (after the `Text` import):

```tsx
import { MinuteSlider } from "@/components/MinuteSlider"
```

- [ ] **Step 2: Update the file header comment**

Replace the existing header block with:

```tsx
/**
 * AttendanceEditModal
 *
 * Small editor that lets the user reduce an attendance record's duration
 * (minutes). The original duration acts as the hard ceiling — users can only
 * adjust the time downward. Minimum floor is 1 minute.
 *
 * CHANGED 2026-08-09: the ±1-minute stepper pair was the ONLY way to change the
 * value, so correcting an over-long record cost one tap per minute — 60 taps to
 * remove an hour. A drag slider now spans the legal range and the ± buttons are
 * demoted to fine adjustment. The reduce-only ceiling and the 1-minute floor are
 * unchanged.
 */
```

- [ ] **Step 3: Replace the stepper row with the readout, slider, and ± row**

Replace the whole `<View style={themed($stepperRow)}>…</View>` block (currently lines 91-136, the two `Pressable` circles flanking `$minutesDisplay`) with:

```tsx
          <View style={themed($minutesDisplay)}>
            <Text style={themed($minutesValue)}>{minutes}</Text>
            <Text style={themed($minutesUnit)} tx="attendanceEdit:minutes" />
          </View>

          <View style={themed($sliderRow)}>
            <Text style={themed($endpointLabel)}>{MIN_MINUTES}</Text>

            <MinuteSlider
              value={minutes}
              min={MIN_MINUTES}
              max={originalMinutes}
              onChange={setMinutes}
              // `saving` disables it for the same reason the buttons check it:
              // the save is in flight and the value is already committed.
              disabled={saving}
              accessibilityLabel={t("attendanceEdit:slider")}
              testID="attendance-edit-slider"
            />

            <Text style={themed($endpointLabel)}>{originalMinutes}</Text>
          </View>

          <View style={themed($stepperRow)}>
            <Pressable
              onPress={() => canDecrement && setMinutes((m) => Math.max(MIN_MINUTES, m - 1))}
              disabled={!canDecrement}
              hitSlop={8}
              style={({ pressed }) => [
                themed($stepperButton),
                !canDecrement && themed($stepperDisabled),
                pressed && canDecrement ? themed($stepperPressed) : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("attendanceEdit:decrement")}
              accessibilityState={{ disabled: !canDecrement }}
            >
              <Ionicons
                name="remove"
                size={24}
                color={canDecrement ? theme.colors.tint : theme.colors.textDim}
              />
            </Pressable>

            <Pressable
              onPress={() => canIncrement && setMinutes((m) => Math.min(originalMinutes, m + 1))}
              disabled={!canIncrement}
              hitSlop={8}
              style={({ pressed }) => [
                themed($stepperButton),
                !canIncrement && themed($stepperDisabled),
                pressed && canIncrement ? themed($stepperPressed) : null,
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("attendanceEdit:increment")}
              accessibilityState={{ disabled: !canIncrement }}
            >
              <Ionicons
                name="add"
                size={24}
                color={canIncrement ? theme.colors.tint : theme.colors.textDim}
              />
            </Pressable>
          </View>
```

Note: `MIN_MINUTES` and `originalMinutes` render as bare numbers, not translated strings — they are numerals in every locale the app ships.

- [ ] **Step 4: Update the styles**

`$minutesDisplay` currently sizes a stepper cell. Replace it, and add the two new styles, near the existing `$minutesDisplay` definition:

```tsx
const $minutesDisplay: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  alignItems: "center",
  marginTop: spacing.xs,
})

const $sliderRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  gap: spacing.xs,
  width: "100%",
  marginBottom: spacing.xs,
})

const $endpointLabel: ThemedStyle<TextStyle> = ({ colors }) => ({
  fontSize: 12,
  color: colors.textDim,
  fontVariant: ["tabular-nums"],
  // Keeps the slider's travel from shifting as the ceiling label goes from
  // two digits to three.
  minWidth: 26,
  textAlign: "center",
})
```

And change `$stepperRow` — it no longer wraps the readout, it is just the two fine-adjust buttons:

```tsx
const $stepperRow: ThemedStyle<ViewStyle> = ({ spacing }) => ({
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  gap: spacing.xl,
  marginBottom: spacing.xs,
})
```

- [ ] **Step 5: Type check, lint, and run the full test suite**

Run: `npm run compile && npm run lint && npm test`

Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/components/AttendanceEditModal.tsx
git commit -m "✨ feat(attendance): slider for editing a record's duration"
```

---

### Task 5: Manual verification and changelog

**Files:**
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing.

- [ ] **Step 1: Run the app**

Run: `npm start` and open on a simulator, then go to the Attendance tab and tap the edit affordance on a record.

- [ ] **Step 2: Work the manual checklist**

Confirm each of these by hand:

- Drag the thumb — the big readout tracks it, and dragging is smooth rather than one-minute-per-frame.
- Tap a point on the track away from the thumb — the thumb jumps there.
- Drag past the left edge → `1`. Drag past the right edge → the original duration, and Save greys out at exactly that value.
- Tap `−` and `+` — each moves the value by one and the thumb follows.
- Open the editor on a **1-minute** record — the slider renders dimmed and immovable, both ± buttons are disabled, Save is disabled.
- Turn on VoiceOver (iOS) or TalkBack (Android), focus the slider, swipe up and down — the value changes by one and the new value is announced.
- Save a reduced value — the toast/announcement fires, the row shows the new duration, and it survives a tab switch and return.
- Repeat the drag check on web (`npm run web`) — `PanResponder` runs through React Native Web there, so it is a genuinely different code path.

- [ ] **Step 3: Add the changelog entry**

Under `## [Unreleased]` in `CHANGELOG.md`, in the `### Changed` group (create the group if `[Unreleased]` doesn't have one yet):

```markdown
- **Editing an attendance record's duration is now a drag, not 60 taps.** The
  duration editor had a single ±1-minute stepper, so correcting a record that
  ran an hour long meant tapping sixty times. It now has a slider across the
  whole legal range with the ± buttons kept for landing an exact minute. The
  editor still only lets you reduce a recorded duration, never inflate it, and
  the slider is fully operable with VoiceOver and TalkBack.
```

- [ ] **Step 4: Confirm `runtimeVersion` was not touched**

Run: `git diff --stat origin/root -- app.json`

Expected: empty output. This change is JS-only and ships via `npm run update`. If `app.json` shows up in that diff, revert it.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "📝 docs: changelog for the attendance duration slider"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| D1 — slider + fine ±, reduce-only ceiling | Task 4 (layout), Task 2 (`min`/`max` wiring) |
| D2 — `PanResponder`, no new deps, no `runtimeVersion` bump | Task 2 (header comment + implementation), Task 5 Step 4 (verification) |
| D3 — `sliderLogic.ts`, zero `@/` imports | Task 1 |
| D4 — `MinuteSlider` component behaviour | Task 2 |
| D5 — adjustable a11y role and actions | Task 2 (implementation + test), Task 3 (label key) |
| D6 — 1-minute records render disabled | Task 2 (`isDisabled = disabled \|\| max <= min`, plus its test), Task 5 (manual check) |
| D7 — no haptics | Global Constraints |
| i18n nine-file change | Task 3 |
| Testing — vitest | Task 1 |
| Testing — jest | Task 2 |
| Testing — manual | Task 5 |
| CHANGELOG | Task 5 |

No gaps.

**Placeholder scan:** none — every code step carries the literal code to write, and the manual checklist enumerates concrete observations rather than "verify it works".

**Type consistency:** `clampValue` / `positionToValue` / `valueToFraction` are defined in Task 1 and used under exactly those names in Task 2. `MinuteSliderProps` is defined in Task 2 and every prop it declares (`value`, `min`, `max`, `onChange`, `disabled`, `accessibilityLabel`, `testID`) is supplied by Task 4's call site. The `attendanceEdit:slider` key is created in Task 3 and read in Task 4.
