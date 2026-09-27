import { describe, expect, it } from "vitest"

import {
  AT_NEXT_OFFSETS,
  availableStartsIn,
  classifyAtNextProblem,
  isSlotCurrent,
  msUntilNextQuarterHour,
  nextRefetchDelayMs,
  resolveStartsIn,
  offsetOf,
  parseAtMillis,
  pruneStarted,
  REFETCH_GRACE_MS,
  REFETCH_SKEW_FLOOR_MS,
  refetchDelayMs,
} from "./atNextLogic"

describe("AT_NEXT_OFFSETS / offsetOf", () => {
  it("prefetches the four quarter-hour offsets in order", () => {
    expect(AT_NEXT_OFFSETS).toEqual([15, 30, 45, 60])
  })

  it("maps live to no offset and the rest to numbers", () => {
    expect(offsetOf("live")).toBeNull()
    expect(offsetOf("15")).toBe(15)
    expect(offsetOf("45")).toBe(45)
  })
})

describe("parseAtMillis", () => {
  it("reads the API's ISO `at` mark as UTC millis", () => {
    expect(parseAtMillis("2026-09-26T19:15:00.000Z")).toBe(Date.UTC(2026, 8, 26, 19, 15))
  })

  it("returns null for a missing or unparseable mark", () => {
    expect(parseAtMillis(undefined)).toBeNull()
    expect(parseAtMillis("")).toBeNull()
    expect(parseAtMillis("not a date")).toBeNull()
  })
})

describe("refetchDelayMs", () => {
  const at = Date.UTC(2026, 8, 26, 19, 15)

  it("offset 15: waits until just after the mark, the next quarter-hour boundary", () => {
    expect(refetchDelayMs(at, 15, at - 6 * 60_000)).toBe(6 * 60_000 + REFETCH_GRACE_MS)
  })

  it("offset 30/45/60: waits for the NEXT quarter-hour boundary, not the mark itself", () => {
    // The server recomputes every offset's mark at each quarter-hour boundary:
    // at 12:06 "60" answers for 13:00, at 12:15 it already answers for 13:15.
    // The boundary is at − (offset − 15) min.
    const at60 = Date.UTC(2026, 8, 26, 20, 0) // asked at 19:06
    const now = Date.UTC(2026, 8, 26, 19, 6)
    expect(refetchDelayMs(at60, 60, now)).toBe(9 * 60_000 + REFETCH_GRACE_MS)
    const at30 = Date.UTC(2026, 8, 26, 19, 30)
    expect(refetchDelayMs(at30, 30, now)).toBe(9 * 60_000 + REFETCH_GRACE_MS)
    const at45 = Date.UTC(2026, 8, 26, 19, 45)
    expect(refetchDelayMs(at45, 45, now)).toBe(9 * 60_000 + REFETCH_GRACE_MS)
  })

  it("falls back to a floor when the boundary is already past (device clock ahead of the API)", () => {
    // Without the floor a skewed clock would refetch every few seconds and get
    // the same `at` back each time.
    expect(refetchDelayMs(at, 15, at)).toBe(REFETCH_SKEW_FLOOR_MS)
    expect(refetchDelayMs(at, 15, at + 90_000)).toBe(REFETCH_SKEW_FLOOR_MS)
    expect(refetchDelayMs(at + 45 * 60_000, 60, at)).toBe(REFETCH_SKEW_FLOOR_MS)
  })

  it("returns null when there is no mark to schedule against", () => {
    expect(refetchDelayMs(null, 15, at)).toBeNull()
  })
})

describe("pruneStarted", () => {
  const now = 1_000_000
  it("drops meetings at or before now and keeps later ones", () => {
    const items = [{ millis: now - 1 }, { millis: now }, { millis: now + 1 }]
    expect(pruneStarted(items, now)).toEqual([{ millis: now + 1 }])
  })

  it("drops continuous 24/7 rooms (millis 0), which never 'start'", () => {
    expect(pruneStarted([{ millis: 0 }, { millis: now + 60_000 }], now)).toEqual([
      { millis: now + 60_000 },
    ])
  })
})

