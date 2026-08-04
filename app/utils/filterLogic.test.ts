import { describe, expect, it } from "vitest"

import {
  DEFAULT_SEARCH_TIME,
  DEFAULT_SHORT_TIME,
  matchesHourRange,
  matchesSearchTime,
  matchesShortTime,
  matchesVenue,
  poolsForVenue,
  radiusAppliesTo,
  SEARCH_TIME_OPTIONS,
  SHORT_TIME_OPTIONS,
  SHORT_TIME_RANGES,
  type ShortTime,
  VENUE_OPTIONS,
} from "./filterLogic"

/**
 * Build an instant whose *local* hour is exactly `hour`.
 *
 * The multi-arg Date constructor interprets its arguments in the device's
 * timezone, and `matchesShortTime` reads the local hour back out — so this
 * round-trips identically on any machine. Building from a UTC millis literal
 * instead would make every assertion below timezone-dependent, and the suite
 * would pass in one CI region and fail in another.
 */
function atLocalHour(hour: number): number {
  return new Date(2026, 7, 4, hour, 30, 0).getTime()
}

describe("matchesShortTime", () => {
  it("matches everything for the neutral bucket", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(matchesShortTime(atLocalHour(hour), "all")).toBe(true)
    }
  })

  it("puts a sunrise meeting in morning, not overnight", () => {
    // The whole reason for the 05:00 boundary — 6am meetings are a fixture of
    // recovery culture and people look for them under "morning".
    expect(matchesShortTime(atLocalHour(6), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(6), "overnight")).toBe(false)
  })

  it("honours morning's boundaries", () => {
    expect(matchesShortTime(atLocalHour(4), "morning")).toBe(false)
    expect(matchesShortTime(atLocalHour(5), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(11), "morning")).toBe(true)
    expect(matchesShortTime(atLocalHour(12), "morning")).toBe(false)
  })

  it("honours afternoon's boundaries", () => {
    expect(matchesShortTime(atLocalHour(11), "afternoon")).toBe(false)
    expect(matchesShortTime(atLocalHour(12), "afternoon")).toBe(true)
    expect(matchesShortTime(atLocalHour(16), "afternoon")).toBe(true)
    expect(matchesShortTime(atLocalHour(17), "afternoon")).toBe(false)
  })

  it("honours evening's boundaries", () => {
    expect(matchesShortTime(atLocalHour(16), "evening")).toBe(false)
    expect(matchesShortTime(atLocalHour(17), "evening")).toBe(true)
    expect(matchesShortTime(atLocalHour(21), "evening")).toBe(true)
    expect(matchesShortTime(atLocalHour(22), "evening")).toBe(false)
  })

  it("wraps overnight across midnight", () => {
    // The only bucket where startHour > endHour. Both sides of midnight match.
    expect(matchesShortTime(atLocalHour(21), "overnight")).toBe(false)
    expect(matchesShortTime(atLocalHour(22), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(23), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(0), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(3), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(4), "overnight")).toBe(true)
    expect(matchesShortTime(atLocalHour(5), "overnight")).toBe(false)
  })

  it("assigns every hour of the day to exactly one bucket", () => {
    // Guards the no-gaps/no-overlap invariant the SHORT_TIME_RANGES comment
    // claims. Shifting one boundary without its neighbour would either hide
    // meetings from every bucket or double-count them, and neither shows up in
    // the boundary tests above.
    const buckets = SHORT_TIME_OPTIONS.filter((b): b is Exclude<ShortTime, "all"> => b !== "all")

    for (let hour = 0; hour < 24; hour++) {
      const matched = buckets.filter((b) => matchesShortTime(atLocalHour(hour), b))
      expect(
        matched,
        `hour ${hour} matched ${matched.length} buckets: ${matched.join(", ")}`,
      ).toHaveLength(1)
    }
  })

  it("exposes a range for every non-neutral option", () => {
    // If someone adds an option to SHORT_TIME_OPTIONS but forgets the range,
    // matchesShortTime silently falls back to "match everything".
    for (const option of SHORT_TIME_OPTIONS) {
      if (option === "all") continue
      expect(SHORT_TIME_RANGES[option]).toBeDefined()
    }
  })

  it("defaults to the neutral bucket", () => {
    expect(DEFAULT_SHORT_TIME).toBe("all")
    expect(SHORT_TIME_OPTIONS[0]).toBe("all")
  })
})

