import { describe, expect, it } from "vitest"

import {
  buildDirectionsUrl,
  buildNearbyParams,
  composeAddress,
  formatDistance,
  isSameLocalDay,
  resolveMode,
  sortByDistance,
  sortByLocalTime,
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

describe("isSameLocalDay", () => {
  it("true for two times on the same local calendar day", () => {
    const a = new Date(2026, 7, 3, 0, 5).getTime()
    const b = new Date(2026, 7, 3, 23, 55).getTime()
    expect(isSameLocalDay(a, b)).toBe(true)
  })
  it("false across local midnight", () => {
    const a = new Date(2026, 7, 3, 23, 55).getTime()
    const b = new Date(2026, 7, 4, 0, 5).getTime()
    expect(isSameLocalDay(a, b)).toBe(false)
  })
})
