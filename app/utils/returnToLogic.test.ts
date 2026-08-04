import { describe, expect, it } from "vitest"

import { buildMeetingReturnTo, parseReturnTo } from "./returnToLogic"

describe("parseReturnTo", () => {
  describe("empty input", () => {
    it.each([undefined, null, ""])("resolves %p to none", (input) => {
      expect(parseReturnTo(input)).toEqual({ kind: "none" })
    })
  })

  describe("screen forms", () => {
    it("parses a tab with a section", () => {
      expect(parseReturnTo("Attendance:new")).toEqual({
        kind: "screen",
        screen: "Attendance",
        section: "new",
      })
    })

    it("parses a bare tab with no section", () => {
      expect(parseReturnTo("Attendance")).toEqual({ kind: "screen", screen: "Attendance" })
    })

    it("omits an empty section rather than passing a blank string", () => {
      // "Attendance:" would otherwise navigate with { section: "" }, which
      // AttendanceScreen's focus listener would treat as a real section.
      expect(parseReturnTo("Attendance:")).toEqual({ kind: "screen", screen: "Attendance" })
    })
  })

  describe("legacy live form", () => {
    // This form is written to MMKV (SUBSCRIPTION_RETURN) and can outlive an
    // app update, so it must keep parsing. Dropping it strands a paying user.
    it("parses Meetings:meetingId:<id> as the live segment", () => {
      expect(parseReturnTo("Meetings:meetingId:abc123")).toEqual({
        kind: "meetingPopup",
        segment: "live",
        meetingId: "abc123",
      })
    })

    it("falls back to the tab when the id is missing", () => {
      expect(parseReturnTo("Meetings:meetingId")).toEqual({ kind: "meetingsTab" })
      expect(parseReturnTo("Meetings:meetingId:")).toEqual({ kind: "meetingsTab" })
    })
  })

  describe("segment-carrying form", () => {
    it("parses the in-person segment", () => {
      expect(parseReturnTo("Meetings:inperson:meetingId:xyz789")).toEqual({
        kind: "meetingPopup",
        segment: "inperson",
        meetingId: "xyz789",
      })
    })

    it("parses an explicit live segment", () => {
      expect(parseReturnTo("Meetings:live:meetingId:xyz789")).toEqual({
        kind: "meetingPopup",
        segment: "live",
        meetingId: "xyz789",
      })
    })

    it("rejects a segment with no popup to restore", () => {
      // "listings" is a real MeetingsSegment but its cells open SchedulePopup,
      // which emits the legacy live form — there is no listings consumer.
      expect(parseReturnTo("Meetings:listings:meetingId:xyz789")).toEqual({ kind: "meetingsTab" })
    })

    it("rejects an unknown segment", () => {
      expect(parseReturnTo("Meetings:bogus:meetingId:xyz789")).toEqual({ kind: "meetingsTab" })
    })

    it("falls back to the tab when the id is missing", () => {
      expect(parseReturnTo("Meetings:inperson:meetingId")).toEqual({ kind: "meetingsTab" })
      expect(parseReturnTo("Meetings:inperson:meetingId:")).toEqual({ kind: "meetingsTab" })
    })

    it("falls back to the tab on a malformed middle token", () => {
      expect(parseReturnTo("Meetings:inperson:nope:xyz789")).toEqual({ kind: "meetingsTab" })
    })
  })

  it("never returns none for a Meetings form — a paying user must land somewhere", () => {
    expect(parseReturnTo("Meetings")).toEqual({ kind: "meetingsTab" })
    expect(parseReturnTo("Meetings:")).toEqual({ kind: "meetingsTab" })
  })
})

describe("buildMeetingReturnTo", () => {
  it("round-trips through parseReturnTo", () => {
    const built = buildMeetingReturnTo("inperson", "abc123")
    expect(built).toBe("Meetings:inperson:meetingId:abc123")
    expect(parseReturnTo(built)).toEqual({
      kind: "meetingPopup",
      segment: "inperson",
      meetingId: "abc123",
    })
  })

  it("round-trips the live segment too", () => {
    expect(parseReturnTo(buildMeetingReturnTo("live", "id-1"))).toEqual({
      kind: "meetingPopup",
      segment: "live",
      meetingId: "id-1",
    })
  })
})
