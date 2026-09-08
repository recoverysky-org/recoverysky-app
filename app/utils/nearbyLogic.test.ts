import { describe, expect, it } from "vitest"

import {
  buildDirectionsUrl,
  buildNearbyParams,
  composeAddress,
  distanceMeters,
  formatDistance,
  isNearlySamePosition,
  localIsoDow,
  parseInPersonSortOrder,
  resolveBannerReason,
  resolveMode,
  sortByDayThenLocalTime,
  sortByDistance,
  sortByLocalTime,
  sortInPerson,
} from "./nearbyLogic"

describe("resolveMode", () => {
  const base = {
    active: true,
    permission: "granted",
    fix: "acquired",
    nearbyFetchFailed: false,
  } as const

  it("is locating before activation", () => {
    expect(resolveMode({ ...base, active: false })).toBe("locating")
  })
  it("is locating while permission is undetermined", () => {
    expect(resolveMode({ ...base, permission: "undetermined" })).toBe("locating")
  })
  it("is locating while the fix is pending", () => {
    expect(resolveMode({ ...base, fix: "pending" })).toBe("locating")
  })
  it("falls back when permission is denied", () => {
    expect(resolveMode({ ...base, permission: "denied", fix: "pending" })).toBe("fallback")
  })
  it("falls back when the fix failed", () => {
    expect(resolveMode({ ...base, fix: "failed" })).toBe("fallback")
  })
  it("falls back when the nearby fetch failed", () => {
    expect(resolveMode({ ...base, nearbyFetchFailed: true })).toBe("fallback")
  })
  it("is nearby with permission, fix, and a healthy fetch", () => {
    expect(resolveMode(base)).toBe("nearby")
  })
})

describe("resolveBannerReason", () => {
  const base = {
    active: true,
    permission: "granted",
    fix: "acquired",
    nearbyFetchFailed: false,
  } as const

  it("shows no banner in nearby mode", () => {
    expect(resolveBannerReason(base)).toBeNull()
  })
  it("shows no banner while still locating", () => {
    expect(resolveBannerReason({ ...base, fix: "pending" })).toBeNull()
  })
  it("reports a denial", () => {
    expect(resolveBannerReason({ ...base, permission: "denied" })).toBe("denied")
  })
  // The regression this split exists for: permission granted, fix timed out.
  // Reported "location" before 2026-08-04, which rendered as "Enable location"
  // to a user who already had.
  it("reports a failed fix separately from a denial", () => {
    expect(resolveBannerReason({ ...base, fix: "failed" })).toBe("fixFailed")
  })
  it("reports a failed nearby fetch when we are located", () => {
    expect(resolveBannerReason({ ...base, nearbyFetchFailed: true })).toBe("nearbyFailed")
  })
  it("prefers the denial over a stale fetch failure", () => {
    expect(resolveBannerReason({ ...base, permission: "denied", nearbyFetchFailed: true })).toBe(
      "denied",
    )
  })
})

describe("isNearlySamePosition", () => {
  const here = { lat: 45.52, lon: -122.68 }

  it("is false when either side is missing", () => {
    expect(isNearlySamePosition(null, here)).toBe(false)
    expect(isNearlySamePosition(here, null)).toBe(false)
    expect(isNearlySamePosition(null, null)).toBe(false)
  })
  it("treats an identical position as the same", () => {
    expect(isNearlySamePosition(here, { ...here })).toBe(true)
  })
  it("treats a fix a block away as the same", () => {
    expect(isNearlySamePosition(here, { lat: 45.5205, lon: -122.6805 })).toBe(true)
  })
  it("treats a fix in the next town as different", () => {
    expect(isNearlySamePosition(here, { lat: 45.6, lon: -122.68 })).toBe(false)
    expect(isNearlySamePosition(here, { lat: 45.52, lon: -122.5 })).toBe(false)
  })
})

describe("buildNearbyParams", () => {
  it("converts km to meters and includes required params", () => {
    expect(buildNearbyParams(43.6, -116.2, 25, 2)).toEqual({
      lat: 43.6,
      lon: -116.2,
      radius: 25000,
      iso_dow: 2,
    })
  })
  it("clamps radius to the API max (100000 m)", () => {
    expect(buildNearbyParams(0, 0, 250, 1).radius).toBe(100_000)
  })
  it("includes fellowship only when provided", () => {
    expect(buildNearbyParams(1, 2, 10, 7, "NA").fellowship).toBe("NA")
    expect("fellowship" in buildNearbyParams(1, 2, 10, 7)).toBe(false)
  })
  it("never emits limit, venueType, or tz keys", () => {
    const keys = Object.keys(buildNearbyParams(1, 2, 10, 7, "AA"))
    expect(keys).not.toContain("limit")
    expect(keys).not.toContain("venueType")
    expect(keys).not.toContain("tz")
  })
})

