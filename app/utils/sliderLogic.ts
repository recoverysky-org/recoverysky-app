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
