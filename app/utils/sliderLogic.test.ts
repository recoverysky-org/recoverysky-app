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
