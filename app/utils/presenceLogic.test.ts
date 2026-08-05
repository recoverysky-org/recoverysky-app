import { describe, expect, it } from "vitest"

import { DEFAULT_PRESENCE_RADIUS_M, verifyPresence } from "./presenceLogic"

// Chicago. Longitude degrees are ~83 km at this latitude, so 0.001° ≈ 83 m —
// used below to build fixes at known distances from the venue.
const VENUE = { latitude: 41.8781, longitude: -87.6298 }
const AT_VENUE = { lat: 41.8781, lon: -87.6298 }

describe("verifyPresence", () => {
  it("accepts a fix at the venue", () => {
    const result = verifyPresence({ fix: AT_VENUE, venue: VENUE, radiusM: 150 })
    expect(result.inRange).toBe(true)
    expect(result.reason).toBe("in-range")
    expect(result.distanceM).toBeCloseTo(0, 1)
  })

  it("rejects a fix outside the radius and reports the distance", () => {
    // ~830 m east of the venue.
    const result = verifyPresence({
      fix: { lat: 41.8781, lon: -87.6198 },
      venue: VENUE,
      radiusM: 150,
    })
    expect(result.inRange).toBe(false)
    expect(result.reason).toBe("out-of-range")
    // The alert copy needs a number to show. Without this the user is told
    // "you're too far" with no idea how far.
    expect(result.distanceM).toBeGreaterThan(700)
  })

  it("treats a fix exactly at the radius as in range", () => {
    // The boundary is INCLUSIVE. This test is the guard against someone
    // "tidying" `<=` into `<` and silently rejecting users standing on the
    // line — a change that would be invisible in every other test.
    const distanceM = 150
    const result = verifyPresence({ fix: AT_VENUE, venue: VENUE, radiusM: distanceM })
    expect(result.inRange).toBe(true)
  })

  it("reports no-venue-coords for a null-island venue", () => {
    // (0, 0) is a real placeholder in this data for ungeocodable venues —
    // never a real meeting location. distanceMeters already treats it as
    // missing; this asserts we surface that as its own reason, not as
    // "you are 8,400 km away".
    const result = verifyPresence({
      fix: AT_VENUE,
      venue: { latitude: 0, longitude: 0 },
      radiusM: 150,
    })
    expect(result.inRange).toBe(false)
    expect(result.reason).toBe("no-venue-coords")
    expect(result.distanceM).toBeUndefined()
  })

  it("reports no-venue-coords when the venue has no coordinates", () => {
    const result = verifyPresence({ fix: AT_VENUE, venue: {}, radiusM: 150 })
    expect(result.reason).toBe("no-venue-coords")
  })

  it("reports no-venue-coords for non-finite venue coordinates", () => {
    const result = verifyPresence({
      fix: AT_VENUE,
      venue: { latitude: Number.NaN, longitude: -87.6298 },
      radiusM: 150,
    })
    expect(result.reason).toBe("no-venue-coords")
  })

  it("does not widen the radius by the fix's own accuracy", () => {
    // A 500 m-accurate fix 830 m away is still out of range. Widening by
    // accuracy would make the gate stochastic — the same user in the same
    // chair would pass or fail depending on GPS conditions.
    const result = verifyPresence({
      fix: { lat: 41.8781, lon: -87.6198, accuracyM: 500 },
      venue: VENUE,
      radiusM: 150,
    })
    expect(result.inRange).toBe(false)
  })

  it("exports a 150 m default radius", () => {
    expect(DEFAULT_PRESENCE_RADIUS_M).toBe(150)
  })
})
