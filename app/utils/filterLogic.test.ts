import { describe, expect, it } from "vitest"

import {
  ANY_DAY,
  anyDayAllowedFor,
  coerceDay,
  coerceVenue,
  DEFAULT_SEARCH_TIME,
  DEFAULT_SHORT_TIME,
  DEFAULT_VENUE,
  ISO_DAYS,
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
  venueOptionsFor,
  availableTags,
  buildSearchHaystack,
  matchesFreeText,
  matchesTags,
  normalizeSearchText,
  tokenizeQuery,
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

  it("assigns every venueType to exactly one choice", () => {
    // Same partition guarantee the shortTime buckets carry: a row must never
    // vanish from both Online and In-Person, and never appear in both. With
    // "all" removed (2026-08-04) this covers the whole option list, so a row
    // that matches nothing is now genuinely unreachable in Search.
    for (const venueType of ["", "online", "in_person"]) {
      const matched = VENUE_OPTIONS.filter((c) => matchesVenue(venueType, c))
      expect(matched, `venueType "${venueType}" matched ${matched.length}`).toHaveLength(1)
    }
  })
})

describe("poolsForVenue", () => {
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

  it("defaults to the pool that needs no location", () => {
    // The lazy-permission rule in shape: arriving on Search must not fetch a
    // pool that would prompt for GPS. Changing DEFAULT_VENUE to "in_person"
    // would do exactly that, so this test is the guard.
    expect(poolsForVenue(DEFAULT_VENUE)).toEqual({ online: true, inPerson: false })
  })
})

describe("venueOptionsFor", () => {
  it("offers everything when location is on", () => {
    expect(venueOptionsFor(true)).toEqual(VENUE_OPTIONS)
  })

  it("drops every choice that needs a location fix when location is off", () => {
    const options = venueOptionsFor(false)
    expect(options).toEqual(["online"])
    // Stated as a rule rather than a literal so a future third venue can't
    // slip into the picker without deciding whether it needs a fix.
    for (const choice of options) {
      expect(poolsForVenue(choice).inPerson, `${choice} needs a fix`).toBe(false)
    }
  })

  it("never empties the picker", () => {
    // A filter cell with no options is a dead control — the whole point of
    // removing in-person is that the user still has a working search.
    expect(venueOptionsFor(false).length).toBeGreaterThan(0)
  })
})

describe("coerceVenue", () => {
  it("leaves a valid choice alone", () => {
    expect(coerceVenue("in_person", true)).toBe("in_person")
    expect(coerceVenue("online", true)).toBe("online")
    expect(coerceVenue("online", false)).toBe("online")
  })

  it("falls back when the toggle goes off under an in-person search", () => {
    // The Meetings tab stays mounted behind Settings, so this is a live
    // transition, not a cold-start case.
    expect(coerceVenue("in_person", false)).toBe(DEFAULT_VENUE)
  })

  it("only ever returns something the picker offers", () => {
    for (const locationEnabled of [true, false]) {
      for (const choice of VENUE_OPTIONS) {
        const coerced = coerceVenue(choice, locationEnabled)
        expect(venueOptionsFor(locationEnabled), `${choice}/${locationEnabled}`).toContain(coerced)
      }
    }
  })
})

