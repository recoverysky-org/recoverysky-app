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
  const { themed } = useAppTheme()

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
        style={[themed($thumb), isDisabled && themed($thumbDisabled), { left: fraction * travel }]}
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
