import { describe, expect, it } from "vitest"

import {
  decideBanner,
  decideOutageVariant,
  shouldFlipMaintenanceOnPollFailure,
  shouldSkipConfigPoll,
} from "./connectivityLogic"

describe("decideBanner", () => {
  it("shows nothing when online and healthy", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: false })).toBe("none")
  })

  it("shows maintenance when online and maintenance is flagged", () => {
    expect(decideBanner({ isOffline: false, maintenanceMode: true })).toBe("maintenance")
  })

  it("shows offline when the device is offline", () => {
    expect(decideBanner({ isOffline: true, maintenanceMode: false })).toBe("offline")
  })

  it("offline wins over maintenance — it is the more accurate diagnosis", () => {
    // Load-bearing precedence: an offline device cannot verify a maintenance
    // claim, and "you're offline" is true regardless of our service state.
    expect(decideBanner({ isOffline: true, maintenanceMode: true })).toBe("offline")
  })
})

describe("decideOutageVariant", () => {
  it("blames the device when it is offline", () => {
    expect(decideOutageVariant({ isOffline: true })).toBe("offline")
  })

  it("blames the service when the device is online", () => {
    expect(decideOutageVariant({ isOffline: false })).toBe("maintenance")
  })
})

describe("shouldFlipMaintenanceOnPollFailure", () => {
  it("flips maintenance for an online device whose poll exhausted retries", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: true })).toBe(true)
  })

  it("never flips maintenance while the device is offline", () => {
    // THE fix for the false-banner complaint: a subway rider's failed polls
    // are the device's problem, not evidence of maintenance.
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: true })).toBe(false)
  })

  it("never flips on the cold-start path (isLoaded false) — that is app.tsx's outage gate", () => {
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: false, isLoaded: false })).toBe(false)
    expect(shouldFlipMaintenanceOnPollFailure({ isOffline: true, isLoaded: false })).toBe(false)
  })
})

describe("shouldSkipConfigPoll", () => {
  it("skips polling while offline — a poll that cannot succeed must not count as a failure", () => {
    expect(shouldSkipConfigPoll({ isOffline: true })).toBe(true)
  })

  it("polls normally while online", () => {
    expect(shouldSkipConfigPoll({ isOffline: false })).toBe(false)
  })
})
