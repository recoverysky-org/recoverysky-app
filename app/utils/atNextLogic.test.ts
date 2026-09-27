import { describe, expect, it } from "vitest"

import {
  buildStartsAt,
  classifyAtNextProblem,
  isShowEdge,
  offsetOf,
  pruneStarted,
  sortByStart,
  STARTS_IN_OPTIONS,
} from "./atNextLogic"

describe("STARTS_IN_OPTIONS / offsetOf", () => {
  it("offers Live then 15/30/45/60 in order", () => {
    expect(STARTS_IN_OPTIONS).toEqual(["live", "15", "30", "45", "60"])
  })

  it("maps live to no offset and the rest to numbers", () => {
    expect(offsetOf("live")).toBeNull()
    expect(offsetOf("15")).toBe(15)
    expect(offsetOf("45")).toBe(45)
  })
})

describe("buildStartsAt", () => {
  it("truncates to the minute as ISO 8601", () => {
    expect(buildStartsAt(new Date("2026-09-26T19:08:42.123Z"))).toBe("2026-09-26T19:08:00.000Z")
  })

  it("leaves an exact minute unchanged", () => {
    expect(buildStartsAt(new Date("2026-09-26T19:08:00.000Z"))).toBe("2026-09-26T19:08:00.000Z")
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

describe("sortByStart", () => {
  it("sorts ascending without mutating the input", () => {
    const input = [{ millis: 3 }, { millis: 1 }, { millis: 2 }]
    expect(sortByStart(input)).toEqual([{ millis: 1 }, { millis: 2 }, { millis: 3 }])
    expect(input[0].millis).toBe(3)
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

describe("isShowEdge", () => {
  it("fires on hidden → visible and on a visible first render", () => {
    expect(isShowEdge(false, true)).toBe(true)
    expect(isShowEdge(undefined, true)).toBe(true)
  })

  it("does not fire while staying visible or when hiding", () => {
    expect(isShowEdge(true, true)).toBe(false)
    expect(isShowEdge(true, false)).toBe(false)
    expect(isShowEdge(false, false)).toBe(false)
  })
})
