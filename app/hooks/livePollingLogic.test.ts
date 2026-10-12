import { describe, expect, it } from "vitest"

import {
  isFromEarlierQuarter,
  LIVE_POLL_JITTER_MAX_MS,
  LIVE_POLL_JITTER_MIN_MS,
  msUntilNextQuarterHour,
  msUntilNextRefresh,
  pickRefreshJitterMs,
} from "./livePollingLogic"

const at = (h: number, m: number, s: number, ms = 0): Date => {
  const d = new Date(2026, 8, 9, h, m, s, ms)
  return d
}

describe("msUntilNextQuarterHour", () => {
  it("counts down to the next :15 mark", () => {
    expect(msUntilNextQuarterHour(at(12, 7, 30))).toBe(7.5 * 60 * 1000)
  })

  it("waits a full period when already on the mark", () => {
    expect(msUntilNextQuarterHour(at(12, 0, 0))).toBe(15 * 60 * 1000)
  })

  it("subtracts seconds and milliseconds", () => {
    expect(msUntilNextQuarterHour(at(12, 14, 59, 500))).toBe(500)
  })

  it("crosses the hour", () => {
    expect(msUntilNextQuarterHour(at(12, 59, 10))).toBe(50 * 1000)
  })

  it("never yields zero or negative from a post-jitter firing time", () => {
    // A refresh that fired at :00 + 90 s of jitter schedules from :01:30.
    expect(msUntilNextQuarterHour(at(12, 1, 30))).toBe(13.5 * 60 * 1000)
  })
})

describe("pickRefreshJitterMs", () => {
  it("maps the low end of the random range to the minimum offset", () => {
    expect(pickRefreshJitterMs(() => 0)).toBe(LIVE_POLL_JITTER_MIN_MS)
  })

  it("never reaches the maximum offset", () => {
    expect(pickRefreshJitterMs(() => 0.999999)).toBeLessThan(LIVE_POLL_JITTER_MAX_MS)
  })

  it("spreads linearly across the window", () => {
    const mid = (LIVE_POLL_JITTER_MIN_MS + LIVE_POLL_JITTER_MAX_MS) / 2
    expect(pickRefreshJitterMs(() => 0.5)).toBe(mid)
  })

  it("keeps the window clear of the boundary and of the next period", () => {
    expect(LIVE_POLL_JITTER_MIN_MS).toBeGreaterThanOrEqual(5_000)
    expect(LIVE_POLL_JITTER_MAX_MS).toBeLessThan(15 * 60 * 1000)
  })
})

describe("msUntilNextRefresh", () => {
  it("is the boundary countdown plus the jitter", () => {
    expect(msUntilNextRefresh(at(12, 7, 30), 42_000)).toBe(7.5 * 60 * 1000 + 42_000)
  })

  it("lands strictly after the mark, never on it", () => {
    const delay = msUntilNextRefresh(
      at(12, 0, 0),
      pickRefreshJitterMs(() => 0),
    )
    expect(delay).toBeGreaterThan(15 * 60 * 1000)
  })
})

// ADDED 2026-10-11 (RS-059): the Live list mounted without refreshing, so a
// list fetched in an earlier quarter-hour stayed on screen until the next mark.
describe("isFromEarlierQuarter", () => {
  const ms = (h: number, m: number, s: number, msPart = 0) => at(h, m, s, msPart).getTime()

  it("is true for a list fetched before the mark the clock has since passed", () => {
    expect(isFromEarlierQuarter(ms(12, 14, 59, 999), ms(12, 15, 0))).toBe(true)
  })

  it("is true for a list fetched hours ago", () => {
    expect(isFromEarlierQuarter(ms(9, 40, 0), ms(12, 7, 0))).toBe(true)
  })

  it("is false inside the quarter-hour the list was fetched in", () => {
    expect(isFromEarlierQuarter(ms(12, 15, 0), ms(12, 29, 59, 999))).toBe(false)
  })

  it("is false before anything has landed, so it cannot race the provider's first fetch", () => {
    expect(isFromEarlierQuarter(null, ms(12, 7, 0))).toBe(false)
  })

  it("is false when the device clock has moved back behind the last fetch", () => {
    expect(isFromEarlierQuarter(ms(12, 31, 0), ms(12, 20, 0))).toBe(false)
  })
})
