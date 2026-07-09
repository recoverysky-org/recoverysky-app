import { describe, expect, it } from "vitest"

import { todayLocalISODate } from "./localDate"

describe("todayLocalISODate", () => {
  it("returns the device-LOCAL calendar date, not the UTC date", () => {
    // Noon-local on a fixed day. Noon is far enough from any midnight that no
    // real timezone offset can shift the calendar day, so this is deterministic
    // regardless of the test runner's TZ.
    const noon = new Date(2026, 5, 29, 12, 0, 0) // local 2026-06-29 12:00
    expect(todayLocalISODate(noon)).toBe("2026-06-29")
  })

  it("zero-pads single-digit months and days", () => {
    const jan5 = new Date(2026, 0, 5, 12, 0, 0) // local 2026-01-05 12:00
    expect(todayLocalISODate(jan5)).toBe("2026-01-05")
  })

  it("regression: a late local evening stays on TODAY, even though UTC has rolled over", () => {
    // The original bug used `new Date().toISOString().split('T')[0]`, which
    // serializes in UTC. For a device behind UTC (e.g. US Eastern) at 11pm on
    // Jun 29, the UTC instant is already Jun 30 — so the recovery-date default
    // showed *tomorrow*. We assert the helper tracks the LOCAL date components.
    const lateEvening = new Date(2026, 5, 29, 23, 30, 0) // local 2026-06-29 23:30
    const expected = `${lateEvening.getFullYear()}-${String(lateEvening.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(lateEvening.getDate()).padStart(2, "0")}`
    expect(todayLocalISODate(lateEvening)).toBe(expected)
    expect(todayLocalISODate(lateEvening)).toBe("2026-06-29")
  })
})
