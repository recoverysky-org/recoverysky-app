import { describe, expect, it } from "vitest"

import {
  cardShowsDay,
  meetingsOfToolOutput,
  toRowMeeting,
  type SkyMeeting,
} from "./agentMeetingsLogic"

/** A meetings-mcp Meeting as the server answers it (api docs/mcp-tools.md, checked live 2026-11-08) */
const mcpMeeting = (overrides: Record<string, unknown> = {}) => ({
  id: "22699221-9b38-4b51-908a-16706373a6b1",
  name: "A Checkup From the Neck Up",
  fellowship: "AA",
  venue: "online",
  hybrid: false,
  url: "https://us02web.zoom.us/j/670382735",
  address: null,
  venueName: null,
  language: "en",
  meetingTypes: ["VM", "EN"],
  favorite: false,
  startsAt: {
    iso: "2026-11-09T01:15:00.000Z",
    local: "Sun, Nov 8, 7:15 PM",
    timezone: "America/Chicago",
  },
  continuous: false,
  durationMinutes: 60,
  ...overrides,
})

/** The bridge's output for a successful call: the server's one text part, holding the JSON */
const envelope = (payload: unknown) => ({
  isError: false,
  content: [{ type: "text", text: JSON.stringify(payload) }],
})

const skyMeeting = (overrides: Partial<SkyMeeting> = {}): SkyMeeting => ({
  id: "m1",
  name: "Sunrise Serenity",
  fellowship: "AA",
  language: "en",
  venue: "online",
  hybrid: false,
  continuous: false,
  startsAt: Date.parse("2026-11-09T01:15:00.000Z"),
  favorite: false,
  venueName: null,
  distanceM: null,
  scheduled: true,
  ...overrides,
})

