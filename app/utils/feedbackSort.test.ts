import { describe, expect, it } from "vitest"

import { type FeedbackSortable, sortByFeedback } from "./feedbackSort"

/**
 * A row identified by `id`, so assertions can talk about resulting order
 * without dragging in the whole `MeetingWithTrex` shape.
 */
interface Row extends FeedbackSortable {
  id: string
}

const row = (id: string, feedback: { loves?: boolean; rates?: number } | null = null): Row => ({
  id,
  feedback:
    feedback === null ? null : { loves: feedback.loves ?? false, rates: feedback.rates ?? 0 },
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

  it("preserves the caller's order within a tier", () => {
    // The load-bearing property: callers sort by distance (In-Person nearby) or
    // by local start time (Search, day-browse) FIRST and hand the result here,
    // so a stable sort is what makes the real behaviour "favourites first, then
    // nearest/soonest". A fallback comparator in place of `return 0` would
    // throw the caller's ordering away.
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