describe("sortByDistance", () => {
  it("sorts ascending and does not mutate the input", () => {
    const input = [{ distance_m: 500 }, { distance_m: 100 }, { distance_m: 300 }]
    const out = sortByDistance(input)
    expect(out.map((x) => x.distance_m)).toEqual([100, 300, 500])
    expect(input[0].distance_m).toBe(500)
  })
  it("sorts entries missing distance_m last", () => {
    const out = sortByDistance([{ distance_m: 900 }, {}, { distance_m: 100 }])
    expect(out[0].distance_m).toBe(100)
    expect(out[2].distance_m).toBeUndefined()
  })
})

describe("sortByLocalTime", () => {
  it("orders by local wall-clock hour:minute, not raw millis", () => {
    // 23:30 today vs 06:15 tomorrow — raw millis order is reversed
    const today = new Date()
    const at = (dayOffset: number, h: number, m: number) =>
      new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, h, m).getTime()
    const out = sortByLocalTime([{ millis: at(0, 23, 30) }, { millis: at(1, 6, 15) }])
    expect(new Date(out[0].millis).getHours()).toBe(6)
  })
})

describe("formatDistance", () => {
  it("returns empty string for undefined", () => {
    expect(formatDistance(undefined, true)).toBe("")
  })
  it("formats miles with one decimal under 10 mi", () => {
    expect(formatDistance(1287, true)).toBe("0.8 mi")
  })
  it("rounds miles at 10+ mi", () => {
    expect(formatDistance(19312, true)).toBe("12 mi")
  })
  it("strips a trailing .0", () => {
    expect(formatDistance(8046.72, true)).toBe("5 mi")
  })
  it("formats meters under 1 km", () => {
    expect(formatDistance(480, false)).toBe("480 m")
  })
  it("formats km with one decimal under 10 km", () => {
    expect(formatDistance(1250, false)).toBe("1.3 km")
  })
  it("rounds km at 10+ km", () => {
    expect(formatDistance(25400, false)).toBe("25 km")
  })
})

describe("buildDirectionsUrl", () => {
  const coords = { latitude: 43.61, longitude: -116.2, venueName: "St. Mark's" }
  it("uses Apple Maps with coordinates on iOS", () => {
    expect(buildDirectionsUrl({ platform: "ios", ...coords })).toBe(
      "http://maps.apple.com/?daddr=43.61,-116.2",
    )
  })
  it("uses a geo: URI with a label on Android", () => {
    expect(buildDirectionsUrl({ platform: "android", ...coords })).toBe(
      "geo:43.61,-116.2?q=43.61,-116.2(St.%20Mark's)",
    )
  })
  it("uses Google Maps directions on web", () => {
    expect(buildDirectionsUrl({ platform: "web", ...coords })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=43.61%2C-116.2",
    )
  })
  it("falls back to the address when coordinates are missing", () => {
    const input = { formattedAddress: "100 Main St, Boise, ID" }
    expect(buildDirectionsUrl({ platform: "ios", ...input })).toBe(
      "http://maps.apple.com/?daddr=100%20Main%20St%2C%20Boise%2C%20ID",
    )
    expect(buildDirectionsUrl({ platform: "android", ...input })).toBe(
      "geo:0,0?q=100%20Main%20St%2C%20Boise%2C%20ID",
    )
  })
  it("treats (0,0) coordinates as missing", () => {
    expect(buildDirectionsUrl({ platform: "ios", latitude: 0, longitude: 0 })).toBe("")
  })
  it("returns empty string with neither coords nor address", () => {
    expect(buildDirectionsUrl({ platform: "android" })).toBe("")
  })
})