describe("meetingsOfToolOutput", () => {
  it("reads the meetings out of a list answer's text part", () => {
    const meetings = meetingsOfToolOutput(
      envelope({ total: 77, favorites: 0, returned: 1, meetings: [mcpMeeting()] }),
    )
    expect(meetings).toEqual([
      {
        id: "22699221-9b38-4b51-908a-16706373a6b1",
        name: "A Checkup From the Neck Up",
        fellowship: "AA",
        language: "en",
        venue: "online",
        hybrid: false,
        continuous: false,
        startsAt: Date.parse("2026-11-09T01:15:00.000Z"),
        favorite: false,
        venueName: null,
        distanceM: null,
        scheduled: true,
      },
    ])
  })

  it("reads get_meeting's one meeting", () => {
    const meetings = meetingsOfToolOutput(
      envelope({ meeting: mcpMeeting({ description: "We meet nightly" }), occurrences: null }),
    )
    expect(meetings?.map((meeting) => meeting.id)).toEqual(["22699221-9b38-4b51-908a-16706373a6b1"])
  })

  it("keeps the server's order, favorites first as it sent them", () => {
    const meetings = meetingsOfToolOutput(
      envelope({
        meetings: [
          mcpMeeting({ id: "fav", favorite: true }),
          mcpMeeting({ id: "a" }),
          mcpMeeting({ id: "b" }),
        ],
      }),
    )
    expect(meetings?.map((meeting) => [meeting.id, meeting.favorite])).toEqual([
      ["fav", true],
      ["a", false],
      ["b", false],
    ])
  })

  // The agent's cards rule: every meeting a call returned reaches the person, and `limit` goes to 50.
  it("draws every meeting returned, past ten", () => {
    const list = Array.from({ length: 50 }, (_, index) => mcpMeeting({ id: `m${index}` }))
    expect(meetingsOfToolOutput(envelope({ meetings: list }))).toHaveLength(50)
  })

  it("reads an in-person meeting's venue name and distance", () => {
    const [meeting] = meetingsOfToolOutput(
      envelope({
        meetings: [
          mcpMeeting({
            venue: "in_person",
            venueName: "Lincoln Park Alano Club",
            address: "2100 N. Sheffield Avenue, Chicago, IL, 60614",
            distance_m: 543,
          }),
        ],
      }),
    )!
    expect(meeting).toMatchObject({
      venue: "in_person",
      venueName: "Lincoln Park Alano Club",
      distanceM: 543,
    })
  })

  it("answers an empty list as no meetings, for the card's empty state", () => {
    expect(meetingsOfToolOutput(envelope({ total: 0, returned: 0, meetings: [] }))).toEqual([])
  })

  it("prefers structured content when a server sends it", () => {
    const output = {
      isError: false,
      content: [{ type: "text", text: JSON.stringify({ meetings: [mcpMeeting({ id: "text" })] }) }],
      structuredContent: { meetings: [mcpMeeting({ id: "structured" })] },
    }
    expect(meetingsOfToolOutput(output)?.map((meeting) => meeting.id)).toEqual(["structured"])
  })

  it("lists a meeting once", () => {
    const meetings = meetingsOfToolOutput(
      envelope({ meetings: [mcpMeeting({ id: "m1" }), mcpMeeting({ id: "m1", name: "Again" })] }),
    )
    expect(meetings?.map((meeting) => meeting.name)).toEqual(["A Checkup From the Neck Up"])
  })

  describe("the start it shows", () => {
    it("uses find_favorite_meetings' first occurrence when startsAt is null", () => {
      const [meeting] = meetingsOfToolOutput(
        envelope({
          meetings: [
            mcpMeeting({
              startsAt: null,
              occurrences: [
                { iso: "2026-11-10T02:00:00.000Z" },
                { iso: "2026-11-11T02:00:00.000Z" },
              ],
            }),
          ],
        }),
      )!
      expect(meeting.startsAt).toBe(Date.parse("2026-11-10T02:00:00.000Z"))
    })

    it.each([
      ["null", null],
      ["an iso that is not a date", { iso: "soon" }],
      ["no iso", { local: "Sun, 7:15 PM" }],
      ["a string", "2026-11-09T01:15:00.000Z"],
    ])("is none for a startsAt that is %s", (_name, startsAt) => {
      const [meeting] = meetingsOfToolOutput(envelope({ meetings: [mcpMeeting({ startsAt })] }))!
      expect(meeting.startsAt).toBeNull()
    })
  })

  // find_favorite_meetings lists a favorite in no active schedule last, with empty `occurrences`
  // (api docs/mcp-tools.md). Its lookup can only 404, so the card must know before a tap sends one.
  describe("whether it has a schedule to open", () => {
    it("has none when find_favorite_meetings lists no occurrences", () => {
      const [meeting] = meetingsOfToolOutput(
        envelope({ meetings: [mcpMeeting({ startsAt: null, favorite: true, occurrences: [] })] }),
      )!
      expect(meeting).toMatchObject({ scheduled: false, favorite: true, startsAt: null })
    })

    it("has one when the occurrences list an instant", () => {
      const [meeting] = meetingsOfToolOutput(
        envelope({
          meetings: [mcpMeeting({ occurrences: [{ iso: "2026-11-10T02:00:00.000Z" }] })],
        }),
      )!
      expect(meeting.scheduled).toBe(true)
    })

    // Most tools send no `occurrences` at all; get_meeting's null sits on the answer, not the
    // meeting, and also means `include_schedule: false`. Neither says the schedule is gone.
    it.each([
      ["no occurrences field", {}],
      ["occurrences that are null", { occurrences: null }],
      ["occurrences that are not a list", { occurrences: "none" }],
    ])("assumes one for %s", (_name, overrides) => {
      const [meeting] = meetingsOfToolOutput(envelope({ meetings: [mcpMeeting(overrides)] }))!
      expect(meeting.scheduled).toBe(true)
    })
  })

  // A turn's tools are not only meetings-mcp's: memory, literature, the manual and the Daily Dash.
  it.each([
    ["a reminder list", { count: 1, reminders: [{ id: "r1", mid: "m1" }] }],
    ["attendance", { days: 30, summary: { count: 2 }, recent: [{ id: "a1", mid: "m1" }] }],
    ["the fellowships", { fellowships: [{ code: "AA", name: "Alcoholics Anonymous" }] }],
    ["a meetings field that is not a list", { meetings: { not: "a list" } }],
  ])("answers null for %s, which is not a meeting answer", (_name, payload) => {
    expect(meetingsOfToolOutput(envelope(payload))).toBeNull()
  })

  it("answers null for a refusal", () => {
    const refusal = {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ code: "rate_limited", message: "Slow down", meetings: [] }),
        },
      ],
    }
    expect(meetingsOfToolOutput(refusal)).toBeNull()
  })

  it("answers null for the SDK's plain-text refusal", () => {
    const refusal = {
      isError: true,
      content: [{ type: "text", text: "MCP error -32602: Input validation error" }],
    }
    expect(meetingsOfToolOutput(refusal)).toBeNull()
  })

  // The retired findMeetings / getLiveMeetings answered this shape, with no venue and a time as
  // words. Threads from before the switch still hold it: those draw the finished badge, not a card
  // that claims there were no meetings.
  it("answers null for the retired tools' list, which has nothing a card can open", () => {
    const retired = {
      meetings: [
        { id: "m1", scheduleId: "s1", name: "Sunrise", fellowship: "AA", time: "7:00 PM" },
      ],
    }
    expect(meetingsOfToolOutput(retired)).toBeNull()
    expect(meetingsOfToolOutput(envelope(retired))).toBeNull()
  })

  // Parts read back from the agent are checked only for being an array, so anything can be here.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 7],
    ["a string", "meetings"],
    ["a list", [mcpMeeting()]],
    ["an envelope with no content", { isError: false }],
    ["content that is not a list", { isError: false, content: "text" }],
    [
      "a text part that is not JSON",
      { isError: false, content: [{ type: "text", text: "{nope" }] },
    ],
    ["JSON that is not an object", envelope([mcpMeeting()])],
    ["JSON null", envelope(null)],
    ["a part that is not text", { isError: false, content: [{ type: "image", data: "x" }] }],
    [
      "a text part whose text is not a string",
      { isError: false, content: [{ type: "text", text: 7 }] },
    ],
  ])("answers null, never a throw, for %s", (_name, output) => {
    expect(meetingsOfToolOutput(output)).toBeNull()
  })

  it("draws the meetings it can, past junk in the list", () => {
    const meetings = meetingsOfToolOutput(
      envelope({
        meetings: [
          null,
          7,
          "a string",
          {},
          mcpMeeting({ id: "" }),
          mcpMeeting({ id: "x".repeat(65) }),
          mcpMeeting({ id: 7 }),
          mcpMeeting({ id: "no-name", name: "" }),
          mcpMeeting({ id: "object-name", name: { not: "a string" } }),
          mcpMeeting({ id: "no-venue", venue: undefined }),
          mcpMeeting({ id: "odd-venue", venue: "hybrid" }),
          mcpMeeting({ id: "good" }),
        ],
      }),
    )
    expect(meetings?.map((meeting) => meeting.id)).toEqual(["good"])
  })

  it("answers null for a list of nothing but junk", () => {
    expect(meetingsOfToolOutput(envelope({ meetings: [null, 7, {}] }))).toBeNull()
  })

  it("reads odd optional fields as absent, so the row draws what is there", () => {
    const [meeting] = meetingsOfToolOutput(
      envelope({
        meetings: [
          mcpMeeting({
            fellowship: { code: "AA" },
            language: 5,
            hybrid: "yes",
            continuous: "yes",
            favorite: "yes",
            venueName: "",
            distance_m: -3,
          }),
        ],
      }),
    )!
    expect(meeting).toMatchObject({
      fellowship: null,
      language: null,
      hybrid: false,
      continuous: false,
      favorite: false,
      venueName: null,
      distanceM: null,
    })
  })
})

