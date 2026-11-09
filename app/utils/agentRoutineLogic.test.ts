import { describe, expect, it } from "vitest"

import {
  routineBucketsOf,
  routineDayHeading,
  routineProgressOf,
  todayOfToolOutput,
} from "./agentRoutineLogic"

/** A routine item as the Daily Dash API's Today answers it (sdk `zTodayItem`) */
const item = (overrides: Record<string, unknown> = {}) => ({
  id: "0b7c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d",
  title: "Morning prayer",
  bucket: "morning",
  timeOfDay: "07:00",
  sortOrder: 0,
  tick: { status: "done", at: "2026-11-08T13:05:00Z" },
  weekDone: 4,
  ...overrides,
})

/** The Daily Dash API's Today (sdk `zToday`), routine and the rest */
const today = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  asOf: { date: "2026-11-08", timezone: "America/Chicago" },
  recordable: true,
  routine: { weekStart: "2026-11-02", items, warnings: [] },
  steering: { date: "2026-11-07", focalAreas: [], crisis: false },
  tonight: { date: "2026-11-08", exists: false },
  word: null,
  quote: null,
  sky: { schedule: null },
  ...extra,
})

/** The MCP result the bridge stores: the API's JSON as structuredContent and as the text */
const envelope = (answer: unknown) => ({
  isError: false,
  content: [{ type: "text", text: JSON.stringify(answer) }],
  structuredContent: answer,
})

describe("todayOfToolOutput: which answers are a today", () => {
  it("reads get_today's routine from structuredContent", () => {
    const parsed = todayOfToolOutput(envelope(today([item()])))
    expect(parsed).toEqual({
      date: "2026-11-08",
      items: [
        {
          id: "0b7c1e2a-3f4d-4a5b-8c6d-7e8f9a0b1c2d",
          title: "Morning prayer",
          bucket: "morning",
          timeOfDay: "07:00",
          mark: "done",
          weekDone: 4,
        },
      ],
      longRoutine: false,
    })
  })

  // A server that sends no structuredContent still answers: the text part holds the same JSON.
  it("reads the text part when there is no structuredContent", () => {
    const answer = today([item()])
    const parsed = todayOfToolOutput({
      isError: false,
      content: [{ type: "text", text: JSON.stringify(answer) }],
    })
    expect(parsed?.items).toHaveLength(1)
  })

  it("answers an empty routine as a today with no items", () => {
    expect(todayOfToolOutput(envelope(today([])))).toEqual({
      date: "2026-11-08",
      items: [],
      longRoutine: false,
    })
  })

  it("is null for a refusal, a meetings answer, another Daily Dash answer and junk", () => {
    expect(
      todayOfToolOutput({ isError: true, content: [{ type: "text", text: "No." }] }),
    ).toBeNull()
    expect(todayOfToolOutput(envelope({ meetings: [] }))).toBeNull()
    // get_pillars: no asOf, no routine
    expect(todayOfToolOutput(envelope({ pillars: [] }))).toBeNull()
    // add_routine_item answers one RoutineItem, not a today
    expect(todayOfToolOutput(envelope(item()))).toBeNull()
    for (const junk of [null, undefined, 0, "", "today", [], {}, { content: "x" }]) {
      expect(todayOfToolOutput(junk)).toBeNull()
    }
  })

  it("needs the day as a calendar date and the items as a list", () => {
    expect(todayOfToolOutput(envelope(today([item()], { asOf: { date: "Sunday" } })))).toBeNull()
    expect(todayOfToolOutput(envelope(today([item()], { asOf: null })))).toBeNull()
    expect(
      todayOfToolOutput(envelope({ ...today([]), routine: { items: "none", warnings: [] } })),
    ).toBeNull()
  })

  it("flags a long routine from the server's warnings", () => {
    const answer = today([item()])
    answer.routine.warnings = ["long_routine"] as never
    expect(todayOfToolOutput(envelope(answer))?.longRoutine).toBe(true)
  })
})