describe("composeAddress", () => {
  const full = {
    street: "261 Fell Street",
    city: "San Francisco",
    state: "CA",
    postalCode: "94102",
  }
  it("composes the full address from parts", () => {
    expect(composeAddress(full)).toBe("261 Fell Street, San Francisco, CA 94102")
  })
  it("prefers a populated formattedAddress over the parts", () => {
    expect(composeAddress({ ...full, formattedAddress: "PO Box 1, SF" })).toBe("PO Box 1, SF")
  })
  it("ignores an empty formattedAddress and falls back to parts", () => {
    expect(composeAddress({ ...full, formattedAddress: "" })).toBe(
      "261 Fell Street, San Francisco, CA 94102",
    )
  })
  it("drops the street when missing", () => {
    expect(composeAddress({ city: "San Francisco", state: "CA", postalCode: "94102" })).toBe(
      "San Francisco, CA 94102",
    )
  })
  it("drops the state when missing", () => {
    expect(
      composeAddress({ street: "261 Fell Street", city: "San Francisco", postalCode: "94102" }),
    ).toBe("261 Fell Street, San Francisco 94102")
  })
  it("drops the postal code when missing", () => {
    expect(composeAddress({ street: "261 Fell Street", city: "San Francisco", state: "CA" })).toBe(
      "261 Fell Street, San Francisco, CA",
    )
  })
  it("renders city alone when nothing else is present", () => {
    expect(composeAddress({ city: "San Francisco" })).toBe("San Francisco")
  })
  it("attaches a bare postal code to street when city and state are both missing", () => {
    expect(composeAddress({ street: "261 Fell Street", postalCode: "94102" })).toBe(
      "261 Fell Street, 94102",
    )
  })
  it("renders postal code alone when nothing else is present", () => {
    expect(composeAddress({ postalCode: "94102" })).toBe("94102")
  })
  it("returns empty string when nothing is available", () => {
    expect(composeAddress({})).toBe("")
  })
})

describe("distanceMeters", () => {
  // Boise, ID — the fixture city used across the in-person tests.
  const here = { lat: 43.615, lon: -116.2023 }

  it("returns ~0 for the same point", () => {
    expect(distanceMeters(here, { latitude: here.lat, longitude: here.lon })).toBeLessThan(1)
  })

  it("measures a known separation within haversine's tolerance", () => {
    // Boise → Salt Lake City is ~476 km great-circle. Note that is NOT the
    // ~544 km you get from a driving-directions site — this function measures
    // straight-line distance, and so does the badge it feeds. A spherical-earth
    // haversine is good to ~0.5%, so 3 km of slack is generous but still
    // catches a wrong radius constant, a degrees/radians slip, or swapped
    // lat/lon (all of which miss by far more than this).
    const slc = { latitude: 40.7608, longitude: -111.891 }
    const meters = distanceMeters(here, slc)
    expect(meters).toBeDefined()
    expect(Math.abs(meters! - 476_000)).toBeLessThan(3_000)
  })

  it("is symmetric", () => {
    const there = { latitude: 40.7608, longitude: -111.891 }
    const forward = distanceMeters(here, there)!
    const back = distanceMeters(
      { lat: there.latitude, lon: there.longitude },
      {
        latitude: here.lat,
        longitude: here.lon,
      },
    )!
    expect(Math.abs(forward - back)).toBeLessThan(1)
  })

  it("handles crossing the antimeridian without blowing up", () => {
    // A naive implementation that subtracts longitudes without the haversine's
    // sin(dLon/2) treatment reports ~half the earth here instead of ~430 km.
    const a = { lat: 0, lon: 179.9 }
    const b = { latitude: 0, longitude: -179.9 }
    const meters = distanceMeters(a, b)!
    expect(meters).toBeLessThan(30_000)
  })

  it("treats null island as missing, not as a real place", () => {
    // Sources use (0, 0) as a placeholder for ungeocodable venues. An
    // "8,400 km away" badge on one of those is worse than no badge — same
    // rule buildDirectionsUrl applies.
    expect(distanceMeters(here, { latitude: 0, longitude: 0 })).toBeUndefined()
  })

  it("returns undefined for missing or non-finite coordinates", () => {
    expect(distanceMeters(here, {})).toBeUndefined()
    expect(distanceMeters(here, { latitude: 43.6 })).toBeUndefined()
    expect(distanceMeters(here, { latitude: NaN, longitude: -116 })).toBeUndefined()
  })

  it("feeds formatDistance, which is what the badge actually shows", () => {
    // The two are always used together; this pins the seam so a unit change in
    // one can't silently produce a badge reading "544000 m".
    const slc = { latitude: 40.7608, longitude: -111.891 }
    expect(formatDistance(distanceMeters(here, slc), true)).toMatch(/^\d+ mi$/)
  })
})

/**
 * An instant on a known LOCAL weekday and local hour.
 *
 * 2026-08-03 is a Monday, so `isoDow` 1..7 maps onto Aug 3..9. Built with the
 * multi-arg Date constructor for the same reason `filterLogic.test.ts` does:
 * it interprets its arguments in the device's zone and `localIsoDow` reads the
 * local day back out, so these assertions hold in any CI region. A UTC millis
 * literal would make the whole suite timezone-dependent.
 */