describe("toRowMeeting", () => {
  it("gives MeetingRow the start as its millis", () => {
    expect(toRowMeeting(skyMeeting())).toEqual({
      name: "Sunrise Serenity",
      fellowship: "AA",
      language: "en",
      millis: Date.parse("2026-11-09T01:15:00.000Z"),
      venueName: null,
      hybrid: false,
    })
  })

  // MeetingRow draws millis 0 as "24h".
  it("gives an always-on room millis 0", () => {
    expect(toRowMeeting(skyMeeting({ continuous: true, startsAt: null })).millis).toBe(0)
    expect(toRowMeeting(skyMeeting({ continuous: true })).millis).toBe(0)
  })

  // MeetingRow's two readers of millis both draw a non-finite one as no time and no day.
  it("gives a meeting with no start no time", () => {
    expect(toRowMeeting(skyMeeting({ startsAt: null })).millis).toBeNaN()
  })
})

describe("cardShowsDay", () => {
  const at = (iso: string) => new Date(iso).getTime()
  // Local dates, so the test holds in any timezone the machine runs in.
  const now = new Date(2026, 10, 8, 19, 0).getTime()
  const today = new Date(2026, 10, 8, 21, 15).getTime()
  const thursday = new Date(2026, 10, 5, 19, 30).getTime()

  it("is false when every meeting starts today", () => {
    expect(
      cardShowsDay([skyMeeting({ startsAt: today }), skyMeeting({ startsAt: now })], now),
    ).toBe(false)
  })

  // find_meetings_nearby with any day answers this week's instant, which can be days away.
  it("is true when one starts on another day", () => {
    expect(
      cardShowsDay([skyMeeting({ startsAt: today }), skyMeeting({ startsAt: thursday })], now),
    ).toBe(true)
  })

  it("leaves always-on rooms and meetings with no start out of it", () => {
    expect(
      cardShowsDay(
        [
          skyMeeting({ startsAt: today }),
          skyMeeting({ continuous: true, startsAt: thursday }),
          skyMeeting({ startsAt: null }),
        ],
        now,
      ),
    ).toBe(false)
  })

  it("is false for no meetings", () => {
    expect(cardShowsDay([], at("2026-11-08T12:00:00Z"))).toBe(false)
  })
})
