import { describe, expect, it } from "vitest"

import {
  boundsForRadius,
  boundsForVenues,
  defaultCameraForRegion,
  fellowshipColor,
  hasUsableCoords,
  parseVenueIds,
  shouldShowMapToggle,
  venuesToFeatureCollection,
} from "./inPersonMapLogic"

describe("hasUsableCoords", () => {
  it("accepts real coordinates", () => {
    expect(hasUsableCoords({ latitude: 40.7, longitude: -74.0 })).toBe(true)
  })
  it("rejects missing, non-finite, and null-island coordinates", () => {
    expect(hasUsableCoords({})).toBe(false)
    expect(hasUsableCoords({ latitude: 40.7 })).toBe(false)
    expect(hasUsableCoords({ latitude: NaN, longitude: 0 })).toBe(false)
    expect(hasUsableCoords({ latitude: 0, longitude: 0 })).toBe(false)
  })
})

describe("fellowshipColor", () => {
  it("returns a non-empty hex color for a known fellowship", () => {
    expect(fellowshipColor("AA")).toMatch(/^#/)
  })
  it("falls back to the NONE color for unknown/undefined", () => {
    expect(fellowshipColor(undefined)).toMatch(/^#/)
    expect(fellowshipColor("NOT_A_FELLOWSHIP")).toBe(fellowshipColor(undefined))
  })
})

describe("venuesToFeatureCollection", () => {
  const mtg = (id: string, lat: number, lon: number, extra: object = {}) => ({
    id,
    latitude: lat,
    longitude: lon,
    ...extra,
  })

  it("emits one feature per unique venue coordinate, GeoJSON [lon, lat] order", () => {
    const fc = venuesToFeatureCollection([mtg("a", 40.7, -74.0), mtg("b", 41.0, -73.5)])
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0].geometry.coordinates).toEqual([-74.0, 40.7])
  })

  it("groups co-located meetings into one feature with joined ids and count", () => {
    const fc = venuesToFeatureCollection([mtg("a", 40.7, -74.0), mtg("b", 40.7, -74.0)])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.ids).toBe("a,b")
    expect(fc.features[0].properties.count).toBe(2)
  })

  it("drops meetings without usable coordinates", () => {
    const fc = venuesToFeatureCollection([mtg("a", 0, 0), { id: "b" }, mtg("c", 40.7, -74.0)])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].properties.ids).toBe("c")
  })

  it("marks the venue approximate when any co-located meeting is approximate", () => {
    const fc = venuesToFeatureCollection([
      mtg("a", 40.7, -74.0),
      mtg("b", 40.7, -74.0, { approximate: true }),
    ])
    expect(fc.features[0].properties.approximate).toBe(true)
  })
})

describe("parseVenueIds", () => {
  it("splits a comma-joined string", () => {
    expect(parseVenueIds("a,b,c")).toEqual(["a", "b", "c"])
  })
  it("returns [] for non-strings and empty strings", () => {
    expect(parseVenueIds(undefined)).toEqual([])
    expect(parseVenueIds(42)).toEqual([])
    expect(parseVenueIds("")).toEqual([])
  })
})

describe("boundsForRadius", () => {
  it("builds a box that spans roughly 2× the radius in latitude", () => {
    const b = boundsForRadius(40.7, -74.0, 25)
    const latSpanKm = (b.ne[1] - b.sw[1]) * 111.32
    expect(latSpanKm).toBeGreaterThan(45)
    expect(latSpanKm).toBeLessThan(55)
    expect(b.ne[0]).toBeGreaterThan(b.sw[0])
  })
  it("widens the longitude span at high latitude", () => {
    const equator = boundsForRadius(0, 10, 25)
    const arctic = boundsForRadius(70, 10, 25)
    expect(arctic.ne[0] - arctic.sw[0]).toBeGreaterThan(equator.ne[0] - equator.sw[0])
  })
})

describe("boundsForVenues", () => {
  const fc = (coords: Array<[number, number]>) => ({
    type: "FeatureCollection" as const,
    features: coords.map(([lon, lat]) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
      properties: { ids: "x", count: 1, color: "#000", approximate: false },
    })),
  })

  it("returns null for an empty collection", () => {
    expect(boundsForVenues(fc([]))).toBeNull()
  })
  it("pads a single point into a non-degenerate box", () => {
    const b = boundsForVenues(fc([[-74.0, 40.7]]))!
    expect(b.ne[0]).toBeGreaterThan(b.sw[0])
    expect(b.ne[1]).toBeGreaterThan(b.sw[1])
  })
  it("contains all points with padding", () => {
    const b = boundsForVenues(
      fc([
        [-74.0, 40.7],
        [-73.5, 41.0],
      ]),
    )!
    expect(b.sw[0]).toBeLessThan(-74.0)
    expect(b.ne[0]).toBeGreaterThan(-73.5)
    expect(b.sw[1]).toBeLessThan(40.7)
    expect(b.ne[1]).toBeGreaterThan(41.0)
  })
})

describe("defaultCameraForRegion", () => {
  it("returns a continent-level camera for a known region", () => {
    const cam = defaultCameraForRegion("US")
    expect(cam.zoomLevel).toBeGreaterThanOrEqual(2)
    expect(cam.centerCoordinate[0]).toBeLessThan(-60) // somewhere over North America
  })
  it("falls back to a world view for unknown/absent regions", () => {
    expect(defaultCameraForRegion(undefined).zoomLevel).toBeLessThanOrEqual(1.5)
    expect(defaultCameraForRegion("ZZ").zoomLevel).toBeLessThanOrEqual(1.5)
  })
})

describe("shouldShowMapToggle", () => {
  const urls = { styleUrlLight: "https://x/light.json", styleUrlDark: "https://x/dark.json" }
  it("shows on native platforms with both style URLs", () => {
    expect(shouldShowMapToggle({ platform: "ios", ...urls })).toBe(true)
    expect(shouldShowMapToggle({ platform: "android", ...urls })).toBe(true)
  })
  it("hides on web (spec decision #10)", () => {
    expect(shouldShowMapToggle({ platform: "web", ...urls })).toBe(false)
  })
  it("hides when either style URL is missing (config kill switch)", () => {
    expect(shouldShowMapToggle({ platform: "ios", styleUrlLight: "", styleUrlDark: "x" })).toBe(
      false,
    )
    expect(shouldShowMapToggle({ platform: "ios", styleUrlLight: "x", styleUrlDark: "" })).toBe(
      false,
    )
  })
})