function atLocalDayHour(isoDow: number, hour: number, minute = 0): number {
  return new Date(2026, 7, 2 + isoDow, hour, minute, 0).getTime()
}

describe("localIsoDow", () => {
  it("maps each local weekday onto its ISO number", () => {
    for (let iso = 1; iso <= 7; iso++) {
      expect(localIsoDow(atLocalDayHour(iso, 12)), `iso ${iso}`).toBe(iso)
    }
  })

  it("returns 7 for Sunday, not 0", () => {
    // JS `getDay()` puts Sunday at 0, which is also our ANY_DAY sentinel. If
    // this conversion is ever dropped, every Sunday meeting silently becomes
    // "any day" — the single worst failure this module can have.
    expect(localIsoDow(atLocalDayHour(7, 9))).toBe(7)
  })

  it("gives the 24/7 rooms no day at all", () => {
    // millis === 0 renders as "24h". A continuous meeting has no weekday, and
    // labelling it with whichever day the epoch lands on locally would be a
    // fabrication rather than a rounding.
    expect(localIsoDow(0)).toBeNull()
  })

  it("degrades to null on a non-finite millis rather than throwing", () => {
    // An API regression must not crash a list row.
    expect(localIsoDow(NaN)).toBeNull()
    expect(localIsoDow(Infinity)).toBeNull()
  })

  it("reports the DEVICE's weekday, which is the point", () => {
    // The tz-shift case this function exists for: an instant just after local
    // midnight belongs to the new day, and one just before it to the old one.
    // That is what makes a meeting the server calls Monday display as Sunday
    // for a device far enough west — matching the time on the same row.
    expect(localIsoDow(atLocalDayHour(1, 0, 5))).toBe(1)
    expect(localIsoDow(atLocalDayHour(1, 23, 55))).toBe(1)
    // One minute earlier is the previous local day.
    expect(localIsoDow(atLocalDayHour(1, 0, 5) - 10 * 60_000)).toBe(7)
  })
})

describe("sortByDayThenLocalTime", () => {
  const TODAY = 3 // Wednesday

  it("orders days from today forward, wrapping the week", () => {
    const items = [
      { id: "mon", millis: atLocalDayHour(1, 13) },
      { id: "wed", millis: atLocalDayHour(3, 13) },
      { id: "sun", millis: atLocalDayHour(7, 13) },
      { id: "thu", millis: atLocalDayHour(4, 13) },
    ]
    // Wednesday is today, so Thu/Sun follow and Monday — five days out — lands
    // last. A Monday-first sort would have put it at the top.
    expect(sortByDayThenLocalTime(items, TODAY).map((i) => i.id)).toEqual([
      "wed",
      "thu",
      "sun",
      "mon",
    ])
  })

  it("keeps plain midnight clock order within a single day", () => {
    const items = [
      { id: "9am", millis: atLocalDayHour(3, 9) },
      { id: "10pm", millis: atLocalDayHour(3, 22) },
      { id: "1pm", millis: atLocalDayHour(3, 13) },
    ]
    // CHANGED 2026-09-08 (Jenova): device-local start time from midnight,
    // AM first. The noon rotation this used to share with Search is gone.
    expect(sortByDayThenLocalTime(items, TODAY).map((i) => i.id)).toEqual(["9am", "1pm", "10pm"])
  })

  it("sorts by day BEFORE time, not the other way round", () => {
    // The defect this function exists to prevent: a plain clock sort
    // interleaves the week, so a Thursday 7pm sits between two Wednesday
    // meetings and the day badge becomes mandatory reading on every row.
    const items = [
      { id: "thu-1pm", millis: atLocalDayHour(4, 13) },
      { id: "wed-11pm", millis: atLocalDayHour(3, 23) },
    ]
    expect(sortByDayThenLocalTime(items, TODAY).map((i) => i.id)).toEqual(["wed-11pm", "thu-1pm"])
    // ...whereas the clock-only sort really would invert them, which is the
    // whole reason Search can't just keep using it under "Any".
    expect(sortByLocalTime(items).map((i) => i.id)).toEqual(["thu-1pm", "wed-11pm"])
  })

  it("floats the dayless 24/7 rooms above today", () => {
    // They are available right now, which makes them the most actionable
    // answer to "when is the next meeting I can get to".
    const items = [
      { id: "wed", millis: atLocalDayHour(3, 13) },
      { id: "24h", millis: 0 },
    ]
    expect(sortByDayThenLocalTime(items, TODAY).map((i) => i.id)).toEqual(["24h", "wed"])
  })

  it("does not mutate its input", () => {
    // Callers layer sortByFeedback over this; an in-place sort would reorder
    // the array a previous stage still holds a reference to.
    const items = [
      { id: "sun", millis: atLocalDayHour(7, 13) },
      { id: "wed", millis: atLocalDayHour(3, 13) },
    ]
    sortByDayThenLocalTime(items, TODAY)
    expect(items.map((i) => i.id)).toEqual(["sun", "wed"])
  })

  it("is stable, so a favourites pass can layer over it", () => {
    // sortByFeedback relies on this: equal keys must keep their relative
    // order or untouched meetings would reshuffle between renders.
    const items = [
      { id: "a", millis: atLocalDayHour(3, 13) },
      { id: "b", millis: atLocalDayHour(3, 13) },
      { id: "c", millis: atLocalDayHour(3, 13) },
    ]
    expect(sortByDayThenLocalTime(items, TODAY).map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("handles every possible 'today' without dropping a row", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      id: String(i + 1),
      millis: atLocalDayHour(i + 1, 12),
    }))
    for (let today = 1; today <= 7; today++) {
      const sorted = sortByDayThenLocalTime(items, today)
      expect(sorted, `today ${today}`).toHaveLength(7)
      // Today always leads, and the sequence walks forward from it.
      expect(sorted[0].id, `today ${today}`).toBe(String(today))
    }
  })
})

