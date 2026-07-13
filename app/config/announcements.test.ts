import { describe, expect, it } from "vitest"

import { ANNOUNCEMENTS } from "./announcements"

describe("ANNOUNCEMENTS", () => {
  it("has at least one announcement", () => {
    expect(ANNOUNCEMENTS.length).toBeGreaterThan(0)
  })

  it("has non-empty ids", () => {
    for (const a of ANNOUNCEMENTS) {
      expect(a.id.trim().length).toBeGreaterThan(0)
    }
  })

  it("has unique ids", () => {
    const ids = ANNOUNCEMENTS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
