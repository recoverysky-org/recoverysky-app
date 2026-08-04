import { describe, expect, it } from "vitest"

import {
  DEFAULT_SHORT_TIME,
  matchesShortTime,
  SHORT_TIME_OPTIONS,
  SHORT_TIME_RANGES,
  type ShortTime,
} from "./filterLogic"

/**
 * Build an instant whose *local* hour is exactly `hour`.
 *
 * The multi-arg Date constructor interprets its arguments in the device's
 * timezone, and `matchesShortTime` reads the local hour back out — so this
 * round-trips identically on any machine. Building from a UTC millis literal
 * instead would make every assertion below timezone-dependent, and the suite
 * would pass in one CI region and fail in another.
 */
function atLocalHour(hour: number): number {
  return new Date(2026, 7, 4, hour, 30, 0).getTime()
}

describe("matchesShortTime", () => {
  it("matches everything for the neutral bucket", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(matchesShortTime(atLocalHour(hour), "all")).toBe(true)
    }
  })

  it("puts a sunrise meeting in morning, not overnight", () => {
    // The whole reason for the 05:00 boundary — 6am meetings are a fixture of
    // recovery culture and people look for them under "morning".
    expect(matchesShortTime(atLocalHour(6), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(6), "overnight")).toBe(false)
  })

  it("honours morning's boundaries", () => {
    expect(matchesShortTime(atLocalHour(4), "morning")).toBe(false)
    expect(matchesShortTime(atLocalHour(5), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(11), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(12), "morning")).toBe(false)
  })

  it("honours afternoon's boundaries", () => {
    expect(matchesShortTime(atLocalHour(11), "afternoon")).toBe(false)
    expect(matchesShortTime(atLocalHour(12), "afternoon")).toBe(true)
    expect(matchesShortTime(atLocalHour(16), "afternoon")).toBe(true)
    expect(matchesShortTime(atLocalHour(17), "afternoon")).toBe(false)
  })

  it("honours evening's boundaries", () => {
    expect(matchesShortTime(atLocalHour(16), "evening")).toBe(false)
    expect(matchesShortTime(atLocalHour(17), "evening")).toBe(true)
    expect(matchesShortTime(atLocalHour(21), "evening")).toBe(true)
    expect(matchesShortTime(atLocalHour(22), "evening")).toBe(false)
  })

  it("wraps overnight across midnight", () => {
    // The only bucket where startHour > endHour. Both sides of midnight match.
    expect(matchesShortTime(atLocalHour(21), "overnight")).toBe(false)
    expect(matchesShortTime(atLocalHour(22), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(23), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(0), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(3), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(4), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(5), "overnight")).toBe(false)
  })

  it("assigns every hour of the day to exactly one bucket", () => {
    // Guards the no-gaps/no-overlap invariant the SHORT_TIME_RANGES comment
    // claims. Shifting one boundary without its neighbour would either hide
    // meetings from every bucket or double-count them, and neither shows up in
    // the boundary tests above.
    const buckets = SHORT_TIME_OPTIONS.filter((b): b is Exclude<ShortTime, "all"> => b !== "all")

    for (let hour = 0; hour < 24; hour++) {
      const matched = buckets.filter((b) => matchesShortTime(atLocalHour(hour), b))
      expect(
        matched,
        `hour ${hour} matched ${matched.length} buckets: ${matched.join(", ")}`,
      ).toHaveLength(1)
    }
  })

  it("exposes a range for every non-neutral option", () => {
    // If someone adds an option to SHORT_TIME_OPTIONS but forgets the range,
    // matchesShortTime silently falls back to "match everything".
    for (const option of SHORT_TIME_OPTIONS) {
      if (option === "all") continue
      expect(SHORT_TIME_RANGES[option]).toBeDefined()
    }
  })

  it("defaults to the neutral bucket", () => {
    expect(DEFAULT_SHORT_TIME).toBe("all")
    expect(SHORT_TIME_OPTIONS[0]).toBe("all")
  })
})
