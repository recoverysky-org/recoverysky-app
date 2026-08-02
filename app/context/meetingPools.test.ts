import { describe, expect, it } from "vitest"

import { isInPersonVenue, mergePools, projectOnline } from "./meetingPools"

const m = (id: string, venueType: string) => ({ id, venueType })

describe("mergePools", () => {
  it("concatenates both pools online-first when both succeed", () => {
    const merged = mergePools(
      { ok: true, items: [m("a", ""), m("b", "online")] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(merged.bothFailed).toBe(false)
    expect(merged.onlineFailed).toBe(false)
    expect(merged.inPersonFailed).toBe(false)
  })

  it("returns the surviving pool when one fails, without flagging bothFailed", () => {
    const merged = mergePools(
      { ok: false, items: [] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["c"])
    expect(merged.bothFailed).toBe(false)
    expect(merged.onlineFailed).toBe(true)
    expect(merged.inPersonFailed).toBe(false)
  })

  it("flags bothFailed with empty items when both pools fail", () => {
    const merged = mergePools({ ok: false, items: [] }, { ok: false, items: [] })
    expect(merged.items).toEqual([])
    expect(merged.bothFailed).toBe(true)
  })

  it("ignores items on a failed pool (defensive: a failed outcome must not leak rows)", () => {
    const merged = mergePools(
      { ok: false, items: [m("stale", "online")] },
      { ok: true, items: [m("c", "in_person")] },
    )
    expect(merged.items.map((x) => x.id)).toEqual(["c"])
  })
})

describe("isInPersonVenue", () => {
  it("is true only for the literal in_person venue type", () => {
    expect(isInPersonVenue("in_person")).toBe(true)
    expect(isInPersonVenue("")).toBe(false)
    expect(isInPersonVenue("online")).toBe(false)
    expect(isInPersonVenue("hybrid")).toBe(false) // no such rows post-v2.0.0, but never treat as in-person
  })
})

describe("projectOnline", () => {
  it("excludes in_person and keeps everything else, including legacy empty-string rows", () => {
    const items = [m("a", ""), m("b", "online"), m("c", "in_person")]
    expect(projectOnline(items).map((x) => x.id)).toEqual(["a", "b"])
  })

  it("returns a new array (callers must not receive shared mutable state)", () => {
    const items = [m("a", "online")]
    expect(projectOnline(items)).not.toBe(items)
  })
})