describe("radiusAppliesTo", () => {
  it("is live for every choice that can surface an in-person meeting", () => {
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

describe("ANY_DAY", () => {
  it("cannot collide with a real ISO weekday", () => {
    // The entire safety of the sentinel rests on this. ISO 8601 numbers
    // weekdays 1..7 and never uses 0, so a `day === ANY_DAY` check can never
    // swallow a genuine selection.
    expect(ISO_DAYS.map((d) => d.iso)).not.toContain(ANY_DAY)
    expect(ANY_DAY).toBe(0)
  })

  it("covers all seven weekdays exactly once", () => {
    // Guards the picker against a duplicated or dropped day after an edit —
    // a missing entry silently renders six options.
    expect(ISO_DAYS.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe("anyDayAllowedFor", () => {
  it("allows Any for in-person searches, which are radius-bounded", () => {
    expect(anyDayAllowedFor("in_person")).toBe(true)
  })

  it("refuses Any for online searches", () => {
    // Not a technical limit — an online day is already ~500 rows, so seven of
    // them is a wall of noise for exactly the users with the most results.
    expect(anyDayAllowedFor("online")).toBe(false)
  })

  it("agrees with radiusAppliesTo about which venue is bounded", () => {
    // Both answer "is this venue choice constrained by distance?". If they
    // ever disagree, one of them is wrong — Any is only safe *because* the
    // radius bounds the result set.
    for (const choice of VENUE_OPTIONS) {
      expect(anyDayAllowedFor(choice), choice).toBe(radiusAppliesTo(choice))
    }
  })
})

describe("coerceDay", () => {
  const TODAY = 3 // Wednesday

  it("snaps Any back to today when the venue cannot have it", () => {
    // The toggle-flipped-while-you-were-here case, same as coerceVenue: a
    // seven-day list must not survive a switch to Online.
    expect(coerceDay(ANY_DAY, "online", TODAY)).toBe(TODAY)
  })

  it("leaves Any alone for in-person", () => {
    expect(coerceDay(ANY_DAY, "in_person", TODAY)).toBe(ANY_DAY)
  })

  it("never touches a real weekday, whatever the venue", () => {
    // Coercion is only ever about the sentinel. Rewriting a real selection
    // would silently move the user off the day they picked.
    for (const { iso } of ISO_DAYS) {
      for (const choice of VENUE_OPTIONS) {
        expect(coerceDay(iso, choice, TODAY), `${iso}/${choice}`).toBe(iso)
      }
    }
  })

  it("always returns a day the picker would accept", () => {
    // The invariant the callers rely on: whatever comes out is either a real
    // weekday or an Any that this venue is allowed to have.
    for (const day of [ANY_DAY, ...ISO_DAYS.map((d) => d.iso)]) {
      for (const choice of VENUE_OPTIONS) {
        const coerced = coerceDay(day, choice, TODAY)
        const valid = coerced === ANY_DAY ? anyDayAllowedFor(choice) : coerced >= 1 && coerced <= 7
        expect(valid, `${day}/${choice} → ${coerced}`).toBe(true)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Free text + tag search (Search segment, 2026-09-05)
// ---------------------------------------------------------------------------

describe("normalizeSearchText", () => {
  it("lowercases", () => {
    expect(normalizeSearchText("Big Book")).toBe("big book")
  })

  it("strips diacritics so accented and plain spellings match", () => {
    expect(normalizeSearchText("Café Réunion")).toBe("cafe reunion")
  })

  it("collapses runs of whitespace and trims", () => {
    expect(normalizeSearchText("  step   work \n")).toBe("step work")
  })
})

describe("tokenizeQuery", () => {
  it("splits on whitespace into normalized tokens", () => {
    expect(tokenizeQuery("Step  Work")).toEqual(["step", "work"])
  })

  it("returns no tokens for blank input", () => {
    expect(tokenizeQuery("   ")).toEqual([])
    expect(tokenizeQuery("")).toEqual([])
  })
})

describe("buildSearchHaystack", () => {
  it("joins every searchable text field, normalized", () => {
    const hay = buildSearchHaystack({
      name: "Sunrise Serenity",
      description: "Open discussion",
      venueName: "St. Mark's",
      city: "Austin",
      state: "TX",
      region: "Central",
      locationInfo: "Basement, use side door",
      restrictedDescription: "LGBTQ+ Focus",
      tags: ["beginner-friendly"],
      meetingTypes: ["O", "BB"],
    })
    for (const needle of [
      "sunrise serenity",
      "open discussion",
      "st. mark's",
      "austin",
      "tx",
      "central",
      "basement, use side door",
      "lgbtq+ focus",
      "beginner-friendly",
      "bb",
    ]) {
      expect(hay).toContain(needle)
    }
  })

  it("tolerates missing and null fields", () => {
    expect(buildSearchHaystack({ name: "Only Name", tags: null, description: undefined })).toBe(
      "only name",
    )
  })

  it("separates fields so a token cannot span two of them", () => {
    // "bookopen" must not match name "Big Book" + description "Open".
    const hay = buildSearchHaystack({ name: "Big Book", description: "Open" })
    expect(matchesFreeText(hay, ["bookopen"])).toBe(false)
  })
})

describe("matchesFreeText", () => {
  const hay = buildSearchHaystack({
    name: "Sunrise Serenity",
    description: "Open discussion, step work welcome",
    tags: ["beginner-friendly"],
    meetingTypes: ["BB"],
  })

  it("matches every meeting when there are no tokens", () => {
    expect(matchesFreeText(hay, [])).toBe(true)
  })

  it("matches a substring of any field", () => {
    expect(matchesFreeText(hay, ["seren"])).toBe(true)
  })

  it("requires every token to match (AND)", () => {
    expect(matchesFreeText(hay, ["sunrise", "step"])).toBe(true)
    expect(matchesFreeText(hay, ["sunrise", "zumba"])).toBe(false)
  })

  it("matches a tag as plain text", () => {
    expect(matchesFreeText(hay, ["beginner"])).toBe(true)
  })

  it("matches a meeting type code as plain text", () => {
    expect(matchesFreeText(hay, ["bb"])).toBe(true)
  })
})

describe("matchesTags", () => {
  it("matches every meeting when nothing is selected", () => {
    expect(matchesTags(["x"], [])).toBe(true)
    expect(matchesTags(undefined, [])).toBe(true)
  })

  it("requires every selected tag to be present (AND)", () => {
    expect(matchesTags(["a", "b"], ["a"])).toBe(true)
    expect(matchesTags(["a", "b"], ["a", "b"])).toBe(true)
    expect(matchesTags(["a"], ["a", "b"])).toBe(false)
  })

  it("rejects a meeting with no tags when something is selected", () => {
    expect(matchesTags(undefined, ["a"])).toBe(false)
    expect(matchesTags(null, ["a"])).toBe(false)
    expect(matchesTags([], ["a"])).toBe(false)
  })
})

describe("availableTags", () => {
  const pool = [
    { tags: ["step-work", "beginner-friendly"] },
    { tags: ["step-work"] },
    { tags: ["literature-study"] },
    { tags: null },
    {},
  ]

  it("lists each distinct tag in the pool, most frequent first, then alphabetical", () => {
    expect(availableTags(pool, [])).toEqual(["step-work", "beginner-friendly", "literature-study"])
  })

  it("keeps a selected tag visible even when the pool no longer carries it", () => {
    expect(availableTags(pool, ["women-only"])).toEqual([
      "step-work",
      "beginner-friendly",
      "literature-study",
      "women-only",
    ])
  })

  it("does not duplicate a selected tag that is also in the pool", () => {
    expect(availableTags(pool, ["step-work"])).toEqual([
      "step-work",
      "beginner-friendly",
      "literature-study",
    ])
  })

  it("returns an empty list for an empty pool with nothing selected", () => {
    expect(availableTags([], [])).toEqual([])
  })
})
