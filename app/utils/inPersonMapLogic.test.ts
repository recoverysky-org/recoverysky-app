import { describe, expect, it } from "vitest"

import {
  fellowshipColor,
  hasUsableCoords,
  parseVenueIds,
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
