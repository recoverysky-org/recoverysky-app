import { describe, expect, it } from "vitest"

import {
  classifyMigrationLookup,
  decideScheduleLove,
  decideScheduleRating,
  orderRatedForMigration,
} from "./favoriteLogic"

/** Build a 1×N grid row from ids, the shape SchedulePopup's scheduleData carries. */
const row = (...ids: (string | null)[]) => ids.map((id) => (id === null ? null : { id }))

describe("decideScheduleLove", () => {
  it("favoriting propagates to every unique meeting in the grid, tapped mid included", () => {
    const result = decideScheduleLove({
      tappedMid: "m1",
      currentLoves: false,
      scheduleData: [row("m1", "m2"), row("m3", null)],
    })
    expect(result.loves).toBe(true)
    expect([...result.mids].sort()).toEqual(["m1", "m2", "m3"])
  })

  it("un-favoriting sets loves false for the same set", () => {
    const result = decideScheduleLove({
      tappedMid: "m1",
      currentLoves: true,
      scheduleData: [row("m1", "m2")],
    })
    expect(result.loves).toBe(false)
    expect([...result.mids].sort()).toEqual(["m1", "m2"])
  })

  it("dedupes ids that appear in multiple cells and includes a tapped mid absent from the grid", () => {
    const result = decideScheduleLove({
      tappedMid: "tapped",
      currentLoves: false,
      // Same meeting occupying several cells (multi-day schedules do this),
      // and the tapped meeting missing from the grid entirely (defensive —
      // the grid comes from the API and is not guaranteed to contain it).
      scheduleData: [row("m1", "m1"), row("m1", "m2")],
    })
    expect([...result.mids].sort()).toEqual(["m1", "m2", "tapped"])
  })

  it("falls back to just the tapped meeting when the grid is null or empty", () => {
    expect(
      decideScheduleLove({ tappedMid: "m1", currentLoves: false, scheduleData: null }),
    ).toEqual({ mids: ["m1"], loves: true })
    expect(decideScheduleLove({ tappedMid: "m1", currentLoves: true, scheduleData: [] })).toEqual({
      mids: ["m1"],
      loves: false,
    })
  })

  it("ignores cells with an empty id", () => {
    const result = decideScheduleLove({
      tappedMid: "m1",
      currentLoves: false,
      scheduleData: [row("", "m2")],
    })
    expect([...result.mids].sort()).toEqual(["m1", "m2"])
  })
})

describe("classifyMigrationLookup", () => {
  it("propagates on ok", () => {
    expect(classifyMigrationLookup("ok")).toBe("propagate")
  })

  it("skips delisted or malformed meetings so they never block the flag", () => {
    expect(classifyMigrationLookup("not-found")).toBe("skip")
    expect(classifyMigrationLookup("bad-data")).toBe("skip")
  })

  it("aborts on transient transport failures so the pass retries next launch", () => {
    expect(classifyMigrationLookup("timeout")).toBe("abort")
    expect(classifyMigrationLookup("cannot-connect")).toBe("abort")
    expect(classifyMigrationLookup("server")).toBe("abort")
  })

  it("aborts on anything unrecognized — unknown defaults to retryable, never to skip", () => {
    expect(classifyMigrationLookup("unknown")).toBe("abort")
    expect(classifyMigrationLookup("unauthorized")).toBe("abort")
    expect(classifyMigrationLookup("some-future-kind")).toBe("abort")
  })
})

describe("decideScheduleRating", () => {
  it("sets the tapped star on every unique meeting in the grid, tapped mid included", () => {
    const result = decideScheduleRating({
      tappedMid: "m1",
      rating: 4,
      scheduleData: [row("m1", "m2"), row("m3", null)],
    })
    expect(result.rates).toBe(4)
    expect([...result.mids].sort()).toEqual(["m1", "m2", "m3"])
  })

  it("clearing to zero fans out the same way", () => {
    const result = decideScheduleRating({
      tappedMid: "m1",
      rating: 0,
      scheduleData: [row("m1", "m2")],
    })
    expect(result.rates).toBe(0)
    expect([...result.mids].sort()).toEqual(["m1", "m2"])
  })

  it("clamps the star into 0–5", () => {
    expect(decideScheduleRating({ tappedMid: "m1", rating: 9, scheduleData: null }).rates).toBe(5)
    expect(decideScheduleRating({ tappedMid: "m1", rating: -2, scheduleData: null }).rates).toBe(0)
  })

  it("dedupes, includes a tapped mid absent from the grid, and skips empty ids", () => {
    const result = decideScheduleRating({
      tappedMid: "tapped",
      rating: 3,
      scheduleData: [row("m1", "m1"), row("", "m2")],
    })
    expect([...result.mids].sort()).toEqual(["m1", "m2", "tapped"])
  })

  it("falls back to just the tapped meeting when the grid is null or empty", () => {
    expect(decideScheduleRating({ tappedMid: "m1", rating: 2, scheduleData: null })).toEqual({
      mids: ["m1"],
      rates: 2,
    })
    expect(decideScheduleRating({ tappedMid: "m1", rating: 2, scheduleData: [] })).toEqual({
      mids: ["m1"],
      rates: 2,
    })
  })
})

describe("orderRatedForMigration", () => {
  it("returns only rated meetings, highest star first, so the first schedule hit wins with its max", () => {
    const ordered = orderRatedForMigration([
      { mid: "three", rates: 3 },
      { mid: "unrated", rates: 0 },
      { mid: "five", rates: 5 },
      { mid: "four", rates: 4 },
    ])
    expect(ordered).toEqual([
      { mid: "five", rates: 5 },
      { mid: "four", rates: 4 },
      { mid: "three", rates: 3 },
    ])
  })

  it("keeps input order among equal stars so a pass is deterministic", () => {
    const ordered = orderRatedForMigration([
      { mid: "a", rates: 2 },
      { mid: "b", rates: 2 },
      { mid: "c", rates: 2 },
    ])
    expect(ordered.map((r) => r.mid)).toEqual(["a", "b", "c"])
  })

  it("does not mutate its input", () => {
    const input = [
      { mid: "a", rates: 1 },
      { mid: "b", rates: 5 },
    ]
    orderRatedForMigration(input)
    expect(input.map((r) => r.mid)).toEqual(["a", "b"])
  })
})
