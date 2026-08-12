import { describe, expect, it } from "vitest"

import {
  buildDirectionsUrl,
  buildNearbyParams,
  composeAddress,
  distanceMeters,
  formatDistance,
  isNearlySamePosition,
  resolveBannerReason,
  resolveMode,
  pmFirstMinutes,
  sortByDistance,
  sortByLocalTime,
  sortByLocalTimePmFirst,
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

describe("pmFirstMinutes", () => {
  /**
   * Local-time builder, same shape as the block above: the multi-arg Date
   * constructor reads its args in the device zone and the key reads local
   * parts back out, so every assertion here round-trips in any timezone.
   */
  const at = (h: number, m = 0) => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), t.getDate(), h, m).getTime()
  }

  it("puts noon at zero and 11:59am at the end of the day", () => {
    expect(pmFirstMinutes(at(12, 0))).toBe(0)
    expect(pmFirstMinutes(at(23, 59))).toBe(719)
    expect(pmFirstMinutes(at(0, 0))).toBe(720)
    expect(pmFirstMinutes(at(11, 59))).toBe(1439)
  })

  it("covers every minute of the day exactly once", () => {
    // No gaps and no collisions — a rotation that dropped or doubled a minute
    // would silently reorder a slice of the list.
    const keys = new Set<number>()
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) keys.add(pmFirstMinutes(at(h, m)))
    expect(keys.size).toBe(1440)
  })
})

describe("sortByLocalTimePmFirst", () => {
  const at = (h: number, m = 0) => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), t.getDate(), h, m).getTime()
  }
  const hours = <T extends { millis: number }>(rows: T[]) =>
    rows.map((r) => new Date(r.millis).getHours())

  it("leads with the evening meetings the midnight anchor buried", () => {
    // The reported defect in one assertion: 10pm belongs at the top of the
    // list, not below every morning meeting.
    const out = sortByLocalTimePmFirst([{ millis: at(6) }, { millis: at(22) }])
    expect(hours(out)).toEqual([22, 6])
  })

  it("runs pm ascending, then am ascending", () => {
    const out = sortByLocalTimePmFirst([
      { millis: at(9) },
      { millis: at(23, 30) },
      { millis: at(0, 15) },
      { millis: at(12) },
      { millis: at(18) },
    ])
    expect(hours(out)).toEqual([12, 18, 23, 0, 9])
  })

  it("splits the day at noon, not at midnight", () => {
    // The two boundary rows: 12:00pm opens the list, 11:59am closes it.
    const out = sortByLocalTimePmFirst([{ millis: at(11, 59) }, { millis: at(12, 0) }])
    expect(hours(out)).toEqual([12, 11])
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
