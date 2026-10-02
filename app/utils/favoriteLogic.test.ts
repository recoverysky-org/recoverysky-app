import { describe, expect, it } from "vitest"

import {
  decideScheduleLove,
  decideScheduleRating,
  reconcileScheduleFeedback,
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

describe("reconcileScheduleFeedback", () => {
  // Legacy per-meeting hearts/stars set before 2026-09-04/09 left a schedule
  // mixed. Every list payload carries the full sibling grid, so the fix is
  // applied as the schedules arrive — no lookup per favourite.
  const schedule = (id: string, ...ids: string[]) => ({ meeting: { id }, data: [row(...ids)] })
  const lookup = (records: Record<string, { loves?: boolean; rates?: number }>) => (mid: string) =>
    mid in records ? { loves: records[mid].loves ?? false, rates: records[mid].rates ?? 0 } : null

  it("favorites the whole schedule when any sibling is loved and another is not", () => {
    const plan = reconcileScheduleFeedback(
      [schedule("mon", "mon", "tue", "wed")],
      lookup({ mon: { loves: true } }),
    )
    expect(plan.loveMids).toEqual([["mon", "tue", "wed"]])
    expect(plan.ratingWrites).toEqual([])
  })

  it("favorites a scraper re-import's new mids when any surviving sibling is loved", () => {
    // The scraper re-imported the schedule: Tue and Wed came back with fresh
    // ids no feedback record has ever seen, Mon kept its loved id.
    const plan = reconcileScheduleFeedback(
      [schedule("tue2", "mon", "tue2", "wed2")],
      lookup({ mon: { loves: true }, tue: { loves: true }, wed: { loves: true } }),
    )
    expect(plan.loveMids).toEqual([["tue2", "mon", "wed2"]])
  })

  it("leaves a schedule alone when every sibling agrees, loved or not", () => {
    const allLoved = reconcileScheduleFeedback(
      [schedule("mon", "mon", "tue")],
      lookup({ mon: { loves: true }, tue: { loves: true } }),
    )
    const noneLoved = reconcileScheduleFeedback([schedule("mon", "mon", "tue")], lookup({}))
    expect(allLoved.loveMids).toEqual([])
    expect(noneLoved.loveMids).toEqual([])
  })

  it("rates the whole schedule at its highest star when siblings disagree", () => {
    const plan = reconcileScheduleFeedback(
      [schedule("mon", "mon", "tue", "wed")],
      lookup({ mon: { rates: 3 }, tue: { rates: 5 } }),
    )
    expect(plan.ratingWrites).toEqual([{ mids: ["mon", "tue", "wed"], rates: 5 }])
  })

  it("does not write ratings when no sibling is rated or all match", () => {
    const unrated = reconcileScheduleFeedback([schedule("mon", "mon", "tue")], lookup({}))
    const uniform = reconcileScheduleFeedback(
      [schedule("mon", "mon", "tue")],
      lookup({ mon: { rates: 4 }, tue: { rates: 4 } }),
    )
    expect(unrated.ratingWrites).toEqual([])
    expect(uniform.ratingWrites).toEqual([])
  })

  it("plans each schedule once even when it appears on several rows", () => {
    const plan = reconcileScheduleFeedback(
      [schedule("mon", "mon", "tue"), schedule("tue", "mon", "tue")],
      lookup({ mon: { loves: true } }),
    )
    expect(plan.loveMids).toHaveLength(1)
  })

  it("falls back to the row's own meeting when the grid is null", () => {
    const plan = reconcileScheduleFeedback(
      [{ meeting: { id: "solo" }, data: null }],
      lookup({ solo: { loves: true } }),
    )
    expect(plan.loveMids).toEqual([])
  })
})
