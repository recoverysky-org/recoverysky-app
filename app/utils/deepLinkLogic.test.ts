import { describe, expect, it } from "vitest"

import { parseDeepLinkSegment, pendingTargetForSegment } from "./deepLinkLogic"

describe("parseDeepLinkSegment", () => {
  it("accepts the three real segment keys", () => {
    expect(parseDeepLinkSegment("live")).toBe("live")
    expect(parseDeepLinkSegment("inperson")).toBe("inperson")
    expect(parseDeepLinkSegment("listings")).toBe("listings")
  })

  it("rejects anything else, so the caller omits the param", () => {
    // "in_person" is the API's own venueType spelling — the likeliest drift,
    // and the one that would blank the Meetings tab if it reached
    // MeetingsScreen's activeSegment.
    expect(parseDeepLinkSegment("in_person")).toBeUndefined()
    expect(parseDeepLinkSegment("Live")).toBeUndefined()
    expect(parseDeepLinkSegment("")).toBeUndefined()
    expect(parseDeepLinkSegment(undefined)).toBeUndefined()
  })

  it("does not inherit Object.prototype members as valid segments", () => {
    expect(parseDeepLinkSegment("toString")).toBeUndefined()
    expect(parseDeepLinkSegment("constructor")).toBeUndefined()
  })
})

describe("pendingTargetForSegment", () => {
  it("routes in-person deep links to the in-person popup", () => {
    expect(pendingTargetForSegment("inperson")).toBe("inperson")
  })

  it("routes everything else to live, including a missing segment", () => {
    // A missing segment is what an API build predating the `segment` field
    // sends — it must keep landing on live, unchanged.
    expect(pendingTargetForSegment(undefined)).toBe("live")
    expect(pendingTargetForSegment("live")).toBe("live")
    // Search cells open SchedulePopup, which LiveContent owns.
    expect(pendingTargetForSegment("listings")).toBe("live")
  })
})