describe("parseInPersonSortOrder", () => {
  it("round-trips the two known orders", () => {
    expect(parseInPersonSortOrder("distance")).toBe("distance")
    expect(parseInPersonSortOrder("start")).toBe("start")
  })

  it("falls back to distance for anything else, including nothing stored", () => {
    expect(parseInPersonSortOrder(undefined)).toBe("distance")
    expect(parseInPersonSortOrder(null)).toBe("distance")
    expect(parseInPersonSortOrder("time")).toBe("distance")
  })
})

describe("sortInPerson", () => {
  // Local-clock helper: `sortInPerson`'s time keys read wall-clock hours, so
  // build the instants from local components rather than ISO strings.
  const at = (dow: number, h: number, m = 0): number => {
    // 2026-08-10 is a Monday; dow 1..7 → Mon..Sun of that week.
    const d = new Date(2026, 7, 10 + (dow - 1), h, m)
    return d.getTime()
  }
  const noFb = { feedback: null }
  const fave = { feedback: { loves: true, rates: 0, joins: 0 } }

  const rows = [
    { id: "far-early", millis: at(1, 9), distance_m: 5000, ...noFb },
    { id: "near-late", millis: at(1, 22), distance_m: 100, ...noFb },
    { id: "mid-noon", millis: at(1, 12), distance_m: 2000, ...noFb },
  ]

  it("distance: nearest first", () => {
    expect(sortInPerson(rows, "distance", false, 1).map((r) => r.id)).toEqual([
      "near-late",
      "mid-noon",
      "far-early",
    ])
  })

  it("start: midnight clock order on a single day", () => {
    // CHANGED 2026-09-08 (Jenova): 9am leads, noon follows, 10pm is last —
    // device-local start time from midnight, the same key Search uses now.
    expect(sortInPerson(rows, "start", false, 1).map((r) => r.id)).toEqual([
      "far-early",
      "mid-noon",
      "near-late",
    ])
  })

  it("start + any day: rolls day-first from today, then midnight clock within a day", () => {
    const week = [
      { id: "wed-9am", millis: at(3, 9), distance_m: 1, ...noFb },
      { id: "tue-9pm", millis: at(2, 21), distance_m: 2, ...noFb },
      { id: "tue-1pm", millis: at(2, 13), distance_m: 3, ...noFb },
      { id: "mon-8pm", millis: at(1, 20), distance_m: 4, ...noFb },
    ]
    // Today is Tuesday: Tuesday leads, Monday is six days out.
    expect(sortInPerson(week, "start", true, 2).map((r) => r.id)).toEqual([
      "tue-1pm",
      "tue-9pm",
      "wed-9am",
      "mon-8pm",
    ])
  })

  it("keeps favourites on top under either order", () => {
    const withFave = [
      ...rows,
      { id: "fave-far-early", millis: at(1, 8), distance_m: 9000, ...fave },
    ]
    expect(sortInPerson(withFave, "distance", false, 1)[0].id).toBe("fave-far-early")
    expect(sortInPerson(withFave, "start", false, 1)[0].id).toBe("fave-far-early")
  })

  it("does not mutate its input", () => {
    const copy = [...rows]
    sortInPerson(rows, "start", false, 1)
    expect(rows).toEqual(copy)
  })
})
