import { describe, expect, it } from "vitest"

import { type FeedbackSortable, sortByFeedback } from "./feedbackSort"

/**
 * A row identified by `id`, so assertions can talk about resulting order
 * without dragging in the whole `MeetingWithTrex` shape.
 */
interface Row extends FeedbackSortable {
  id: string
}

const row = (
  id: string,
  feedback: { loves?: boolean; rates?: number; joins?: number } | null = null,
): Row => ({
  id,
  feedback:
    feedback === null
      ? null
      : {
          loves: feedback.loves ?? false,
          rates: feedback.rates ?? 0,
          joins: feedback.joins ?? 0,
        },
})

const ids = (rows: Row[]): string[] => rows.map((r) => r.id)

describe("sortByFeedback", () => {
  it("floats favourites above everything else", () => {
    const sorted = sortByFeedback([
      row("plain"),
      row("rated", { rates: 5 }),
      row("loved", { loves: true }),
    ])
    expect(ids(sorted)[0]).toBe("loved")
  })

  it("orders favourites by stars, descending", () => {
    const sorted = sortByFeedback([
      row("one-star", { loves: true, rates: 1 }),
      row("five-star", { loves: true, rates: 5 }),
      row("three-star", { loves: true, rates: 3 }),
    ])
    expect(ids(sorted)).toEqual(["five-star", "three-star", "one-star"])
  })

  it("puts touched non-favourites above untouched ones, by stars", () => {
    const sorted = sortByFeedback([
      row("untouched"),
      row("two-star", { rates: 2 }),
      row("four-star", { rates: 4 }),
    ])
    expect(ids(sorted)).toEqual(["four-star", "two-star", "untouched"])
  })

  it("ranks a joined-but-unrated meeting above an untouched one", () => {
    // The tier test is `feedback !== null`, not `rates > 0`. A meeting the user
    // joined has an all-zero feedback row, and it still outranks one they have
    // never touched. Tightening the test to `rates > 0` would silently demote
    // every joined-but-unrated meeting — this is the guard against that.
    const sorted = sortByFeedback([row("untouched"), row("joined", { loves: false, rates: 0 })])
    expect(ids(sorted)).toEqual(["joined", "untouched"])
  })

  it("breaks a stars tie by attendance, descending", () => {
    // The reported symptom, verbatim: the nearby list handed rows in distance
    // order — "nooners" 0.9 mi ahead of "illness" 1.9 mi — and both are
    // unrated, so the caller's distance order used to win outright and the
    // meeting attended twice sorted below the one attended once.
    const sorted = sortByFeedback([row("nooners", { joins: 1 }), row("illness", { joins: 2 })])
    expect(ids(sorted)).toEqual(["illness", "nooners"])
  })

  it("breaks a stars tie by attendance among favourites too", () => {
    const sorted = sortByFeedback([
      row("once", { loves: true, rates: 4, joins: 1 }),
      row("weekly", { loves: true, rates: 4, joins: 12 }),
    ])
    expect(ids(sorted)).toEqual(["weekly", "once"])
  })

  it("ranks stars above attendance", () => {
    // Attendance is a tiebreaker, not a co-equal key. A meeting the user
    // explicitly five-starred outranks one they merely keep turning up to —
    // inverting these two is the plausible-looking change this guards against.
    const sorted = sortByFeedback([
      row("attended-often", { rates: 0, joins: 9 }),
      row("five-star", { rates: 5, joins: 1 }),
    ])
    expect(ids(sorted)).toEqual(["five-star", "attended-often"])
  })

  it("preserves the caller's order when stars AND attendance tie", () => {
    const sorted = sortByFeedback([
      row("near", { rates: 3, joins: 2 }),
      row("far", { rates: 3, joins: 2 }),
    ])
    expect(ids(sorted)).toEqual(["near", "far"])
  })

  it("treats a missing joins field as never-attended rather than NaN", () => {
    // A comparator that returns NaN doesn't just misorder one pair — it makes
    // the entire sort's output implementation-defined. Rows predating the
    // field (or hand-built ones) must read as 0.
    const noJoins = { id: "no-joins", feedback: { loves: false, rates: 2 } } as unknown as Row
    const sorted = sortByFeedback([noJoins, row("attended", { rates: 2, joins: 3 })])
    expect(ids(sorted)).toEqual(["attended", "no-joins"])
  })

  it("preserves the caller's order within a tier", () => {
    // The load-bearing property: callers sort by distance (In-Person nearby) or
    // by local start time (Search, day-browse) FIRST and hand the result here,
    // so a stable sort is what makes the real behaviour "favourites first, then
    // most-attended, then nearest/soonest". A fallback comparator in place of
    // `return 0` would throw the caller's ordering away.
    // These rows are all untouched, so they never reach the stars or
    // attendance keys at all — tier 3 is the caller's order, full stop.
    const sorted = sortByFeedback([row("near"), row("mid"), row("far")])
    expect(ids(sorted)).toEqual(["near", "mid", "far"])
  })

  it("preserves the caller's order between equally-rated favourites", () => {
    const sorted = sortByFeedback([
      row("near", { loves: true, rates: 4 }),
      row("far", { loves: true, rates: 4 }),
    ])
    expect(ids(sorted)).toEqual(["near", "far"])
  })

  it("produces the full three-tier ordering in one pass", () => {
    const sorted = sortByFeedback([
      row("plain-b"),
      row("rated-low", { rates: 2 }),
      row("loved-low", { loves: true, rates: 1 }),
      row("plain-a"),
      row("rated-high", { rates: 5 }),
      row("loved-high", { loves: true, rates: 5 }),
    ])
    expect(ids(sorted)).toEqual([
      "loved-high",
      "loved-low",
      "rated-high",
      "rated-low",
      "plain-b",
      "plain-a",
    ])
  })

  it("does not mutate its input", () => {
    const input = [row("plain"), row("loved", { loves: true })]
    const before = ids(input)
    sortByFeedback(input)
    expect(ids(input)).toEqual(before)
  })

  it("handles an empty list", () => {
    expect(sortByFeedback([])).toEqual([])
  })

  it("treats a missing feedback field as untouched rather than throwing", () => {
    // `feedback` is non-optional on MeetingWithTrex, but a fetch path that
    // forgets to stamp it yields `undefined` at runtime. That must sort last,
    // not crash the list.
    const rows = [{ id: "no-field" } as unknown as Row, row("loved", { loves: true })]
    expect(ids(sortByFeedback(rows))).toEqual(["loved", "no-field"])
  })
})