describe("matchesVenue", () => {
  it("passes everything for the neutral choice", () => {
    for (const venueType of ["", "online", "in_person"]) {
      expect(matchesVenue(venueType, "all")).toBe(true)
    }
  })

  it("treats the empty venueType as online, not as unknown", () => {
    // Legacy rows scraped before VenueType existed carry "". Classifying them
    // as anything but online would silently hide them from an online search —
    // the same trap `isInPersonVenue` in meetingPools.ts exists to avoid.
    expect(matchesVenue("", "online")).toBe(true)
    expect(matchesVenue("", "in_person")).toBe(false)
  })

  it("splits online from in_person", () => {
    expect(matchesVenue("online", "online")).toBe(true)
    expect(matchesVenue("online", "in_person")).toBe(false)
    expect(matchesVenue("in_person", "in_person")).toBe(true)
    expect(matchesVenue("in_person", "online")).toBe(false)
  })

  it("assigns every venueType to exactly one non-neutral choice", () => {
    // Same partition guarantee the shortTime buckets carry: a row must never
    // vanish from both Online and In-Person, and never appear in both.
    for (const venueType of ["", "online", "in_person"]) {
      const matched = (["online", "in_person"] as const).filter((c) => matchesVenue(venueType, c))
      expect(matched, `venueType "${venueType}" matched ${matched.length}`).toHaveLength(1)
    }
  })
})

describe("poolsForVenue", () => {
  it("fetches both pools for the neutral choice", () => {
    expect(poolsForVenue("all")).toEqual({ online: true, inPerson: true })
  })

  it("skips the pool it doesn't need", () => {
    // The skip is the point: an online-only search must not spend a request —
    // or a location prompt — on in-person meetings.
    expect(poolsForVenue("online")).toEqual({ online: true, inPerson: false })
    expect(poolsForVenue("in_person")).toEqual({ online: false, inPerson: true })
  })

  it("never asks for zero pools", () => {
    for (const choice of VENUE_OPTIONS) {
      const pools = poolsForVenue(choice)
      expect(pools.online || pools.inPerson, `${choice} fetches nothing`).toBe(true)
    }
  })
})

describe("radiusAppliesTo", () => {
  it("is live for every choice that can surface an in-person meeting", () => {
    expect(radiusAppliesTo("all")).toBe(true)
    expect(radiusAppliesTo("in_person")).toBe(true)
  })

  it("is dead for an online-only search", () => {
    // Online meetings have no venue, so a distance can't mean anything for
    // them — the cell greys out rather than silently doing nothing.
    expect(radiusAppliesTo("online")).toBe(false)
  })

  it("agrees with poolsForVenue about when in-person rows can appear", () => {
    // These two decide the same thing from different angles; a divergence
    // would grey out the radius on a search that still returns venues.
    for (const choice of VENUE_OPTIONS) {
      expect(radiusAppliesTo(choice), choice).toBe(poolsForVenue(choice).inPerson)
    }
  })
})

describe("matchesHourRange", () => {
  it("is start-inclusive and end-exclusive", () => {
    expect(matchesHourRange(atLocalHour(9), 9, 17)).toBe(true)
    expect(matchesHourRange(atLocalHour(16), 9, 17)).toBe(true)
    expect(matchesHourRange(atLocalHour(17), 9, 17)).toBe(false)
    expect(matchesHourRange(atLocalHour(8), 9, 17)).toBe(false)
  })

  it("admits the whole day for the pickers' default range", () => {
    // start 0 / end 24 is what the Search pickers open on, and it has to be a
    // true no-op or the default view would hide the 11pm meetings.
    for (let hour = 0; hour < 24; hour++) {
      expect(matchesHourRange(atLocalHour(hour), 0, 24), `hour ${hour}`).toBe(true)
    }
  })

  it("includes the 11pm hour when end is 24", () => {
    // 24 means "through midnight"; end-exclusive arithmetic makes [23,24) the
    // only range that can hold a 23:30 meeting.
    expect(matchesHourRange(atLocalHour(23), 23, 24)).toBe(true)
    expect(matchesHourRange(atLocalHour(23), 22, 23)).toBe(false)
  })
})

describe("matchesSearchTime", () => {
  it("uses the hour range only for the custom choice", () => {
    // The 9-17 range is deliberately one a bucket would answer differently:
    // 18:00 is inside "evening" but outside [9,17).
    expect(matchesSearchTime(atLocalHour(18), "custom", 9, 17)).toBe(false)
    expect(matchesSearchTime(atLocalHour(18), "evening", 9, 17)).toBe(true)
  })

  it("ignores the hour range for every bucket choice", () => {
    // A stale custom range must not leak into a bucket selection — that would
    // make picking "Morning" return nothing for reasons nothing on screen
    // explains.
    for (const choice of SHORT_TIME_OPTIONS) {
      expect(matchesSearchTime(atLocalHour(7), choice, 20, 22), choice).toBe(
        matchesShortTime(atLocalHour(7), choice),
      )
    }
  })

  it("keeps the neutral choice neutral regardless of the range", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(matchesSearchTime(atLocalHour(hour), DEFAULT_SEARCH_TIME, 9, 10)).toBe(true)
    }
  })

  it("offers custom as an extra option, never as a bucket", () => {
    // SHORT_TIME_OPTIONS feeds the In-Person picker, which has no start/end
    // controls — leaking "custom" into it would render a dead option.
    expect(SEARCH_TIME_OPTIONS).toContain("custom")
    expect(SHORT_TIME_OPTIONS).not.toContain("custom")
    expect(SEARCH_TIME_OPTIONS).toHaveLength(SHORT_TIME_OPTIONS.length + 1)
  })
})