describe("classifyAtNextProblem", () => {
  it("treats not-found as the endpoint not being deployed", () => {
    expect(classifyAtNextProblem("not-found")).toBe("hide-for-session")
  })

  it("shows an error for everything else", () => {
    for (const kind of ["timeout", "server", "unauthorized", "cannot-connect", "unknown"]) {
      expect(classifyAtNextProblem(kind)).toBe("show-error")
    }
  })
})

describe("availableStartsIn", () => {
  it("offers only the minute options that have meetings, in order", () => {
    expect(availableStartsIn({ 15: 2, 30: 0, 45: 5 })).toEqual(["15", "45"])
  })

  it("offers nothing when no slot has meetings or none has loaded", () => {
    expect(availableStartsIn({ 15: 0, 30: 0, 45: 0, 60: 0 })).toEqual([])
    expect(availableStartsIn({})).toEqual([])
  })
})

describe("resolveStartsIn", () => {
  it("keeps Live Now and any still-available minute option", () => {
    expect(resolveStartsIn("live", [])).toBe("live")
    expect(resolveStartsIn("30", ["15", "30"])).toBe("30")
  })

  it("falls back to Live Now when the selected option has emptied", () => {
    expect(resolveStartsIn("30", ["15", "45"])).toBe("live")
    expect(resolveStartsIn("60", [])).toBe("live")
  })
})

describe("nextRefetchDelayMs", () => {
  const now = Date.UTC(2026, 8, 26, 19, 6)
  const at15 = Date.UTC(2026, 8, 26, 19, 15)

  it("uses the shared boundary of the loaded slots", () => {
    // All four share the 19:15 boundary; a missing slot doesn't matter.
    expect(
      nextRefetchDelayMs(
        { 15: at15, 30: at15 + 15 * 60_000, 60: at15 + 45 * 60_000 },
        now,
      ),
    ).toBe(9 * 60_000 + REFETCH_GRACE_MS)
  })

  it("ignores a stale slot kept from an earlier boundary (a partial failure)", () => {
    // At 19:16 offset 15 failed and still holds 19:15 (boundary passed);
    // the fresh slots point at the 19:30 boundary. Taking the stale one would
    // turn the quarter-hour timer into a 60 s poll.
    const at1916 = Date.UTC(2026, 8, 26, 19, 16)
    expect(
      nextRefetchDelayMs(
        {
          15: at15,
          30: Date.UTC(2026, 8, 26, 19, 45),
          45: Date.UTC(2026, 8, 26, 20, 0),
          60: Date.UTC(2026, 8, 26, 20, 15),
        },
        at1916,
      ),
    ).toBe(14 * 60_000 + REFETCH_GRACE_MS)
  })

  it("still floors when every boundary is past (device clock ahead)", () => {
    expect(nextRefetchDelayMs({ 15: at15 }, at15 + 30_000)).toBe(REFETCH_SKEW_FLOOR_MS)
  })

  it("returns null when no slot has a mark yet", () => {
    expect(nextRefetchDelayMs({}, now)).toBeNull()
    expect(nextRefetchDelayMs({ 15: null }, now)).toBeNull()
  })
})

describe("isSlotCurrent", () => {
  const at30 = Date.UTC(2026, 8, 26, 19, 30) // offset 30 → boundary 19:15

  it("is current until its quarter-hour boundary passes", () => {
    expect(isSlotCurrent(at30, 30, Date.UTC(2026, 8, 26, 19, 14))).toBe(true)
    expect(isSlotCurrent(at30, 30, Date.UTC(2026, 8, 26, 19, 15))).toBe(false)
  })

  it("is not current without a mark", () => {
    expect(isSlotCurrent(null, 15, 0)).toBe(false)
  })
})

describe("msUntilNextQuarterHour", () => {
  it("waits for the next :00/:15/:30/:45 plus the grace", () => {
    expect(msUntilNextQuarterHour(Date.UTC(2026, 8, 26, 19, 6))).toBe(
      9 * 60_000 + REFETCH_GRACE_MS,
    )
  })

  it("on an exact boundary, waits for the following one", () => {
    expect(msUntilNextQuarterHour(Date.UTC(2026, 8, 26, 19, 15))).toBe(
      15 * 60_000 + REFETCH_GRACE_MS,
    )
  })
})