describe("todayOfToolOutput: each item", () => {
  it("reads done, set aside and not yet from the tick", () => {
    const parsed = todayOfToolOutput(
      envelope(
        today([
          item({ id: "a", tick: { status: "done", at: null } }),
          item({ id: "b", tick: { status: "skipped", at: null } }),
          item({ id: "c", tick: null }),
          // A status the API grows later reads as not yet, as My Day reads it (ticks.ts markOf)
          item({ id: "d", tick: { status: "paused", at: null } }),
        ]),
      ),
    )
    expect(parsed?.items.map((i) => i.mark)).toEqual(["done", "skipped", "open", "open"])
  })

  it("keeps an item without a time, and drops a time that is not text", () => {
    const parsed = todayOfToolOutput(
      envelope(today([item({ id: "a", timeOfDay: null }), item({ id: "b", timeOfDay: 7 })])),
    )
    expect(parsed?.items.map((i) => i.timeOfDay)).toEqual([null, null])
  })

  it("shows no week count it cannot trust", () => {
    const parsed = todayOfToolOutput(
      envelope(
        today([
          item({ id: "a", weekDone: 0 }),
          item({ id: "b", weekDone: -1 }),
          item({ id: "c", weekDone: 2.5 }),
          item({ id: "d", weekDone: "3" }),
        ]),
      ),
    )
    expect(parsed?.items.map((i) => i.weekDone)).toEqual([0, null, null, null])
  })

  // The row's key is the id, and the title is all a row draws: without either there is no row.
  it("drops an item with no id or no title, and an id listed twice keeps its first", () => {
    const parsed = todayOfToolOutput(
      envelope(
        today([
          item({ id: "", title: "No id" }),
          item({ id: "a", title: "   " }),
          item({ id: "b", title: "First" }),
          item({ id: "b", title: "Again" }),
          "junk",
        ]),
      ),
    )
    expect(parsed?.items.map((i) => i.title)).toEqual(["First"])
  })

  // A list of entries none of which can draw is not "your routine is empty": that would be false.
  it("is null when the list held entries and none could draw", () => {
    expect(todayOfToolOutput(envelope(today([item({ id: "" }), "junk"])))).toBeNull()
  })

  it("keeps a bucket it does not know, for the card to list under Other", () => {
    const parsed = todayOfToolOutput(envelope(today([item({ bucket: "night" })])))
    expect(parsed?.items[0].bucket).toBe("night")
  })
})

describe("routineBucketsOf", () => {
  const routine = (entries: Array<[string, string]>) =>
    todayOfToolOutput(envelope(today(entries.map(([id, bucket]) => item({ id, bucket })))))!.items

  // My Day's order (my-day buckets.ts BUCKET_ORDER), the server's order inside each part.
  it("groups by part of the day in day order, keeping the server's order inside each", () => {
    const groups = routineBucketsOf(
      routine([
        ["e1", "evening"],
        ["m1", "morning"],
        ["y1", "anytime"],
        ["m2", "morning"],
        ["a1", "afternoon"],
      ]),
    )
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["morning", ["m1", "m2"]],
      ["afternoon", ["a1"]],
      ["evening", ["e1"]],
      ["anytime", ["y1"]],
    ])
  })

  it("drops empty parts and lists unknown buckets last as other", () => {
    const groups = routineBucketsOf(
      routine([
        ["x1", "night"],
        ["e1", "evening"],
        ["x2", ""],
      ]),
    )
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ["evening", ["e1"]],
      ["other", ["x1", "x2"]],
    ])
  })

  it("answers nothing for an empty routine", () => {
    expect(routineBucketsOf([])).toEqual([])
  })
})

describe("routineDayHeading", () => {
  const words = {
    days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    months: [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ],
  }

  // The person's own date, read as a calendar date with no zone (my-day todayLogic dayHeading)
  it("reads the person's date as a weekday and a day of the month", () => {
    expect(routineDayHeading("2026-11-08", words)).toBe("Sunday, November 8")
    expect(routineDayHeading("2026-01-01", words)).toBe("Thursday, January 1")
  })

  it("shows anything that is not a calendar date as it came", () => {
    expect(routineDayHeading("2026-13-01", words)).toBe("2026-13-01")
    expect(routineDayHeading("soon", words)).toBe("soon")
  })
})

describe("routineProgressOf", () => {
  const items = (marks: Array<"done" | "skipped" | "open">) =>
    todayOfToolOutput(
      envelope(
        today(
          marks.map((mark, i) =>
            item({ id: `i${i}`, tick: mark === "open" ? null : { status: mark, at: null } }),
          ),
        ),
      ),
    )!.items

  // The card's "3 of 6 done": a set-aside item is in the total and not done, as My Day reads it.
  it("counts done items over every item, set aside ones included", () => {
    expect(routineProgressOf(items(["done", "done", "open", "skipped", "open", "done"]))).toEqual({
      done: 3,
      total: 6,
      percent: 50,
    })
  })

  it("is nought of nought for no routine", () => {
    expect(routineProgressOf([])).toEqual({ done: 0, total: 0, percent: 0 })
  })

  // The bar's share. Rounded, but never full until all are done, nor empty once one is.
  it("rounds the share, and keeps a part-done bar off both ends", () => {
    const of = (done: number, total: number) =>
      routineProgressOf(items([...Array(done).fill("done"), ...Array(total - done).fill("open")]))
        .percent
    expect(of(1, 3)).toBe(33)
    expect(of(2, 3)).toBe(67)
    expect(of(0, 5)).toBe(0)
    expect(of(5, 5)).toBe(100)
    expect(of(199, 200)).toBe(99)
    expect(of(1, 201)).toBe(1)
  })
})
