import { describe, expect, it } from "vitest"

import { msUntilNextLocalMidnight } from "./localDayLogic"

describe("msUntilNextLocalMidnight", () => {
  it("counts down to the next local midnight", () => {
    const now = new Date(2026, 8, 22, 23, 59, 0) // Sep 22, 23:59 local
    expect(msUntilNextLocalMidnight(now)).toBe(60_000)
  })

  it("returns a full day at exactly midnight (never 0, which would spin)", () => {
    const midnight = new Date(2026, 8, 22, 0, 0, 0)
    const ms = msUntilNextLocalMidnight(midnight)
    // 24 h except across a DST boundary, which Sep 22 is not.
    expect(ms).toBe(24 * 60 * 60 * 1000)
  })

  it("lands on a date whose local day is tomorrow", () => {
    const now = new Date(2026, 11, 31, 15, 30, 0) // New Year's Eve
    const next = new Date(now.getTime() + msUntilNextLocalMidnight(now))
    expect(next.getFullYear()).toBe(2027)
    expect(next.getMonth()).toBe(0)
    expect(next.getDate()).toBe(1)
    expect(next.getHours()).toBe(0)
  })
})
