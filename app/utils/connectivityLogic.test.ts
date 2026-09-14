import { describe, expect, it } from "vitest"

import {
  decideBanner,
  decideOutageVariant,
  shouldFlipMaintenanceOnPollFailure,
  shouldSkipConfigPoll,
  isLiveRefreshBlocked,
  isServiceRecoveryEdge,
} from "./connectivityLogic"

describe("decideBanner", () => {
  it("shows nothing when online and healthy", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: false, deviceAuthDegraded: false }),
    ).toBe("none")
  })

  it("shows maintenance when online and maintenance is flagged", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: true, deviceAuthDegraded: false }),
    ).toBe("maintenance")
  })

  it("shows offline when the device is offline", () => {
    expect(
      decideBanner({ isOffline: true, maintenanceMode: false, deviceAuthDegraded: false }),
    ).toBe("offline")
  })

  it("offline wins over maintenance — it is the more accurate diagnosis", () => {
    // Load-bearing precedence: an offline device cannot verify a maintenance
    // claim, and "you're offline" is true regardless of our service state.
    expect(
      decideBanner({ isOffline: true, maintenanceMode: true, deviceAuthDegraded: false }),
    ).toBe("offline")
  })

  it("shows connecting when device auth is degraded and the device is online", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: false, deviceAuthDegraded: true }),
    ).toBe("connecting")
  })

  it("offline wins over connecting", () => {
    expect(
      decideBanner({ isOffline: true, maintenanceMode: false, deviceAuthDegraded: true }),
    ).toBe("offline")
  })

  it("connecting wins over maintenance", () => {
    expect(
      decideBanner({ isOffline: false, maintenanceMode: true, deviceAuthDegraded: true }),
    ).toBe("connecting")
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

describe("isLiveRefreshBlocked", () => {
  it("is not blocked when the service is healthy", () => {
    expect(isLiveRefreshBlocked({ maintenanceMode: false, outageMode: false })).toBe(false)
  })

  it("is blocked by runtime maintenance", () => {
    expect(isLiveRefreshBlocked({ maintenanceMode: true, outageMode: false })).toBe(true)
  })

  it("is blocked by cold-start outage — the flag maintenance never sets on that path", () => {
    // A cold start whose /status/ready precheck fails sets outageMode ONLY;
    // maintenanceMode stays false for the whole outage. Watching maintenance
    // alone is how Live stayed empty after the outage cleared.
    expect(isLiveRefreshBlocked({ maintenanceMode: false, outageMode: true })).toBe(true)
  })
})

describe("isServiceRecoveryEdge", () => {
  it("fires on the blocked → unblocked transition", () => {
    expect(isServiceRecoveryEdge(true, false)).toBe(true)
  })

  it("does not fire when blocking begins", () => {
    expect(isServiceRecoveryEdge(false, true)).toBe(false)
  })

  it("does not fire while steady in either state", () => {
    expect(isServiceRecoveryEdge(false, false)).toBe(false)
    expect(isServiceRecoveryEdge(true, true)).toBe(false)
  })

  it("treats an unknown previous state as no edge — the initial refresh already ran", () => {
    expect(isServiceRecoveryEdge(undefined, false)).toBe(false)
  })
})
